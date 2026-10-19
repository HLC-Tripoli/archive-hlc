import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { isValidIsoDate } from '../lib/dates.js';
import { ApiError } from '../lib/errors.js';
import { isUuid } from '../lib/validation.js';
import type { AuthGuards } from '../plugins/auth.js';

export interface AuditRoutesDeps {
  pool: Pool;
  guards: AuthGuards;
}

interface AuditRow {
  id: string;
  actor_user_id: string | null;
  actor_username: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  details: unknown;
  ip: string | null;
  user_agent: string | null;
  created_at: Date;
  total_count: number;
}

interface AuditQuery {
  action?: string;
  entityType?: string;
  entityId?: string;
  actorUserId?: string;
  dateFrom?: string;
  dateTo?: string;
  page: number;
  pageSize: number;
}

export function registerAuditRoutes(app: FastifyInstance, deps: AuditRoutesDeps): void {
  const { pool, guards } = deps;

  app.get(
    '/audit',
    {
      preHandler: guards.requireAdmin,
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            action: { type: 'string', maxLength: 100 },
            entityType: { type: 'string', maxLength: 50 },
            entityId: { type: 'string', maxLength: 100 },
            actorUserId: { type: 'string', maxLength: 64 },
            dateFrom: { type: 'string', maxLength: 10 },
            dateTo: { type: 'string', maxLength: 10 },
            page: { type: 'integer', minimum: 1, default: 1 },
            pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          },
        },
      },
    },
    async (request) => {
      const query = request.query as AuditQuery;
      if (query.dateFrom && !isValidIsoDate(query.dateFrom)) {
        throw ApiError.badRequest('invalid_date_from', 'تاريخ البداية غير صالح.');
      }
      if (query.dateTo && !isValidIsoDate(query.dateTo)) {
        throw ApiError.badRequest('invalid_date_to', 'تاريخ النهاية غير صالح.');
      }
      if (query.actorUserId && !isUuid(query.actorUserId)) {
        throw ApiError.badRequest('invalid_actor', 'معرّف المستخدم غير صالح.');
      }

      const conditions: string[] = [];
      const params: unknown[] = [];
      const addParam = (value: unknown): string => {
        params.push(value);
        return `$${params.length}`;
      };
      if (query.action) conditions.push(`action = ${addParam(query.action)}`);
      if (query.entityType) conditions.push(`entity_type = ${addParam(query.entityType)}`);
      if (query.entityId) conditions.push(`entity_id = ${addParam(query.entityId)}`);
      if (query.actorUserId) conditions.push(`actor_user_id = ${addParam(query.actorUserId)}`);
      if (query.dateFrom) conditions.push(`created_at >= ${addParam(query.dateFrom)}::date`);
      if (query.dateTo) conditions.push(`created_at < (${addParam(query.dateTo)}::date + interval '1 day')`);

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const limit = addParam(query.pageSize);
      const offset = addParam((query.page - 1) * query.pageSize);

      const { rows } = await pool.query<AuditRow>(
        `SELECT id, actor_user_id, actor_username, action, entity_type, entity_id,
                details, ip, user_agent, created_at,
                count(*) OVER()::int AS total_count
           FROM audit_log
           ${where}
          ORDER BY created_at DESC, id DESC
          LIMIT ${limit} OFFSET ${offset}`,
        params,
      );

      return {
        items: rows.map((row) => ({
          id: row.id,
          actorUserId: row.actor_user_id,
          actorUsername: row.actor_username,
          action: row.action,
          entityType: row.entity_type,
          entityId: row.entity_id,
          details: row.details,
          ip: row.ip,
          userAgent: row.user_agent,
          createdAt: row.created_at,
        })),
        total: rows[0]?.total_count ?? 0,
        page: query.page,
        pageSize: query.pageSize,
      };
    },
  );
}
