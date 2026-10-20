import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import type { FastifyInstance, HTTPMethods } from 'fastify';
import type { Pool } from 'pg';
import { buildApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';
import { runMigrations } from '../src/db/migrate.js';
import { createPool } from '../src/db/pool.js';
import { ApiError } from '../src/lib/errors.js';
import { hashPassword } from '../src/lib/security.js';
import type { StorageProvider, StoredObject } from '../src/services/storage/types.js';
import { createUser } from '../src/services/users.js';
import type { UserRole } from '../src/services/sessions.js';

/** قاعدة بيانات الاختبارات تُمرَّر عبر DATABASE_URL (راجع قسم الاختبارات في README). */
export function testDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is required to run the integration test suite.');
  }
  return url;
}

async function streamToBuffer(source: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of source) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

/** مزوّد تخزين في الذاكرة يحاكي سلوك مزوّد التخزين (بما فيها أخطاء الخدمة). */
export class MemoryStorageProvider implements StorageProvider {
  readonly name = 'memory';
  readonly objects = new Map<string, { data: Buffer; contentType: string }>();
  failPut = false;
  failGet = false;
  failDelete = false;
  healthValue = true;

  async health(): Promise<boolean> {
    return this.healthValue;
  }

  async putObject(
    key: string,
    source: Readable | Buffer,
    options: { contentType: string },
  ): Promise<void> {
    if (this.failPut) {
      throw ApiError.badGateway('storage_upload_failed', 'فشل محاكى أثناء رفع الملف.');
    }
    const data = Buffer.isBuffer(source) ? source : await streamToBuffer(source);
    this.objects.set(key, { data, contentType: options.contentType });
  }

  async getObject(key: string): Promise<StoredObject> {
    if (this.failGet) {
      throw ApiError.badGateway('storage_download_failed', 'فشل محاكى أثناء تنزيل الملف.');
    }
    const entry = this.objects.get(key);
    if (!entry) {
      throw ApiError.badGateway('storage_download_failed', 'المفتاح غير موجود في التخزين المحاكى.');
    }
    return {
      body: Readable.from(entry.data),
      contentType: entry.contentType,
      contentLength: entry.data.length,
    };
  }

  async deleteObject(key: string): Promise<void> {
    if (this.failDelete) {
      throw ApiError.badGateway('storage_delete_failed', 'فشل محاكى أثناء حذف الملف.');
    }
    this.objects.delete(key);
  }
}

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    nodeEnv: 'test',
    isProduction: false,
    port: 0,
    logLevel: 'silent',
    trustProxy: false,
    publicOrigin: null,
    databaseUrl: testDatabaseUrl(),
    sessionTtlHours: 1,
    cookieSecure: false,
    uploadMaxMb: 1,
    uploadsDir: path.join(tmpdir(), 'hlc-test-uploads'),
    rateLimits: { loginMax: 50, sensitiveMax: 50, globalMax: 100000 },
    ...overrides,
  };
}

export interface TestContext {
  app: FastifyInstance;
  pool: Pool;
  storage: MemoryStorageProvider;
  config: AppConfig;
}

export async function createTestContext(overrides: Partial<AppConfig> = {}): Promise<TestContext> {
  const config = testConfig(overrides);
  const pool = createPool(config.databaseUrl);
  const storage = new MemoryStorageProvider();
  const app = await buildApp({ config, pool, storage });
  await app.ready();
  return { app, pool, storage, config };
}

export async function disposeTestContext(context: TestContext): Promise<void> {
  await context.app.close();
  await context.pool.end();
}

export async function ensureMigrated(pool: Pool): Promise<void> {
  await runMigrations(pool, {});
}

export async function resetDatabase(pool: Pool): Promise<void> {
  await pool.query(
    'TRUNCATE audit_log, data_imports, document_files, documents, departments, sessions, users RESTART IDENTITY CASCADE',
  );
}

export async function createTestUser(
  pool: Pool,
  options: {
    username: string;
    password?: string;
    role?: UserRole;
    displayName?: string;
    employeeNumber?: string | null;
    isActive?: boolean;
  },
): Promise<string> {
  const passwordHash = await hashPassword(options.password ?? 'password-123');
  const user = await createUser(pool, {
    username: options.username,
    displayName: options.displayName ?? options.username,
    employeeNumber: options.employeeNumber,
    role: options.role ?? 'employee',
    passwordHash,
  });
  if (options.isActive === false) {
    await pool.query('UPDATE users SET is_active = false WHERE id = $1', [user.id]);
  }
  return user.id;
}

export interface AuthedClient {
  token: string;
  csrf: string;
  user: { id: string; username: string; displayName: string; role: UserRole };
}

async function loginWithPayload(
  app: FastifyInstance,
  payload: { username: string; password: string } | { identifier: string; password: string },
): Promise<AuthedClient> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload,
  });
  if (response.statusCode !== 200) {
    throw new Error(`login failed (${response.statusCode}): ${response.body}`);
  }
  const body = response.json() as { user: AuthedClient['user']; csrfToken: string };
  const setCookie = response.headers['set-cookie'];
  const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const match = /hlc_session=([^;]+)/.exec(cookieHeader ?? '');
  if (!match) throw new Error('session cookie missing in login response');
  return { token: match[1]!, csrf: body.csrfToken, user: body.user };
}

export function loginClient(
  app: FastifyInstance,
  username: string,
  password = 'password-123',
): Promise<AuthedClient> {
  return loginWithPayload(app, { username, password });
}

/** عميل مسجّل عبر الحقل الجديد identifier (اسم مستخدم أو رقم وظيفي). */
export function loginClientWithIdentifier(
  app: FastifyInstance,
  identifier: string,
  password = 'password-123',
): Promise<AuthedClient> {
  return loginWithPayload(app, { identifier, password });
}

export type InjectResult = Awaited<ReturnType<FastifyInstance['inject']>>;

export function apiRequest(
  app: FastifyInstance,
  client: AuthedClient | null,
  method: HTTPMethods,
  path: string,
  options: { payload?: unknown; headers?: Record<string, string> } = {},
): Promise<InjectResult> {
  const injectOptions: Record<string, unknown> = { method, url: `/api/v1${path}` };
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  if (client) {
    injectOptions.cookies = { hlc_session: client.token };
    headers['x-csrf-token'] = client.csrf;
  }
  if (Object.keys(headers).length > 0) injectOptions.headers = headers;
  if (options.payload !== undefined) injectOptions.payload = options.payload;
  return app.inject(injectOptions as never);
}

export function multipartFixture(options: {
  filename: string;
  contentType: string;
  content: Buffer;
  fieldName?: string;
}): { payload: Buffer; headers: Record<string, string> } {
  const boundary = `----hlcTest${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const fieldName = options.fieldName ?? 'file';
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${options.filename}"\r\nContent-Type: ${options.contentType}\r\n\r\n`,
    'utf8',
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  return {
    payload: Buffer.concat([head, options.content, tail]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

export { test };
