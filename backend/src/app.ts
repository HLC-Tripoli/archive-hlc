import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { AppConfig } from './config.js';
import { ApiError, pgErrorToApiError } from './lib/errors.js';
import { isOriginAllowed } from './lib/http.js';
import { buildAuthGuards } from './plugins/auth.js';
import { registerAuditRoutes } from './routes/audit.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerDepartmentRoutes } from './routes/departments.js';
import { registerDocumentRoutes } from './routes/documents.js';
import { registerFileRoutes } from './routes/files.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerImportRoutes } from './routes/imports.js';
import { registerStatsRoutes } from './routes/stats.js';
import { registerUserRoutes } from './routes/users.js';
import {
  createAttachmentOptimizer,
  type AttachmentOptimizer,
} from './services/optimization/optimizer.js';
import type { StorageProvider } from './services/storage/types.js';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface AppDeps {
  config: AppConfig;
  pool: Pool;
  storage: StorageProvider;
  /** حقن محسّن بديل في الاختبارات؛ الإنتاج يستخدم المحسّن الافتراضي. */
  optimizer?: AttachmentOptimizer;
}

interface FastifyErrorLike {
  validation?: Array<{ instancePath?: string; message?: string }>;
  statusCode?: number;
  code?: string;
  message?: string;
  cause?: unknown;
}

function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;

  const pgMapped = pgErrorToApiError(error);
  if (pgMapped) return pgMapped;

  const fastifyError = (typeof error === 'object' && error !== null ? error : {}) as FastifyErrorLike;

  if (Array.isArray(fastifyError.validation)) {
    return ApiError.badRequest('validation_error', 'البيانات المرسلة غير صالحة.', {
      issues: fastifyError.validation.slice(0, 20).map((issue) => ({
        field: issue.instancePath ?? '',
        message: issue.message ?? '',
      })),
    });
  }

  switch (fastifyError.code) {
    case 'FST_REQ_FILE_TOO_LARGE':
    case 'FST_ERR_CTP_BODY_TOO_LARGE':
      return ApiError.payloadTooLarge();
    case 'FST_ERR_CTP_INVALID_MEDIA_TYPE':
      return new ApiError(415, 'unsupported_media_type', 'نوع المحتوى المرسل غير مدعوم.');
    case 'FST_ERR_CTP_EMPTY_JSON_BODY':
      return ApiError.badRequest('empty_body', 'الطلب لا يحتوي على بيانات.');
    default:
      break;
  }

  const statusCode = typeof fastifyError.statusCode === 'number' ? fastifyError.statusCode : 500;
  if (statusCode === 429) {
    return new ApiError(429, 'rate_limited', 'تم تجاوز عدد المحاولات المسموح. أعد المحاولة لاحقاً.');
  }
  if (statusCode >= 400 && statusCode < 500) {
    return new ApiError(statusCode, fastifyError.code ?? 'bad_request', 'تعذّر تنفيذ الطلب.');
  }
  return new ApiError(500, 'internal_error', 'حدث خطأ داخلي غير متوقع. حاول مرة أخرى لاحقاً.');
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { config, pool, storage } = deps;
  const optimizer =
    deps.optimizer ??
    createAttachmentOptimizer({
      concurrency: config.optimizationConcurrency,
      tmpDir: config.processingTmpDir,
    });

  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: {
        paths: [
          'req.headers.cookie',
          'req.headers.authorization',
          "req.headers['x-csrf-token']",
          'res.headers["set-cookie"]',
        ],
        censor: '[redacted]',
      },
    },
    trustProxy: config.trustProxy,
    bodyLimit: 10 * 1024 * 1024,
    // إبقاء removeAdditional معطّلاً: أي حقل غير معروف في مخططات JSON يجب أن يُرفض بـ 400
    // بدلاً من حذفه بصمت (حماية من تمرير حقول غير مقصودة كحقن بيانات).
    ajv: { customOptions: { removeAdditional: false } },
  });

  await app.register(cookie);
  await app.register(rateLimit, {
    global: true,
    max: config.rateLimits.globalMax,
    timeWindow: '1 minute',
    errorResponseBuilder: (_request, context) =>
      new ApiError(
        429,
        'rate_limited',
        `تم تجاوز عدد الطلبات المسموح. أعد المحاولة بعد ${Math.ceil(context.ttl / 1000)} ثانية.`,
      ),
  });
  await app.register(multipart, {
    limits: {
      fileSize: config.uploadMaxMb * 1024 * 1024,
      files: 1,
      fields: 5,
      parts: 8,
    },
  });

  const guards = buildAuthGuards({ pool, config });

  // حماية المصدر: تُرفض الطلبات المتغيّرة القادمة من أصل مختلف (دفاع إضافي فوق SameSite و CSRF).
  app.addHook('onRequest', async (request) => {
    if (!MUTATING_METHODS.has(request.method)) return;
    const allowed = isOriginAllowed(
      {
        origin: request.headers.origin,
        referer: request.headers.referer,
        host: request.headers.host,
        protocol: request.protocol,
      },
      config,
    );
    if (!allowed) {
      throw new ApiError(403, 'origin_not_allowed', 'الطلب قادم من مصدر غير مسموح.');
    }
  });

  // تحميل الجلسة لكل الطلبات (إن وُجدت)؛ الفرض الفعلي يتم في معالجات المسارات المحمية.
  app.addHook('preHandler', async (request) => {
    await guards.loadUser(request);
  });

  app.setErrorHandler((error, request, reply) => {
    const apiError = toApiError(error);
    if (apiError.statusCode >= 500) {
      request.log.error({ err: error, cause: (error as FastifyErrorLike | null)?.cause }, 'request failed');
    }
    const body: { error: { code: string; message: string; details?: unknown } } = {
      error: { code: apiError.code, message: apiError.message },
    };
    if (apiError.details !== undefined) body.error.details = apiError.details;
    reply.code(apiError.statusCode).send(body);
  });

  app.setNotFoundHandler((_request, reply) => {
    reply.code(404).send({ error: { code: 'not_found', message: 'المسار المطلوب غير موجود.' } });
  });

  await app.register(
    async (instance) => {
      registerHealthRoutes(instance, { pool, storage });
      registerAuthRoutes(instance, { pool, config, guards });
      registerUserRoutes(instance, { pool, config, guards });
      registerDepartmentRoutes(instance, { pool, guards });
      registerDocumentRoutes(instance, { pool, guards });
      registerFileRoutes(instance, { pool, guards, storage, config, optimizer });
      registerStatsRoutes(instance, { pool, guards });
      registerAuditRoutes(instance, { pool, guards });
      registerImportRoutes(instance, { pool, config, guards });
    },
    { prefix: '/api/v1' },
  );

  return app;
}
