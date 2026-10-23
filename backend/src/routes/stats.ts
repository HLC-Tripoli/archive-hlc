import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { resolveDocumentAccessScope } from '../lib/access.js';
import { buildCsv } from '../lib/csv.js';
import { isValidIsoDate } from '../lib/dates.js';
import { ApiError } from '../lib/errors.js';
import { TYPE_LABELS } from '../lib/labels.js';
import { isUuid } from '../lib/validation.js';
import type { AuthGuards } from '../plugins/auth.js';
import {
  DOCUMENT_STATUSES,
  DOCUMENT_TYPES,
  type DocumentTypeDb,
} from '../services/documents.js';
import {
  collectDocumentsForCsv,
  getDashboardStats,
  getReportSummary,
  type ReportSummaryFilters,
} from '../services/stats.js';

export interface StatsRoutesDeps {
  pool: Pool;
  guards: AuthGuards;
}

const REPORT_QUERY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    q: { type: 'string', maxLength: 200 },
    type: { type: 'string', enum: DOCUMENT_TYPES as unknown as string[] },
    // مرشِّح متقاعد: يُقبل للتوافق ولا يؤثر في النتائج.
    status: { type: 'string', enum: DOCUMENT_STATUSES as unknown as string[] },
    departmentId: { type: 'string', maxLength: 64 },
    dateFrom: { type: 'string', maxLength: 10 },
    dateTo: { type: 'string', maxLength: 10 },
  },
} as const;

interface ReportQuery {
  q?: string;
  type?: DocumentTypeDb;
  departmentId?: string;
  dateFrom?: string;
  dateTo?: string;
}

function parseReportFilters(query: ReportQuery): ReportSummaryFilters {
  if (query.dateFrom && !isValidIsoDate(query.dateFrom)) {
    throw ApiError.badRequest('invalid_date_from', 'تاريخ البداية غير صالح.');
  }
  if (query.dateTo && !isValidIsoDate(query.dateTo)) {
    throw ApiError.badRequest('invalid_date_to', 'تاريخ النهاية غير صالح.');
  }
  if (query.departmentId && !isUuid(query.departmentId)) {
    throw ApiError.badRequest('invalid_department', 'معرّف الإدارة غير صالح.');
  }
  return {
    q: query.q?.trim() || undefined,
    type: query.type,
    departmentId: query.departmentId,
    dateFrom: query.dateFrom,
    dateTo: query.dateTo,
  };
}

function formatDateStamp(date: Date = new Date()): string {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
}

export function registerStatsRoutes(app: FastifyInstance, deps: StatsRoutesDeps): void {
  const { pool, guards } = deps;

  app.get('/stats/dashboard', { preHandler: guards.requireAuth }, async (request) => {
    const access = resolveDocumentAccessScope(request.authUser!);
    return getDashboardStats(pool, access);
  });

  app.get(
    '/reports/summary',
    { preHandler: guards.requireAuth, schema: { querystring: REPORT_QUERY_SCHEMA } },
    async (request) => {
      const access = resolveDocumentAccessScope(request.authUser!);
      return getReportSummary(pool, parseReportFilters(request.query as ReportQuery), access);
    },
  );

  app.get(
    '/reports/documents.csv',
    { preHandler: guards.requireAuth, schema: { querystring: REPORT_QUERY_SCHEMA } },
    async (request, reply) => {
      const access = resolveDocumentAccessScope(request.authUser!);
      const rows = await collectDocumentsForCsv(
        pool,
        parseReportFilters(request.query as ReportQuery),
        10_000,
        access,
      );
      const csv = buildCsv([
        [
          'الرقم الاشاري',
          'رقم التسلسل',
          'موضوع الرسالة',
          'النوع',
          'تاريخ الرسالة',
          'من',
          'إلى',
          'الإدارة',
          'الملاحظات',
          'عدد المرفقات',
          'تاريخ الإنشاء',
        ],
        ...rows.map((row) => [
          row.reference,
          row.sequence_number ?? '',
          row.title,
          TYPE_LABELS[row.type] ?? row.type,
          row.date,
          row.sender,
          row.recipient,
          row.department,
          row.notes,
          row.files_count,
          row.created_at.toISOString().slice(0, 10),
        ]),
      ]);

      reply.header('Content-Type', 'text/csv; charset=utf-8');
      reply.header('Content-Disposition', `attachment; filename="archive-report-${formatDateStamp()}.csv"`);
      reply.header('Cache-Control', 'private, no-store');
      return csv;
    },
  );
}
