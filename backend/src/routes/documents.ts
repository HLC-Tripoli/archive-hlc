import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { withTransaction } from '../db/pool.js';
import { isValidIsoDate } from '../lib/dates.js';
import { ApiError } from '../lib/errors.js';
import { isUuid } from '../lib/validation.js';
import type { AuthGuards } from '../plugins/auth.js';
import { writeAudit, type AuditContext } from '../services/audit.js';
import { getDepartmentById } from '../services/departments.js';
import {
  DOCUMENT_STATUSES,
  DOCUMENT_TYPES,
  getDocumentById,
  insertDocument,
  listDocuments,
  restoreDocument,
  softDeleteDocument,
  updateDocument,
  type DocumentInput,
  type DocumentPatch,
  type DocumentStatus,
  type DocumentTypeDb,
} from '../services/documents.js';

export interface DocumentRoutesDeps {
  pool: Pool;
  guards: AuthGuards;
}

const BODY_PROPERTIES = {
  reference: { type: 'string', minLength: 1, maxLength: 200 },
  title: { type: 'string', minLength: 1, maxLength: 500 },
  type: { type: 'string', enum: DOCUMENT_TYPES as unknown as string[] },
  date: { type: 'string', maxLength: 10 },
  sender: { type: 'string', maxLength: 200 },
  recipient: { type: 'string', maxLength: 200 },
  departmentId: { anyOf: [{ type: 'string', maxLength: 64 }, { type: 'null' }] },
  status: { type: 'string', enum: DOCUMENT_STATUSES as unknown as string[] },
  notes: { type: 'string', maxLength: 4000 },
} as const;

const LIST_QUERY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    q: { type: 'string', maxLength: 200 },
    type: { type: 'string', enum: DOCUMENT_TYPES as unknown as string[] },
    status: { type: 'string', enum: DOCUMENT_STATUSES as unknown as string[] },
    departmentId: { type: 'string', maxLength: 64 },
    dateFrom: { type: 'string', maxLength: 10 },
    dateTo: { type: 'string', maxLength: 10 },
    includeDeleted: { type: 'boolean', default: false },
    sort: { type: 'string', enum: ['date', 'createdAt', 'updatedAt', 'reference', 'title'], default: 'date' },
    order: { type: 'string', enum: ['asc', 'desc'], default: 'desc' },
    page: { type: 'integer', minimum: 1, default: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
  },
} as const;

const ID_PARAMS_SCHEMA = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', maxLength: 64 } },
} as const;

interface DocumentListQuery {
  q?: string;
  type?: DocumentTypeDb;
  status?: DocumentStatus;
  departmentId?: string;
  dateFrom?: string;
  dateTo?: string;
  includeDeleted: boolean;
  sort: 'date' | 'createdAt' | 'updatedAt' | 'reference' | 'title';
  order: 'asc' | 'desc';
  page: number;
  pageSize: number;
}

function auditContextOf(request: {
  ip: string;
  headers: Record<string, unknown>;
}): AuditContext {
  const userAgent = request.headers['user-agent'];
  return {
    ip: request.ip,
    userAgent: typeof userAgent === 'string' && userAgent.length > 0 ? userAgent.slice(0, 500) : null,
  };
}

export function registerDocumentRoutes(app: FastifyInstance, deps: DocumentRoutesDeps): void {
  const { pool, guards } = deps;

  app.get(
    '/documents',
    { preHandler: guards.requireAuth, schema: { querystring: LIST_QUERY_SCHEMA } },
    async (request) => {
      const query = request.query as DocumentListQuery;
      if (query.dateFrom && !isValidIsoDate(query.dateFrom)) {
        throw ApiError.badRequest('invalid_date_from', 'تاريخ البداية غير صالح.');
      }
      if (query.dateTo && !isValidIsoDate(query.dateTo)) {
        throw ApiError.badRequest('invalid_date_to', 'تاريخ النهاية غير صالح.');
      }
      if (query.departmentId && !isUuid(query.departmentId)) {
        throw ApiError.badRequest('invalid_department', 'معرّف الإدارة غير صالح.');
      }
      const includeDeleted = request.authUser!.role === 'admin' ? query.includeDeleted : false;

      const result = await listDocuments(pool, {
        q: query.q?.trim() || undefined,
        type: query.type,
        status: query.status,
        departmentId: query.departmentId,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
        includeDeleted,
        sort: query.sort,
        order: query.order,
        page: query.page,
        pageSize: query.pageSize,
      });
      return { items: result.items, total: result.total, page: query.page, pageSize: query.pageSize };
    },
  );

  app.get(
    '/documents/:id',
    { preHandler: guards.requireAuth, schema: { params: ID_PARAMS_SCHEMA } },
    async (request) => {
      const { id } = request.params as { id: string };
      if (!isUuid(id)) throw ApiError.notFound('المعاملة غير موجودة.');
      const document = await getDocumentById(pool, id);
      if (!document) throw ApiError.notFound('المعاملة غير موجودة.');
      if (document.deletedAt && request.authUser!.role !== 'admin') {
        throw ApiError.notFound('المعاملة غير موجودة.');
      }
      return { document };
    },
  );

  app.post(
    '/documents',
    {
      preHandler: guards.requireAuth,
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['reference', 'title', 'type', 'date'],
          properties: BODY_PROPERTIES,
        },
      },
    },
    async (request, reply) => {
      const body = request.body as Partial<DocumentInput> & {
        reference: string;
        title: string;
        type: DocumentTypeDb;
        date: string;
      };
      if (!isValidIsoDate(body.date)) {
        throw ApiError.badRequest('invalid_date', 'تاريخ المعاملة غير صالح. استخدم الصيغة YYYY-MM-DD.');
      }
      const reference = body.reference.trim();
      const title = body.title.trim();
      if (!reference || !title) {
        throw ApiError.badRequest('missing_fields', 'رقم المعاملة والعنوان مطلوبان.');
      }
      if (body.departmentId) {
        if (!isUuid(body.departmentId)) {
          throw ApiError.badRequest('invalid_department', 'معرّف الإدارة غير صالح.');
        }
        const department = await getDepartmentById(pool, body.departmentId);
        if (!department) throw ApiError.badRequest('invalid_department', 'الإدارة المحددة غير موجودة.');
      }

      const userId = request.authUser!.id;
      const id = await withTransaction(pool, async (client) => {
        const createdId = await insertDocument(
          client,
          {
            reference,
            title,
            type: body.type,
            date: body.date,
            sender: (body.sender ?? '').trim(),
            recipient: (body.recipient ?? '').trim(),
            departmentId: body.departmentId ?? null,
            status: body.status ?? 'new',
            notes: (body.notes ?? '').trim(),
          },
          userId,
        );
        await writeAudit(
          client,
          {
            actorUserId: userId,
            actorUsername: request.authUser!.username,
            action: 'document.created',
            entityType: 'document',
            entityId: createdId,
            details: { reference, title, type: body.type },
          },
          auditContextOf(request),
        );
        return createdId;
      });

      const document = await getDocumentById(pool, id);
      reply.code(201);
      return { document };
    },
  );

  app.patch(
    '/documents/:id',
    {
      preHandler: guards.requireAuth,
      schema: {
        params: ID_PARAMS_SCHEMA,
        body: {
          type: 'object',
          additionalProperties: false,
          minProperties: 1,
          properties: BODY_PROPERTIES,
        },
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      if (!isUuid(id)) throw ApiError.notFound('المعاملة غير موجودة.');
      const body = request.body as Partial<DocumentInput>;

      if (body.date !== undefined && !isValidIsoDate(body.date)) {
        throw ApiError.badRequest('invalid_date', 'تاريخ المعاملة غير صالح. استخدم الصيغة YYYY-MM-DD.');
      }
      if (body.departmentId !== undefined && body.departmentId !== null) {
        if (!isUuid(body.departmentId)) {
          throw ApiError.badRequest('invalid_department', 'معرّف الإدارة غير صالح.');
        }
        const department = await getDepartmentById(pool, body.departmentId);
        if (!department) throw ApiError.badRequest('invalid_department', 'الإدارة المحددة غير موجودة.');
      }

      const existing = await getDocumentById(pool, id);
      if (!existing || existing.deletedAt) {
        if (!existing) throw ApiError.notFound('المعاملة غير موجودة.');
        throw ApiError.conflict('deleted_document', 'لا يمكن تعديل معاملة محذوفة. يمكنك استعادتها أولاً.');
      }

      const patch: DocumentPatch = {};
      if (body.reference !== undefined) patch.reference = body.reference.trim();
      if (body.title !== undefined) patch.title = body.title.trim();
      if (body.type !== undefined) patch.type = body.type;
      if (body.date !== undefined) patch.date = body.date;
      if (body.sender !== undefined) patch.sender = body.sender.trim();
      if (body.recipient !== undefined) patch.recipient = body.recipient.trim();
      if (body.departmentId !== undefined) patch.departmentId = body.departmentId;
      if (body.status !== undefined) patch.status = body.status;
      if (body.notes !== undefined) patch.notes = body.notes.trim();
      if (patch.reference !== undefined && !patch.reference) {
        throw ApiError.badRequest('invalid_reference', 'رقم المعاملة مطلوب.');
      }
      if (patch.title !== undefined && !patch.title) {
        throw ApiError.badRequest('invalid_title', 'عنوان المعاملة مطلوب.');
      }

      const userId = request.authUser!.id;
      const result = await withTransaction(pool, async (client) => {
        const updateResult = await updateDocument(client, id, patch, userId);
        if (updateResult.status === 'not_found') throw ApiError.notFound('المعاملة غير موجودة.');
        if (updateResult.status === 'deleted') {
          throw ApiError.conflict('deleted_document', 'لا يمكن تعديل معاملة محذوفة. يمكنك استعادتها أولاً.');
        }
        await writeAudit(
          client,
          {
            actorUserId: userId,
            actorUsername: request.authUser!.username,
            action: 'document.updated',
            entityType: 'document',
            entityId: id,
            details: { changedFields: updateResult.changedFields },
          },
          auditContextOf(request),
        );
        return updateResult;
      });

      const document = await getDocumentById(pool, id);
      return { document, changedFields: result.changedFields };
    },
  );

  app.delete(
    '/documents/:id',
    { preHandler: guards.requireAdmin, schema: { params: ID_PARAMS_SCHEMA } },
    async (request) => {
      const { id } = request.params as { id: string };
      if (!isUuid(id)) throw ApiError.notFound('المعاملة غير موجودة.');
      const userId = request.authUser!.id;
      const outcome = await withTransaction(pool, async (client) => {
        const result = await softDeleteDocument(client, id, userId);
        if (result === 'not_found') throw ApiError.notFound('المعاملة غير موجودة.');
        if (result === 'already_deleted') {
          throw ApiError.conflict('already_deleted', 'المعاملة محذوفة مسبقاً.');
        }
        await writeAudit(
          client,
          {
            actorUserId: userId,
            actorUsername: request.authUser!.username,
            action: 'document.deleted',
            entityType: 'document',
            entityId: id,
            details: {},
          },
          auditContextOf(request),
        );
        return result;
      });
      return { ok: true, outcome };
    },
  );

  app.post(
    '/documents/:id/restore',
    { preHandler: guards.requireAdmin, schema: { params: ID_PARAMS_SCHEMA } },
    async (request) => {
      const { id } = request.params as { id: string };
      if (!isUuid(id)) throw ApiError.notFound('المعاملة غير موجودة.');
      const userId = request.authUser!.id;
      const outcome = await withTransaction(pool, async (client) => {
        const result = await restoreDocument(client, id, userId);
        if (result === 'not_found') throw ApiError.notFound('المعاملة غير موجودة.');
        if (result === 'not_deleted') throw ApiError.conflict('not_deleted', 'المعاملة غير محذوفة أصلاً.');
        if (result === 'conflict') {
          throw ApiError.conflict(
            'restore_conflict',
            'تعذّرت الاستعادة: يوجد مستند نشط آخر بنفس رقم المعاملة.',
          );
        }
        await writeAudit(
          client,
          {
            actorUserId: userId,
            actorUsername: request.authUser!.username,
            action: 'document.restored',
            entityType: 'document',
            entityId: id,
            details: {},
          },
          auditContextOf(request),
        );
        return result;
      });
      const document = await getDocumentById(pool, id);
      return { document, outcome };
    },
  );
}
