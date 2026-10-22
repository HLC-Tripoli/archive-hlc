import os from 'node:os';
import path from 'node:path';
import { ConfigError } from './lib/errors.js';

export type NodeEnv = 'development' | 'production' | 'test';

/** المسار الداخلي الافتراضي لمجلد تخزين المرفقات داخل حاوية api. */
export const DEFAULT_UPLOADS_DIR = '/data/uploads';

/** مجلد العمل المؤقت لتحسين المرفقات (يُنشأ بصلاحيات 0700 عند أول استخدام). */
export const DEFAULT_PROCESSING_TMP_DIR = path.join(os.tmpdir(), 'archive-hlc-processing');

export interface AppConfig {
  nodeEnv: NodeEnv;
  isProduction: boolean;
  port: number;
  logLevel: string;
  trustProxy: boolean;
  publicOrigin: string | null;
  databaseUrl: string;
  sessionTtlHours: number;
  cookieSecure: boolean;
  uploadMaxMb: number;
  /** المجلد الجذري لتخزين المرفقات على نظام الملفات (يُوصَل إليه Compose بحجم دائم). */
  uploadsDir: string;
  /** المجلد المؤقت الذي تُكتب فيه نسخ التحسين قبل اختيار النسخة النهائية. */
  processingTmpDir: string;
  /** الحد الأقصى الكلي لزمن تحسين مرفق واحد (بالمللي ثانية). */
  optimizationTimeoutMs: number;
  /** الحد الأقصى لعدد عمليات التحسين المتزامنة. */
  optimizationConcurrency: number;
  rateLimits: {
    loginMax: number;
    sensitiveMax: number;
    globalMax: number;
  };
}

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

function requireNonEmpty(value: string | undefined, name: string): string {
  const trimmed = (value ?? '').trim();
  if (!trimmed) {
    throw new ConfigError(`Missing required environment variable: ${name}`);
  }
  return trimmed;
}

function readInt(value: string | undefined, name: string, fallback: number, min: number, max: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new ConfigError(`${name} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

function readBool(value: string | undefined, name: string, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  throw new ConfigError(`${name} must be true or false`);
}

function normalizeOrigin(value: string, name: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ConfigError(`${name} must be a valid absolute URL, e.g. https://archive.example.com`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ConfigError(`${name} must use http:// or https://`);
  }
  return `${parsed.protocol}//${parsed.host}`;
}

/**
 * مسار تخزين المرفقات المحلي: يُحلَّل إلى مسار مطلق (أو الافتراضي داخل الحاوية)،
 * وتُرفض القيم الفارغة وجذر نظام الملفات وكأي محتوى يحتوي بايت NUL.
 */
function readUploadsDir(value: string | undefined): string {
  const raw = (value ?? '').trim() || DEFAULT_UPLOADS_DIR;
  if (raw.includes('\0')) {
    throw new ConfigError('UPLOADS_DIR must not contain NUL bytes');
  }
  const resolved = path.resolve(raw);
  if (resolved === path.parse(resolved).root) {
    throw new ConfigError('UPLOADS_DIR must not point at the filesystem root');
  }
  return resolved;
}

function readProcessingTmpDir(value: string | undefined): string {
  const raw = (value ?? '').trim() || DEFAULT_PROCESSING_TMP_DIR;
  if (raw.includes('\0')) {
    throw new ConfigError('PROCESSING_TMP_DIR must not contain NUL bytes');
  }
  const resolved = path.resolve(raw);
  if (resolved === path.parse(resolved).root) {
    throw new ConfigError('PROCESSING_TMP_DIR must not point at the filesystem root');
  }
  return resolved;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnvRaw = (env.NODE_ENV ?? 'development').trim();
  if (nodeEnvRaw !== 'development' && nodeEnvRaw !== 'production' && nodeEnvRaw !== 'test') {
    throw new ConfigError('NODE_ENV must be one of: development, production, test');
  }
  const nodeEnv = nodeEnvRaw as NodeEnv;
  const isProduction = nodeEnv === 'production';

  const logLevel = (env.LOG_LEVEL ?? 'info').trim().toLowerCase();
  if (!(LOG_LEVELS as readonly string[]).includes(logLevel)) {
    throw new ConfigError(`LOG_LEVEL must be one of: ${LOG_LEVELS.join(', ')}`);
  }

  const publicOriginRaw = (env.PUBLIC_ORIGIN ?? '').trim();

  return {
    nodeEnv,
    isProduction,
    port: readInt(env.PORT, 'PORT', 3000, 1, 65535),
    logLevel,
    trustProxy: readBool(env.TRUST_PROXY, 'TRUST_PROXY', isProduction),
    publicOrigin: publicOriginRaw ? normalizeOrigin(publicOriginRaw, 'PUBLIC_ORIGIN') : null,
    databaseUrl: requireNonEmpty(env.DATABASE_URL, 'DATABASE_URL'),
    sessionTtlHours: readInt(env.SESSION_TTL_HOURS, 'SESSION_TTL_HOURS', 12, 1, 720),
    cookieSecure: readBool(env.COOKIE_SECURE, 'COOKIE_SECURE', isProduction),
    uploadMaxMb: readInt(env.UPLOAD_MAX_MB, 'UPLOAD_MAX_MB', 25, 1, 200),
    uploadsDir: readUploadsDir(env.UPLOADS_DIR),
    processingTmpDir: readProcessingTmpDir(env.PROCESSING_TMP_DIR),
    optimizationTimeoutMs:
      readInt(env.OPTIMIZE_TIMEOUT_SECONDS, 'OPTIMIZE_TIMEOUT_SECONDS', 20, 1, 300) * 1000,
    optimizationConcurrency: readInt(env.OPTIMIZE_CONCURRENCY, 'OPTIMIZE_CONCURRENCY', 2, 1, 8),
    rateLimits: {
      loginMax: readInt(env.RATE_LIMIT_LOGIN_MAX, 'RATE_LIMIT_LOGIN_MAX', 10, 1, 10000),
      sensitiveMax: readInt(env.RATE_LIMIT_SENSITIVE_MAX, 'RATE_LIMIT_SENSITIVE_MAX', 20, 1, 10000),
      globalMax: readInt(env.RATE_LIMIT_GLOBAL_MAX, 'RATE_LIMIT_GLOBAL_MAX', 600, 10, 100000),
    },
  };
}
