import { ConfigError } from './lib/errors.js';

export type NodeEnv = 'development' | 'production' | 'test';

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  forcePathStyle: boolean;
  keyPrefix: string;
}

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
  s3: S3Config | null;
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

function readS3Config(env: NodeJS.ProcessEnv): S3Config | null {
  const endpoint = (env.S3_ENDPOINT ?? '').trim();
  const bucket = (env.S3_BUCKET ?? '').trim();
  const accessKey = (env.S3_ACCESS_KEY ?? '').trim();
  const secretKey = (env.S3_SECRET_KEY ?? '').trim();
  const provided = [endpoint, bucket, accessKey, secretKey].filter((v) => v !== '');
  if (provided.length === 0) return null;
  if (provided.length !== 4) {
    throw new ConfigError(
      'Incomplete S3 configuration: S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY and S3_SECRET_KEY must all be set (or all omitted)',
    );
  }
  const normalizedEndpoint = normalizeOrigin(endpoint, 'S3_ENDPOINT');
  const keyPrefixRaw = (env.S3_KEY_PREFIX ?? 'archive').trim().replace(/^\/+|\/+$/g, '');
  return {
    endpoint: normalizedEndpoint,
    region: (env.S3_REGION ?? 'us-east-1').trim() || 'us-east-1',
    bucket,
    accessKey,
    secretKey,
    forcePathStyle: readBool(env.S3_FORCE_PATH_STYLE, 'S3_FORCE_PATH_STYLE', true),
    keyPrefix: keyPrefixRaw,
  };
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
  const s3 = readS3Config(env);

  if (isProduction && s3 === null) {
    throw new ConfigError(
      'In production the attachment storage must be configured: set S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY and S3_SECRET_KEY',
    );
  }

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
    s3,
    rateLimits: {
      loginMax: readInt(env.RATE_LIMIT_LOGIN_MAX, 'RATE_LIMIT_LOGIN_MAX', 10, 1, 10000),
      sensitiveMax: readInt(env.RATE_LIMIT_SENSITIVE_MAX, 'RATE_LIMIT_SENSITIVE_MAX', 20, 1, 10000),
      globalMax: readInt(env.RATE_LIMIT_GLOBAL_MAX, 'RATE_LIMIT_GLOBAL_MAX', 600, 10, 100000),
    },
  };
}
