import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test, { after, before, beforeEach } from 'node:test';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { buildApp } from '../src/app.js';
import { createPool } from '../src/db/pool.js';
import { LocalFilesystemStorageProvider } from '../src/services/storage/local.js';
import {
  apiRequest,
  createTestUser,
  ensureMigrated,
  loginClient,
  multipartFixture,
  resetDatabase,
  testConfig,
  testDatabaseUrl,
  type AuthedClient,
} from './helpers.js';

const PNG_BYTES = Buffer.concat([
  Buffer.from('89504e470d0a1a0a', 'hex'),
  Buffer.alloc(256, 0x5a),
]);

async function makeTempRoot(prefix: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix));
}

async function streamToBuffer(source: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of source) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

function isErrorWithCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === code;
}

// ---------------------------------------------------------------------------
// اختبارات المزوّد المحلي مباشرة (بلا قاعدة بيانات)
// ---------------------------------------------------------------------------

test('local provider writes and reads back identical binary content under the root', async () => {
  const root = await makeTempRoot('hlc-local-');
  try {
    const provider = new LocalFilesystemStorageProvider(root);
    await provider.init();
    const key = `documents/${randomUUID()}/${randomUUID()}.png`;

    await provider.putObject(key, PNG_BYTES, {
      contentType: 'image/png',
      contentLength: PNG_BYTES.length,
    });

    const object = await provider.getObject(key);
    assert.equal(object.contentLength, PNG_BYTES.length);
    assert.ok((await streamToBuffer(object.body)).equals(PNG_BYTES));

    // المحتوى مكتوب فعلاً على القرص تحت الجذر وليس في الذاكرة
    assert.ok((await readFile(path.join(root, key))).equals(PNG_BYTES));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('local provider keeps objects when a new provider instance uses the same directory', async () => {
  const root = await makeTempRoot('hlc-local-');
  try {
    const key = `documents/${randomUUID()}/${randomUUID()}.pdf`;
    const first = new LocalFilesystemStorageProvider(root);
    await first.init();
    await first.putObject(key, PNG_BYTES, {
      contentType: 'application/pdf',
      contentLength: PNG_BYTES.length,
    });

    // مزوّد جديد تماماً فوق المجلد نفسه (محاكاة إعادة تشغيل الخادم)
    const second = new LocalFilesystemStorageProvider(root);
    await second.init();
    assert.equal(await second.health(), true);
    assert.ok((await streamToBuffer((await second.getObject(key)).body)).equals(PNG_BYTES));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('local provider streams a large upload without materializing it in memory', async () => {
  const root = await makeTempRoot('hlc-local-');
  try {
    const provider = new LocalFilesystemStorageProvider(root);
    await provider.init();
    const key = `documents/${randomUUID()}/${randomUUID()}.bin`;

    const chunkSize = 256 * 1024;
    const chunkCount = 16; // 4 MiB
    const hash = createHash('sha256');
    let sent = 0;
    const source = new Readable({
      read(): void {
        if (sent >= chunkCount) {
          this.push(null);
          return;
        }
        const chunk = Buffer.alloc(chunkSize, sent % 251);
        hash.update(chunk);
        sent += 1;
        this.push(chunk);
      },
    });

    await provider.putObject(key, source, {
      contentType: 'application/octet-stream',
      contentLength: chunkSize * chunkCount,
    });
    const expectedChecksum = hash.digest('hex');

    const readBack = createHash('sha256');
    let bytes = 0;
    for await (const chunk of (await provider.getObject(key)).body) {
      const buffer = chunk as Buffer;
      bytes += buffer.length;
      readBack.update(buffer);
    }
    assert.equal(bytes, chunkSize * chunkCount);
    assert.equal(readBack.digest('hex'), expectedChecksum);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('local provider rejects traversal, absolute, encoded and windows-style keys', async () => {
  const root = await makeTempRoot('hlc-local-');
  const probeName = `hlc-escape-probe-${randomUUID()}.txt`;
  const outsideProbe = path.join(path.dirname(root), probeName);
  try {
    const provider = new LocalFilesystemStorageProvider(root);
    await provider.init();

    const badKeys = [
      '',
      '.',
      '..',
      `../${probeName}`,
      `documents/../../${probeName}`,
      '/etc/passwd',
      `/tmp/${probeName}`,
      `documents\\${probeName}`,
      `C:\\temp\\${probeName}`,
      `documents/%2e%2e/${probeName}`,
      'documents//nested.txt',
      'documents/',
      `${'a'.repeat(150)}/file.txt`,
      'documents/\u0000/null.txt',
    ];

    for (const key of badKeys) {
      await assert.rejects(
        () => provider.getObject(key),
        `getObject must reject invalid key: ${JSON.stringify(key)}`,
      );
      await assert.rejects(
        () => provider.putObject(key, Buffer.from('x'), { contentType: 'text/plain' }),
        `putObject must reject invalid key: ${JSON.stringify(key)}`,
      );
      await assert.rejects(
        () => provider.deleteObject(key),
        `deleteObject must reject invalid key: ${JSON.stringify(key)}`,
      );
    }

    assert.equal(existsSync(outsideProbe), false);
    assert.deepEqual(await readdir(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('local provider refuses to overwrite and deletes stored objects safely', async () => {
  const root = await makeTempRoot('hlc-local-');
  try {
    const provider = new LocalFilesystemStorageProvider(root);
    await provider.init();
    const key = `documents/${randomUUID()}/${randomUUID()}.txt`;

    await provider.putObject(key, Buffer.from('first'), { contentType: 'text/plain' });
    await assert.rejects(
      () => provider.putObject(key, Buffer.from('second'), { contentType: 'text/plain' }),
      (error: unknown) => isErrorWithCode(error, 'storage_key_conflict'),
    );
    assert.ok((await readFile(path.join(root, key))).equals(Buffer.from('first')));
    // لا ملفات مؤقتة متروكة بجانب الملف النهائي
    assert.deepEqual(await readdir(path.dirname(path.join(root, key))), [path.basename(key)]);

    await provider.deleteObject(key);
    await assert.rejects(() => provider.getObject(key));
    // الحذف المتكرر آمن
    await provider.deleteObject(key);
    // مجلد المستند الفارغ أُزيل تنظيفاً
    assert.deepEqual(await readdir(path.join(root, 'documents')), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('local provider handles missing files and directories', async () => {
  const root = await makeTempRoot('hlc-local-');
  try {
    const provider = new LocalFilesystemStorageProvider(root);
    await provider.init();

    const missingKey = `documents/${randomUUID()}/${randomUUID()}.pdf`;
    await assert.rejects(() => provider.getObject(missingKey));
    await assert.doesNotReject(() => provider.deleteObject(missingKey));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('local provider initializes nested directories and reports health honestly', async () => {
  const root = await makeTempRoot('hlc-local-');
  try {
    const nestedRoot = path.join(root, 'data', 'uploads');
    const provider = new LocalFilesystemStorageProvider(nestedRoot);
    assert.equal(await provider.health(), false); // غير موجود بعد

    await provider.init();
    assert.equal(await provider.health(), true);
    assert.ok((await stat(nestedRoot)).isDirectory());

    // مسار يحجبه ملف عادي غير قابل للاستخدام كمجلد تخزين
    const blockedPath = path.join(root, 'blocked');
    await writeFile(blockedPath, 'not a directory');
    const blocked = new LocalFilesystemStorageProvider(path.join(blockedPath, 'uploads'));
    assert.equal(await blocked.health(), false);
    await assert.rejects(() => blocked.init());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('local provider prevents symlink-based escapes', async () => {
  const root = await makeTempRoot('hlc-local-');
  const outside = await makeTempRoot('hlc-outside-');
  try {
    const provider = new LocalFilesystemStorageProvider(root);
    await provider.init();

    // رابط رمزي في منتصف المسار يشير خارج الجذر
    await mkdir(path.join(root, 'documents'), { recursive: true });
    await symlink(outside, path.join(root, 'documents', 'planted-doc'));
    const escapingKey = `documents/planted-doc/${randomUUID()}.txt`;

    await assert.rejects(() =>
      provider.putObject(escapingKey, Buffer.from('x'), { contentType: 'text/plain' }),
    );
    await assert.rejects(() => provider.getObject(escapingKey));
    await assert.rejects(() => provider.deleteObject(escapingKey));
    assert.deepEqual(await readdir(outside), []);

    // رابط رمزي مكان الملف النهائي نفسه
    const docDir = path.join(root, 'documents', 'real-doc');
    await mkdir(docDir, { recursive: true });
    const outsideFile = path.join(outside, 'target.txt');
    await writeFile(outsideFile, 'outside');
    const linkPath = path.join(docDir, `${randomUUID()}.txt`);
    await symlink(outsideFile, linkPath);

    await assert.rejects(() => provider.getObject(path.relative(root, linkPath)));
    assert.equal(await readFile(outsideFile, 'utf8'), 'outside');
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// اختبارات التكامل عبر الواجهة: الرفع/التحميل/الحذف على القرص الفعلي
// ---------------------------------------------------------------------------

let pool: Pool;
let uploadsRoot: string;

before(async () => {
  pool = createPool(testDatabaseUrl());
  await ensureMigrated(pool);
  uploadsRoot = path.join(tmpdir(), `hlc-api-uploads-${randomUUID()}`);
});

after(async () => {
  await pool.end();
  await rm(uploadsRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  await resetDatabase(pool);
  await rm(uploadsRoot, { recursive: true, force: true });
  await mkdir(uploadsRoot, { recursive: true });
  await createTestUser(pool, { username: 'admin', role: 'admin' });
  await createTestUser(pool, { username: 'employee', role: 'employee' });
});

async function buildLocalApi(): Promise<{ app: FastifyInstance; storage: LocalFilesystemStorageProvider }> {
  const storage = new LocalFilesystemStorageProvider(uploadsRoot);
  await storage.init();
  const app = await buildApp({ config: testConfig(), pool, storage });
  await app.ready();
  return { app, storage };
}

async function createDocumentVia(app: FastifyInstance, client: AuthedClient, reference: string): Promise<string> {
  const created = await apiRequest(app, client, 'POST', '/documents', {
    payload: { reference, title: `معاملة ${reference}`, type: 'incoming', date: '2026-02-01' },
  });
  assert.equal(created.statusCode, 201, created.body);
  return (created.json() as { document: { id: string } }).document.id;
}

test('api stores uploads on disk, serves them after a restart, and removes them on delete', async () => {
  const { app: firstApp } = await buildLocalApi();
  const employee = await loginClient(firstApp, 'employee');
  const documentId = await createDocumentVia(firstApp, employee, 'LOCAL-1');

  const fixture = multipartFixture({ filename: 'scan.png', contentType: 'image/png', content: PNG_BYTES });
  const uploaded = await apiRequest(firstApp, employee, 'POST', `/documents/${documentId}/files`, {
    payload: fixture.payload,
    headers: fixture.headers,
  });
  assert.equal(uploaded.statusCode, 201, uploaded.body);
  const uploadedJson = uploaded.json() as { file: { id: string; originalName: string; sizeBytes: number } };
  const uploadedFile = uploadedJson.file;
  assert.equal(uploadedFile.originalName, 'scan.png');
  // لا يُسرَّب مسار التخزين أو مفتاحه عبر الواجهة
  assert.equal(Object.prototype.hasOwnProperty.call(uploadedJson.file, 'storageKey'), false);

  const row = (
    await pool.query<{
      storage_provider: string;
      storage_key: string;
      size_bytes: string;
      checksum_sha256: string;
    }>('SELECT storage_provider, storage_key, size_bytes, checksum_sha256 FROM document_files WHERE id = $1', [
      uploadedFile.id,
    ])
  ).rows[0]!;
  assert.equal(row.storage_provider, 'local');
  assert.match(row.storage_key, /^documents\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.png$/);
  assert.equal(Number(row.size_bytes), PNG_BYTES.length);
  assert.equal(row.checksum_sha256, createHash('sha256').update(PNG_BYTES).digest('hex'));

  const onDiskPath = path.join(uploadsRoot, row.storage_key);
  assert.ok((await readFile(onDiskPath)).equals(PNG_BYTES));

  const download1 = await apiRequest(firstApp, employee, 'GET', `/files/${uploadedFile.id}/download`);
  assert.equal(download1.statusCode, 200);
  assert.ok(download1.rawPayload.equals(PNG_BYTES));
  assert.match(String(download1.headers['content-disposition']), /^attachment;/);
  assert.match(String(download1.headers['cache-control']), /no-store/);
  await firstApp.close();

  // «إعادة تشغيل»: نسخة تطبيق ومزوّد جديدان فوق المجلد نفسه
  const { app: secondApp } = await buildLocalApi();
  const employee2 = await loginClient(secondApp, 'employee');
  const download2 = await apiRequest(secondApp, employee2, 'GET', `/files/${uploadedFile.id}/download`);
  assert.equal(download2.statusCode, 200);
  assert.ok(download2.rawPayload.equals(PNG_BYTES));

  const ready = await secondApp.inject({ method: 'GET', url: '/api/v1/ready' });
  assert.equal(ready.statusCode, 200);
  assert.deepEqual(ready.json(), { status: 'ready', database: true, storage: true });

  const admin2 = await loginClient(secondApp, 'admin');
  const deleted = await apiRequest(secondApp, admin2, 'DELETE', `/files/${uploadedFile.id}`);
  assert.equal(deleted.statusCode, 200);
  assert.equal(existsSync(onDiskPath), false);
  const remaining = await pool.query('SELECT 1 FROM document_files WHERE id = $1', [uploadedFile.id]);
  assert.equal(remaining.rows.length, 0);

  const audit = await pool.query<{ action: string }>(
    "SELECT action FROM audit_log WHERE action IN ('file.uploaded','file.downloaded','file.deleted') ORDER BY id ASC",
  );
  assert.deepEqual(
    audit.rows.map((entry) => entry.action),
    ['file.uploaded', 'file.downloaded', 'file.downloaded', 'file.deleted'],
  );
  await secondApp.close();
});

test('api refuses downloads and deletions for rows from another storage provider', async () => {
  const { app } = await buildLocalApi();
  const admin = await loginClient(app, 'admin');
  const documentId = await createDocumentVia(app, admin, 'LOCAL-2');

  const legacyFileId = randomUUID();
  await pool.query(
    `INSERT INTO document_files
       (id, document_id, original_name, mime_type, size_bytes, checksum_sha256, storage_provider, storage_key, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      legacyFileId,
      documentId,
      'legacy.pdf',
      'application/pdf',
      10,
      null,
      's3',
      `archive/documents/${documentId}/${legacyFileId}.pdf`,
      admin.user.id,
    ],
  );

  const download = await apiRequest(app, admin, 'GET', `/files/${legacyFileId}/download`);
  assert.equal(download.statusCode, 409);
  assert.equal((download.json() as { error: { code: string } }).error.code, 'unsupported_storage_provider');

  const deleted = await apiRequest(app, admin, 'DELETE', `/files/${legacyFileId}`);
  assert.equal(deleted.statusCode, 409);
  assert.equal((deleted.json() as { error: { code: string } }).error.code, 'unsupported_storage_provider');

  // السجل التشغيلي بقي كما هو ولم يُمَس أي كائن
  const remaining = await pool.query<{ storage_provider: string }>(
    'SELECT storage_provider FROM document_files WHERE id = $1',
    [legacyFileId],
  );
  assert.equal(remaining.rows.length, 1);
  assert.equal(remaining.rows[0]!.storage_provider, 's3');
  await app.close();
});

test('readiness fails and uploads fail cleanly when the local storage path is unusable', async () => {
  const blockerPath = path.join(tmpdir(), `hlc-blocker-${randomUUID()}`);
  await writeFile(blockerPath, 'not a directory');
  try {
    const storage = new LocalFilesystemStorageProvider(path.join(blockerPath, 'uploads'));
    const app = await buildApp({ config: testConfig(), pool, storage });
    await app.ready();

    const health = await app.inject({ method: 'GET', url: '/api/v1/health' });
    assert.equal(health.statusCode, 200);

    const ready = await app.inject({ method: 'GET', url: '/api/v1/ready' });
    assert.equal(ready.statusCode, 503);
    assert.deepEqual(ready.json(), { status: 'not_ready', database: true, storage: false });

    const employee = await loginClient(app, 'employee');
    const documentId = await createDocumentVia(app, employee, 'LOCAL-3');
    const fixture = multipartFixture({ filename: 'scan.png', contentType: 'image/png', content: PNG_BYTES });
    const uploaded = await apiRequest(app, employee, 'POST', `/documents/${documentId}/files`, {
      payload: fixture.payload,
      headers: fixture.headers,
    });
    assert.equal(uploaded.statusCode, 502);
    assert.equal((uploaded.json() as { error: { code: string } }).error.code, 'storage_upload_failed');

    const rows = await pool.query('SELECT 1 FROM document_files');
    assert.equal(rows.rows.length, 0);
    await app.close();
  } finally {
    await rm(blockerPath, { force: true });
  }
});
