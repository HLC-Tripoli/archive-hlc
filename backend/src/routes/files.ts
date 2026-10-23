import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import type { AppConfig } from '../config.js';
import { resolveDocumentAccessScope } from '../lib/access.js';
import { ApiError } from '../lib/errors.js';
import { isUuid } from '../lib/validation.js';
import type { AuthGuards } from '../plugins/auth.js';
import { writeAudit } from '../services/audit.js';
import type { AttachmentOptimizer } from '../services/optimization/optimizer.js';
import {
  attachmentContentDisposition,
  deleteFileRow,
  getFileWithDocument,
  inlineContentDisposition,
  isInlinePreviewable,
  storeAttachment,
  type StoredFileWithDocument,
} from '../services/files.js';
import type { StorageProvider } from '../services/storage/types.js';

export interface FileRoutesDeps {
  pool: Pool;
  guards: AuthGuards;
  storage: StorageProvider;
  config: AppConfig;
  optimizer: AttachmentOptimizer;
}

const ID_PARAMS_SCHEMA = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', maxLength: 64 } },
} as const;

/**
 * حماية من سجلات قديمة تشير إلى مزوّد تخزين آخر (مثل s3 من نسخة سابقة):
 * نرفض العملية برسالة واضحة بدلاً من تفسير مفتاحها القديم كمسار محلي
 * أو حذف سطر قاعدة البيانات دون حذف الكائن الفعلي.
 */
function assertSupportedProvider(
  request: FastifyRequest,
  file: StoredFileWithDocument['file'],
  storage: StorageProvider,
): void {
  if (file.storageProvider === storage.name) return;
  request.log.warn(
    { fileId: file.id, storedProvider: file.storageProvider, activeProvider: storage.name },
    'attachment references an unsupported storage provider',
  );
  throw ApiError.conflict(
    'unsupported_storage_provider',
    'هذا المرفق مخزَّن بمزوّد تخزين غير مدعوم في هذه النسخة من النظام. راجع مسؤول النظام.',
  );
}

export function registerFileRoutes(app: FastifyInstance, deps: FileRoutesDeps): void {
  const { pool, guards, storage, config, optimizer } = deps;

  app.post(
    '/documents/:id/files',
    { preHandler: guards.requireAuth, schema: { params: ID_PARAMS_SCHEMA } },
    async (request, reply) => {
      const access = resolveDocumentAccessScope(request.authUser!);
      const { id: documentId } = request.params as { id: string };
      if (!isUuid(documentId)) throw ApiError.notFound('المعاملة غير موجودة.');

      // نطاق الموظف شرط في استعلام المعاملة الأم نفسه، فلا يكفي إخفاء المرفق
      // في الواجهة أو الاعتماد على فحص سابق منفصل.
      const document = await pool.query<{ id: string; deleted_at: Date | null }>(
        `SELECT id, deleted_at
           FROM documents
          WHERE id = $1
            AND ($2::boolean OR department_id = $3)`,
        [documentId, access.isAdmin, access.departmentId],
      );
      const documentRow = document.rows[0];
      if (!documentRow) throw ApiError.notFound('المعاملة غير موجودة.');
      if (documentRow.deleted_at) {
        throw ApiError.conflict('deleted_document', 'لا يمكن إضافة مرفقات إلى معاملة محذوفة.');
      }

      if (!request.isMultipart()) {
        throw ApiError.badRequest('invalid_content_type', 'يجب إرسال الملف باستخدام multipart/form-data.');
      }
      const data = await request.file();
      if (!data) {
        throw ApiError.badRequest('missing_file', 'لم يتم إرسال أي ملف.');
      }

      const record = await storeAttachment(
        { pool, storage, config, optimizer, logger: request.log },
        {
          documentId,
          userId: request.authUser!.id,
          access,
          stream: data.file,
          filename: data.filename,
          declaredMimeType: data.mimetype,
        },
      );

      await writeAudit(
        pool,
        {
          actorUserId: request.authUser!.id,
          actorUsername: request.authUser!.username,
          action: 'file.uploaded',
          entityType: 'document_file',
          entityId: record.id,
          details: {
            documentId,
            name: record.originalName,
            size: record.sizeBytes,
            mimeType: record.mimeType,
          },
        },
        { ip: request.ip, userAgent: (request.headers['user-agent'] ?? '') || null },
      );

      reply.code(201);
      return {
        file: {
          id: record.id,
          originalName: record.originalName,
          mimeType: record.mimeType,
          sizeBytes: record.sizeBytes,
          checksumSha256: record.checksumSha256,
          createdAt: record.createdAt,
        },
      };
    },
  );

  app.get(
    '/files/:id/download',
    { preHandler: guards.requireAuth, schema: { params: ID_PARAMS_SCHEMA } },
    async (request, reply) => {
      const access = resolveDocumentAccessScope(request.authUser!);
      const { id } = request.params as { id: string };
      if (!isUuid(id)) throw ApiError.notFound('الملف غير موجود.');

      const found = await getFileWithDocument(pool, id, access);
      if (!found) throw ApiError.notFound('الملف غير موجود.');
      if (found.document.deletedAt && !access.isAdmin) {
        throw ApiError.notFound('الملف غير موجود.');
      }
      assertSupportedProvider(request, found.file, storage);

      const object = await storage.getObject(found.file.storageKey);

      await writeAudit(
        pool,
        {
          actorUserId: request.authUser!.id,
          actorUsername: request.authUser!.username,
          action: 'file.downloaded',
          entityType: 'document_file',
          entityId: id,
          details: { documentId: found.document.id, name: found.file.originalName },
        },
        { ip: request.ip, userAgent: (request.headers['user-agent'] ?? '') || null },
      );

      reply.header('Content-Type', found.file.mimeType || object.contentType || 'application/octet-stream');
      reply.header('Content-Length', String(object.contentLength ?? found.file.sizeBytes));
      reply.header('Content-Disposition', attachmentContentDisposition(found.file.originalName));
      reply.header('Cache-Control', 'private, no-store');
      reply.header('X-Content-Type-Options', 'nosniff');
      return reply.send(object.body);
    },
  );

  app.get(
    '/files/:id/view',
    { preHandler: guards.requireAuth, schema: { params: ID_PARAMS_SCHEMA } },
    async (request, reply) => {
      const access = resolveDocumentAccessScope(request.authUser!);
      const { id } = request.params as { id: string };
      if (!isUuid(id)) throw ApiError.notFound('الملف غير موجود.');

      const found = await getFileWithDocument(pool, id, access);
      if (!found) throw ApiError.notFound('الملف غير موجود.');
      if (found.document.deletedAt && !access.isAdmin) {
        throw ApiError.notFound('الملف غير موجود.');
      }
      assertSupportedProvider(request, found.file, storage);
      if (!isInlinePreviewable(found.file.mimeType)) {
        throw new ApiError(
          415,
          'unsupported_preview',
          'لا يمكن عرض هذا النوع من الملفات داخل المتصفح. استخدم زر التنزيل.',
        );
      }

      const object = await storage.getObject(found.file.storageKey);

      await writeAudit(
        pool,
        {
          actorUserId: request.authUser!.id,
          actorUsername: request.authUser!.username,
          action: 'file.viewed',
          entityType: 'document_file',
          entityId: id,
          details: { documentId: found.document.id, name: found.file.originalName },
        },
        { ip: request.ip, userAgent: (request.headers['user-agent'] ?? '') || null },
      );

      reply.header('Content-Type', found.file.mimeType || object.contentType || 'application/octet-stream');
      reply.header('Content-Length', String(object.contentLength ?? found.file.sizeBytes));
      reply.header('Content-Disposition', inlineContentDisposition(found.file.originalName));
      reply.header('Cache-Control', 'private, no-store');
      reply.header('X-Content-Type-Options', 'nosniff');
      return reply.send(object.body);
    },
  );

  app.delete(
    '/files/:id',
    { preHandler: guards.requireAuth, schema: { params: ID_PARAMS_SCHEMA } },
    async (request) => {
      const access = resolveDocumentAccessScope(request.authUser!);
      const { id } = request.params as { id: string };
      if (!isUuid(id)) throw ApiError.notFound('الملف غير موجود.');

      // getFileWithDocument يقيّد الموظف بإدارته النشطة؛ المدير عام.
      // الموظف لا يرى مرفقات مستند محذوف، ويبقى الحذف متاحاً للمدير فقط
      // في سلة المحذوفات (سلوك إداري قائم).
      const found = await getFileWithDocument(pool, id, access);
      if (!found) throw ApiError.notFound('الملف غير موجود.');
      if (found.document.deletedAt && !access.isAdmin) {
        throw ApiError.notFound('الملف غير موجود.');
      }
      assertSupportedProvider(request, found.file, storage);

      // نحذف الكائن من التخزين أولاً؛ إذا فشل الحذف نُبقي السجل كي لا يبقى الكائن يتيماً.
      await storage.deleteObject(found.file.storageKey);
      const deleted = await deleteFileRow(pool, id);
      if (!deleted) throw ApiError.notFound('الملف غير موجود.');

      await writeAudit(
        pool,
        {
          actorUserId: request.authUser!.id,
          actorUsername: request.authUser!.username,
          action: 'file.deleted',
          entityType: 'document_file',
          entityId: id,
          details: {
            documentId: found.document.id,
            name: found.file.originalName,
            size: found.file.sizeBytes,
          },
        },
        { ip: request.ip, userAgent: (request.headers['user-agent'] ?? '') || null },
      );
      return { ok: true };
    },
  );
}
