import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { AppConfig } from '../config.js';
import type { AuthGuards } from '../plugins/auth.js';
import {
  buildBackupExport,
  importBackupData,
  importLegacyData,
  type ImportDocumentInput,
} from '../services/imports.js';

export interface ImportRoutesDeps {
  pool: Pool;
  config: AppConfig;
  guards: AuthGuards;
}

/**
 * مخطط عنصر مستند مستورد: متسامح في البنية (لا يرفض الطلب كاملاً بسبب سجل واحد)،
 * والتحقق الدقيق يتم لكل سجل داخل خدمة الاستيراد مع أسباب رفض واضحة.
 * كل الحدود (الطول/العدد) مطبَّقة لحماية الخادم.
 */
const IMPORT_DOCUMENT_ITEM_SCHEMA = {
  type: 'object',
  properties: {
    legacyId: { type: 'string', maxLength: 100 },
    reference: { type: 'string', maxLength: 300 },
    title: { type: 'string', maxLength: 600 },
    type: { type: 'string', maxLength: 40 },
    date: { type: 'string', maxLength: 40 },
    sender: { type: 'string', maxLength: 300 },
    recipient: { type: 'string', maxLength: 300 },
    status: { type: 'string', maxLength: 60 },
    notes: { type: 'string', maxLength: 5000 },
    createdAt: { type: 'string', maxLength: 40 },
    updatedAt: { type: 'string', maxLength: 40 },
    departmentLegacyId: { type: 'string', maxLength: 100 },
    departmentName: { type: 'string', maxLength: 120 },
  },
  additionalProperties: true,
} as const;

const LEGACY_BODY_SCHEMA = {
  type: 'object',
  additionalProperties: true,
  required: ['departments', 'documents'],
  properties: {
    source: { type: 'string', maxLength: 100 },
    departments: {
      type: 'array',
      maxItems: 500,
      items: {
        type: 'object',
        additionalProperties: true,
        properties: {
          legacyId: { type: 'string', maxLength: 100 },
          name: { type: 'string', maxLength: 120 },
        },
      },
    },
    documents: { type: 'array', maxItems: 5000, items: IMPORT_DOCUMENT_ITEM_SCHEMA },
  },
} as const;

const BACKUP_BODY_SCHEMA = {
  type: 'object',
  additionalProperties: true,
  required: ['documents'],
  properties: {
    formatVersion: { type: 'number' },
    departments: {
      type: 'array',
      maxItems: 500,
      items: {
        type: 'object',
        additionalProperties: true,
        properties: {
          name: { type: 'string', maxLength: 120 },
          isActive: { type: 'boolean' },
        },
      },
    },
    documents: { type: 'array', maxItems: 5000, items: IMPORT_DOCUMENT_ITEM_SCHEMA },
  },
} as const;

function formatDateStamp(date: Date = new Date()): string {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
}

export function registerImportRoutes(app: FastifyInstance, deps: ImportRoutesDeps): void {
  const { pool, config, guards } = deps;

  function contextFor(request: {
    authUser: { id: string; username: string } | null;
    ip: string;
    headers: Record<string, unknown>;
  }): Parameters<typeof importLegacyData>[0] {
    const userAgent = request.headers['user-agent'];
    return {
      pool,
      actorUserId: request.authUser!.id,
      actorUsername: request.authUser!.username,
      ip: request.ip,
      userAgent: typeof userAgent === 'string' && userAgent.length > 0 ? userAgent.slice(0, 500) : null,
    };
  }

  app.post(
    '/imports/legacy',
    {
      preHandler: guards.requireAdmin,
      config: { rateLimit: { max: config.rateLimits.sensitiveMax, timeWindow: '15 minutes' } },
      schema: { body: LEGACY_BODY_SCHEMA },
    },
    async (request) => {
      const body = request.body as {
        source?: string;
        departments: Array<{ legacyId?: string; name: string }>;
        documents: ImportDocumentInput[];
      };
      const outcome = await importLegacyData(contextFor(request), {
        source: body.source?.trim() || 'hl_archive_data_v1',
        departments: body.departments
          .filter((department) => typeof department?.name === 'string' && department.name.trim().length > 0)
          .map((department) => ({
            legacyId: typeof department.legacyId === 'string' ? department.legacyId : null,
            name: department.name.trim(),
          })),
        documents: body.documents,
      });
      return outcome;
    },
  );

  app.post(
    '/imports/backup',
    {
      preHandler: guards.requireAdmin,
      config: { rateLimit: { max: config.rateLimits.sensitiveMax, timeWindow: '15 minutes' } },
      schema: { body: BACKUP_BODY_SCHEMA },
    },
    async (request) => {
      const body = request.body as {
        formatVersion?: number;
        departments?: Array<{ name?: string; isActive?: boolean }>;
        documents: ImportDocumentInput[];
      };
      const outcome = await importBackupData(contextFor(request), {
        formatVersion: typeof body.formatVersion === 'number' ? body.formatVersion : 1,
        departments: (body.departments ?? [])
          .filter((department) => typeof department?.name === 'string' && department.name.trim().length > 0)
          .map((department) => ({
            name: department.name!.trim(),
            isActive: department.isActive !== false,
          })),
        documents: body.documents,
      });
      return outcome;
    },
  );

  app.get('/exports/backup', { preHandler: guards.requireAdmin }, async (_request, reply) => {
    const backup = await buildBackupExport(pool);
    reply.header('Content-Type', 'application/json; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="archive-hlc-backup-${formatDateStamp()}.json"`);
    reply.header('Cache-Control', 'private, no-store');
    return JSON.stringify(backup, null, 2);
  });
}
