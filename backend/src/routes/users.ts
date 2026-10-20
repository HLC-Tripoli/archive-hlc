import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { AppConfig } from '../config.js';
import { withTransaction } from '../db/pool.js';
import { ApiError } from '../lib/errors.js';
import {
  hashPassword,
  normalizeEmployeeNumber,
  validatePassword,
  validateUsername,
} from '../lib/security.js';
import type { AuthGuards } from '../plugins/auth.js';
import { writeAudit, type AuditContext } from '../services/audit.js';
import { destroyUserSessions } from '../services/sessions.js';
import {
  countActiveAdmins,
  createUser,
  getUserById,
  listUsers,
  setUserPassword,
  updateUser,
  type UserUpdate,
} from '../services/users.js';

export interface UserRoutesDeps {
  pool: Pool;
  config: AppConfig;
  guards: AuthGuards;
}

const USER_ID_PARAMS_SCHEMA = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', format: 'uuid' } },
} as const;

const ROLE_ENUM = ['admin', 'employee'] as const;

export function registerUserRoutes(app: FastifyInstance, deps: UserRoutesDeps): void {
  const { pool, config, guards } = deps;

  app.get(
    '/users',
    {
      preHandler: guards.requireAdmin,
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            q: { type: 'string', maxLength: 100 },
            role: { type: 'string', enum: ROLE_ENUM },
            isActive: { type: 'boolean' },
            page: { type: 'integer', minimum: 1, default: 1 },
            pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
          },
        },
      },
    },
    async (request) => {
      const query = request.query as {
        q?: string;
        role?: 'admin' | 'employee';
        isActive?: boolean;
        page: number;
        pageSize: number;
      };
      const result = await listUsers(pool, {
        q: query.q?.trim() || undefined,
        role: query.role,
        isActive: query.isActive,
        page: query.page,
        pageSize: query.pageSize,
      });
      return { items: result.items, total: result.total, page: query.page, pageSize: query.pageSize };
    },
  );

  app.post(
    '/users',
    {
      preHandler: guards.requireAdmin,
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['username', 'displayName', 'role', 'password'],
          properties: {
            username: { type: 'string', minLength: 3, maxLength: 32 },
            displayName: { type: 'string', minLength: 1, maxLength: 200 },
            // لا نستخدم anyOf هنا: coerceTypes في Fastify يحوّل null إلى "" مع anyOf،
            // بينما type: ['string','null'] يبقي null كما هو ثم يطبّعه التطبيق إلى NULL.
            employeeNumber: { type: ['string', 'null'], maxLength: 128 },
            role: { type: 'string', enum: ROLE_ENUM },
            password: { type: 'string', minLength: 8, maxLength: 200 },
          },
        },
      },
    },
    async (request, reply) => {
      const body = request.body as {
        username: string;
        displayName: string;
        employeeNumber?: string | null;
        role: 'admin' | 'employee';
        password: string;
      };
      const username = body.username.trim();
      validateUsername(username);
      validatePassword(body.password);
      const employeeNumber = normalizeEmployeeNumber(body.employeeNumber);
      const passwordHash = await hashPassword(body.password);
      const auditContext: AuditContext = {
        ip: request.ip,
        userAgent: (request.headers['user-agent'] ?? '') || null,
      };

      const created = await withTransaction(pool, async (client) => {
        const user = await createUser(client, {
          username,
          displayName: body.displayName.trim(),
          employeeNumber,
          role: body.role,
          passwordHash,
        });
        await writeAudit(
          client,
          {
            actorUserId: request.authUser!.id,
            actorUsername: request.authUser!.username,
            action: 'user.created',
            entityType: 'user',
            entityId: user.id,
            details: {
              username: user.username,
              employeeNumber: user.employeeNumber,
              role: user.role,
            },
          },
          auditContext,
        );
        return user;
      });

      reply.code(201);
      return { user: created };
    },
  );

  app.patch(
    '/users/:id',
    {
      preHandler: guards.requireAdmin,
      schema: {
        params: USER_ID_PARAMS_SCHEMA,
        body: {
          type: 'object',
          additionalProperties: false,
          minProperties: 1,
          properties: {
            displayName: { type: 'string', minLength: 1, maxLength: 200 },
            employeeNumber: { type: ['string', 'null'], maxLength: 128 },
            role: { type: 'string', enum: ROLE_ENUM },
            isActive: { type: 'boolean' },
          },
        },
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = request.body as UserUpdate;
      const hasEmployeeNumber = body.employeeNumber !== undefined;
      const employeeNumber = hasEmployeeNumber
        ? normalizeEmployeeNumber(body.employeeNumber)
        : undefined;
      const target = await getUserById(pool, id);
      if (!target) throw ApiError.notFound('المستخدم غير موجود.');

      const isSelf = target.id === request.authUser!.id;
      if (isSelf && body.isActive === false) {
        throw ApiError.badRequest('self_deactivate', 'لا يمكنك تعطيل حسابك الحالي.');
      }

      const demoting = body.role === 'employee' && target.role === 'admin';
      const deactivating = body.isActive === false && target.isActive;
      if (target.role === 'admin' && (demoting || deactivating)) {
        const otherAdmins = await countActiveAdmins(pool, target.id);
        if (otherAdmins === 0) {
          throw ApiError.conflict(
            'last_admin',
            'لا يمكن تنفيذ العملية لأنها ستترك المنظومة دون أي مدير نظام نشط.',
          );
        }
      }

      const auditContext: AuditContext = {
        ip: request.ip,
        userAgent: (request.headers['user-agent'] ?? '') || null,
      };

      const result = await withTransaction(pool, async (client) => {
        const updated = await updateUser(client, id, {
          displayName: body.displayName?.trim(),
          employeeNumber,
          role: body.role,
          isActive: body.isActive,
        });
        if (!updated) throw ApiError.notFound('المستخدم غير موجود.');
        const changed: Record<string, unknown> = {};
        if (body.displayName !== undefined) changed.displayName = updated.displayName;
        if (hasEmployeeNumber) changed.employeeNumber = updated.employeeNumber;
        if (body.role !== undefined) changed.role = updated.role;
        if (body.isActive !== undefined) changed.isActive = updated.isActive;

        let revokedSessions = 0;
        if (body.isActive === false || body.role !== undefined) {
          revokedSessions = await destroyUserSessions(pool, id);
        }
        await writeAudit(
          client,
          {
            actorUserId: request.authUser!.id,
            actorUsername: request.authUser!.username,
            action: 'user.updated',
            entityType: 'user',
            entityId: id,
            details: { changed, revokedSessions },
          },
          auditContext,
        );
        return updated;
      });

      return { user: result };
    },
  );

  app.post(
    '/users/:id/password',
    {
      preHandler: guards.requireAdmin,
      config: { rateLimit: { max: config.rateLimits.sensitiveMax, timeWindow: '15 minutes' } },
      schema: {
        params: USER_ID_PARAMS_SCHEMA,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['password'],
          properties: { password: { type: 'string', minLength: 8, maxLength: 200 } },
        },
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = request.body as { password: string };
      validatePassword(body.password);
      const target = await getUserById(pool, id);
      if (!target) throw ApiError.notFound('المستخدم غير موجود.');
      const passwordHash = await hashPassword(body.password);
      await setUserPassword(pool, id, passwordHash);
      const revoked = await destroyUserSessions(pool, id);
      await writeAudit(
        pool,
        {
          actorUserId: request.authUser!.id,
          actorUsername: request.authUser!.username,
          action: 'user.password_reset',
          entityType: 'user',
          entityId: id,
          details: { username: target.username, revokedSessions: revoked },
        },
        { ip: request.ip, userAgent: (request.headers['user-agent'] ?? '') || null },
      );
      return { ok: true };
    },
  );
}
