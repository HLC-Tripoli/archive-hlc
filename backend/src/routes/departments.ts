import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { withTransaction } from '../db/pool.js';
import { ApiError } from '../lib/errors.js';
import type { AuthGuards } from '../plugins/auth.js';
import { writeAudit, type AuditContext } from '../services/audit.js';
import {
  countActiveEmployeesInDepartment,
  countDocumentsInDepartment,
  countUsersInDepartment,
  createDepartment,
  deleteDepartment,
  getDepartmentById,
  listDepartments,
  updateDepartment,
} from '../services/departments.js';

export interface DepartmentRoutesDeps {
  pool: Pool;
  guards: AuthGuards;
}

const ID_PARAMS_SCHEMA = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', format: 'uuid' } },
} as const;

function normalizeDepartmentName(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function registerDepartmentRoutes(app: FastifyInstance, deps: DepartmentRoutesDeps): void {
  const { pool, guards } = deps;

  app.get(
    '/departments',
    {
      preHandler: guards.requireAuth,
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            includeInactive: { type: 'boolean', default: false },
            q: { type: 'string', maxLength: 100 },
          },
        },
      },
    },
    async (request) => {
      const user = request.authUser!;
      if (user.role !== 'admin') {
        // الموظف لا يرى إلا إدارته الحالية النشطة، ولا يرى قائمة الإدارات
        // الأخرى ولا عدّاداتها. الإدارة المعطّلة تعني منع الوصول التشغيلي.
        if (!user.departmentId) return { items: [] };
        const own = await getDepartmentById(pool, user.departmentId);
        return { items: own && own.isActive ? [own] : [] };
      }
      const query = request.query as { includeInactive: boolean; q?: string };
      const items = await listDepartments(pool, {
        includeInactive: query.includeInactive,
        q: query.q?.trim() || undefined,
      });
      return { items };
    },
  );

  app.post(
    '/departments',
    {
      preHandler: guards.requireAdmin,
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['name'],
          properties: { name: { type: 'string', minLength: 1, maxLength: 100 } },
        },
      },
    },
    async (request, reply) => {
      const body = request.body as { name: string };
      const name = normalizeDepartmentName(body.name);
      if (!name) throw ApiError.badRequest('invalid_name', 'اسم الإدارة مطلوب.');

      const auditContext: AuditContext = {
        ip: request.ip,
        userAgent: (request.headers['user-agent'] ?? '') || null,
      };
      const created = await withTransaction(pool, async (client) => {
        const department = await createDepartment(client, name);
        await writeAudit(
          client,
          {
            actorUserId: request.authUser!.id,
            actorUsername: request.authUser!.username,
            action: 'department.created',
            entityType: 'department',
            entityId: department.id,
            details: { name: department.name },
          },
          auditContext,
        );
        return department;
      });
      reply.code(201);
      return { department: created };
    },
  );

  app.patch(
    '/departments/:id',
    {
      preHandler: guards.requireAdmin,
      schema: {
        params: ID_PARAMS_SCHEMA,
        body: {
          type: 'object',
          additionalProperties: false,
          minProperties: 1,
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 100 },
            isActive: { type: 'boolean' },
          },
        },
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = request.body as { name?: string; isActive?: boolean };
      const existing = await getDepartmentById(pool, id);
      if (!existing) throw ApiError.notFound('الإدارة غير موجودة.');
      const name = body.name !== undefined ? normalizeDepartmentName(body.name) : undefined;
      if (name !== undefined && !name) {
        throw ApiError.badRequest('invalid_name', 'اسم الإدارة مطلوب.');
      }

      const auditContext: AuditContext = {
        ip: request.ip,
        userAgent: (request.headers['user-agent'] ?? '') || null,
      };
      const updated = await withTransaction(pool, async (client) => {
        if (existing.isActive && body.isActive === false) {
          const activeEmployees = await countActiveEmployeesInDepartment(client, id);
          if (activeEmployees > 0) {
            throw ApiError.conflict(
              'department_has_active_employees',
              'لا يمكن تعطيل الإدارة لوجود موظفين نشطين مرتبطين بها. أعد تعيينهم إلى إدارة نشطة أو عطّل حساباتهم أولاً.',
            );
          }
        }
        const department = await updateDepartment(client, id, { name, isActive: body.isActive });
        if (!department) throw ApiError.notFound('الإدارة غير موجودة.');
        await writeAudit(
          client,
          {
            actorUserId: request.authUser!.id,
            actorUsername: request.authUser!.username,
            action: 'department.updated',
            entityType: 'department',
            entityId: id,
            details: { changed: { name, isActive: body.isActive } },
          },
          auditContext,
        );
        return department;
      });
      return { department: updated };
    },
  );

  app.delete(
    '/departments/:id',
    { preHandler: guards.requireAdmin, schema: { params: ID_PARAMS_SCHEMA } },
    async (request) => {
      const { id } = request.params as { id: string };
      const existing = await getDepartmentById(pool, id);
      if (!existing) throw ApiError.notFound('الإدارة غير موجودة.');
      const documentsCount = await countDocumentsInDepartment(pool, id);
      if (documentsCount > 0) {
        throw ApiError.conflict(
          'department_in_use',
          'لا يمكن حذف الإدارة لأنها مرتبطة بمعاملات مسجلة. يمكنك تعطيلها بدلاً من ذلك.',
        );
      }
      const usersCount = await countUsersInDepartment(pool, id);
      if (usersCount > 0) {
        throw ApiError.conflict(
          'department_has_users',
          'لا يمكن حذف الإدارة لأنها مرتبطة بحسابات مستخدمين. أعد تعيين الحسابات إلى إدارة أخرى أولاً.',
        );
      }
      await deleteDepartment(pool, id);
      await writeAudit(
        pool,
        {
          actorUserId: request.authUser!.id,
          actorUsername: request.authUser!.username,
          action: 'department.deleted',
          entityType: 'department',
          entityId: id,
          details: { name: existing.name },
        },
        { ip: request.ip, userAgent: (request.headers['user-agent'] ?? '') || null },
      );
      return { ok: true };
    },
  );
}
