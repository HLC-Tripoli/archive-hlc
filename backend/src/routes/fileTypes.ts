import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { ApiError } from '../lib/errors.js';
import type { AuthGuards } from '../plugins/auth.js';
import { writeAudit, type AuditContext } from '../services/audit.js';
import {
  addFileType,
  deleteFileType,
  getActiveAllowedExtensions,
  getActiveFileTypes,
  getAllFileTypes,
  resetFileTypesToDefault,
  sanitizeExtension,
  toggleFileType,
} from '../services/fileTypes.js';

export interface FileTypeRoutesDeps {
  pool: Pool;
  guards: AuthGuards;
}

const EXTENSION_PARAMS_SCHEMA = {
  type: 'object',
  required: ['extension'],
  properties: {
    extension: { type: 'string', minLength: 1, maxLength: 16 },
  },
  additionalProperties: false,
} as const;

function extractAuditContext(request: FastifyRequest): AuditContext {
  return {
    ip: request.ip,
    userAgent: (request.headers['user-agent'] ?? '') || null,
  };
}

export function registerFileTypeRoutes(app: FastifyInstance, deps: FileTypeRoutesDeps): void {
  const { pool, guards } = deps;

  // مسار استرجاع الصيغ المفعلة فقط (متاح لأي مستخدم مصادق عليه لتحديث واجهة الرفع)
  app.get(
    '/file-types',
    { preHandler: guards.requireAuth },
    async () => {
      const active = await getActiveFileTypes(pool);
      const extensions = await getActiveAllowedExtensions(pool);
      return {
        items: active,
        extensions,
        acceptString: extensions.map((e) => `.${e}`).join(','),
      };
    },
  );

  // استرجاع كافة الصيغ (للمدير فقط)
  app.get(
    '/settings/file-types',
    { preHandler: [guards.requireAuth, guards.requireAdmin] },
    async () => {
      const items = await getAllFileTypes(pool);
      return { items };
    },
  );

  // إضافة صيغة جديدة (للمدير فقط)
  app.post(
    '/settings/file-types',
    {
      preHandler: [guards.requireAuth, guards.requireAdmin],
      schema: {
        body: {
          type: 'object',
          required: ['extension', 'mimeType'],
          properties: {
            extension: { type: 'string', minLength: 1, maxLength: 16 },
            mimeType: { type: 'string', minLength: 3, maxLength: 128 },
            category: { type: 'string', maxLength: 32 },
            labelAr: { type: 'string', maxLength: 64 },
            labelEn: { type: 'string', maxLength: 64 },
            isEnabled: { type: 'boolean' },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const body = request.body as {
        extension: string;
        mimeType: string;
        category?: string;
        labelAr?: string;
        labelEn?: string;
        isEnabled?: boolean;
      };

      const fileType = await addFileType(pool, body);

      await writeAudit(
        pool,
        {
          actorUserId: request.authUser!.id,
          actorUsername: request.authUser!.username,
          action: 'file_type.created',
          entityType: 'file_type',
          entityId: fileType.extension,
          details: {
            extension: fileType.extension,
            mimeType: fileType.mimeType,
            category: fileType.category,
            labelAr: fileType.labelAr,
            labelEn: fileType.labelEn,
            isEnabled: fileType.isEnabled,
          },
        },
        extractAuditContext(request),
      );

      reply.code(201);
      return { fileType };
    },
  );

  // تفعيل أو تعطيل صيغة معينة (للمدير فقط)
  app.patch(
    '/settings/file-types/:extension',
    {
      preHandler: [guards.requireAuth, guards.requireAdmin],
      schema: {
        params: EXTENSION_PARAMS_SCHEMA,
        body: {
          type: 'object',
          required: ['isEnabled'],
          properties: {
            isEnabled: { type: 'boolean' },
          },
          additionalProperties: false,
        },
      },
    },
    async (request) => {
      const { extension } = request.params as { extension: string };
      const body = request.body as { isEnabled: boolean };

      const fileType = await toggleFileType(pool, extension, body.isEnabled);
      if (!fileType) {
        throw ApiError.notFound('صيغة الملف غير موجودة في النظام.');
      }

      await writeAudit(
        pool,
        {
          actorUserId: request.authUser!.id,
          actorUsername: request.authUser!.username,
          action: 'file_type.updated',
          entityType: 'file_type',
          entityId: fileType.extension,
          details: {
            extension: fileType.extension,
            isEnabled: fileType.isEnabled,
          },
        },
        extractAuditContext(request),
      );

      return { fileType };
    },
  );

  // حذف صيغة ملف (للمدير فقط)
  app.delete(
    '/settings/file-types/:extension',
    {
      preHandler: [guards.requireAuth, guards.requireAdmin],
      schema: {
        params: EXTENSION_PARAMS_SCHEMA,
      },
    },
    async (request) => {
      const { extension } = request.params as { extension: string };
      const cleanExt = sanitizeExtension(extension);

      const deleted = await deleteFileType(pool, cleanExt);
      if (!deleted) {
        throw ApiError.notFound('صيغة الملف غير موجودة.');
      }

      await writeAudit(
        pool,
        {
          actorUserId: request.authUser!.id,
          actorUsername: request.authUser!.username,
          action: 'file_type.deleted',
          entityType: 'file_type',
          entityId: cleanExt,
        },
        extractAuditContext(request),
      );

      return { success: true, extension: cleanExt };
    },
  );

  // استعادة الصيغ الافتراضية الأصلية (للمدير فقط)
  app.post(
    '/settings/file-types/reset',
    {
      preHandler: [guards.requireAuth, guards.requireAdmin],
    },
    async (request) => {
      const items = await resetFileTypesToDefault(pool);

      await writeAudit(
        pool,
        {
          actorUserId: request.authUser!.id,
          actorUsername: request.authUser!.username,
          action: 'file_type.reset',
          entityType: 'file_type',
          entityId: 'all',
          details: { count: items.length },
        },
        extractAuditContext(request),
      );

      return { items };
    },
  );
}
