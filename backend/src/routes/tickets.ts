import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { ApiError } from '../lib/errors.js';
import { isUuid } from '../lib/validation.js';
import type { AuthGuards } from '../plugins/auth.js';
import { writeAudit, type AuditContext } from '../services/audit.js';
import {
  addTicketMessage,
  createTicket,
  getTicketById,
  listTickets,
  updateTicketStatus,
} from '../services/tickets.js';

export interface TicketRoutesDeps {
  pool: Pool;
  guards: AuthGuards;
}

function extractAuditContext(request: FastifyRequest): AuditContext {
  return {
    ip: request.ip,
    userAgent: (request.headers['user-agent'] ?? '') || null,
  };
}

export function registerTicketRoutes(app: FastifyInstance, deps: TicketRoutesDeps): void {
  const { pool, guards } = deps;

  // استرجاع قائمة التذاكر (الموظف يرى تذاكره فقط، المدير يرى الكل)
  app.get(
    '/tickets',
    { preHandler: guards.requireAuth },
    async (request) => {
      const user = request.authUser!;
      const items = await listTickets(pool, {
        userId: user.id,
        isAdmin: user.role === 'admin',
      });
      return { items };
    },
  );

  // إنشاء تذكرة دعم جديدة
  app.post(
    '/tickets',
    {
      preHandler: guards.requireAuth,
      schema: {
        body: {
          type: 'object',
          required: ['title', 'message'],
          properties: {
            title: { type: 'string', minLength: 3, maxLength: 255 },
            message: { type: 'string', minLength: 3, maxLength: 5000 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const user = request.authUser!;
      const body = request.body as { title: string; message: string };

      const ticketId = await createTicket(pool, {
        userId: user.id,
        departmentId: user.departmentId,
        title: body.title,
        message: body.message,
      });

      await writeAudit(
        pool,
        {
          actorUserId: user.id,
          actorUsername: user.username,
          action: 'ticket.created',
          entityType: 'ticket',
          entityId: ticketId,
          details: { title: body.title.trim() },
        },
        extractAuditContext(request),
      );

      reply.code(201);
      return { id: ticketId, title: body.title.trim(), status: 'open' };
    },
  );

  // استرجاع تفاصيل تذكرة ورسائلها
  app.get(
    '/tickets/:id',
    { preHandler: guards.requireAuth },
    async (request) => {
      const { id } = request.params as { id: string };
      if (!isUuid(id)) {
        throw ApiError.badRequest('invalid_id', 'معرّف التذكرة غير صالح.');
      }
      const user = request.authUser!;
      return await getTicketById(pool, id, {
        userId: user.id,
        isAdmin: user.role === 'admin',
      });
    },
  );

  // إضافة رد داخل التذكرة
  app.post(
    '/tickets/:id/messages',
    {
      preHandler: guards.requireAuth,
      schema: {
        body: {
          type: 'object',
          required: ['message'],
          properties: {
            message: { type: 'string', minLength: 1, maxLength: 5000 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!isUuid(id)) {
        throw ApiError.badRequest('invalid_id', 'معرّف التذكرة غير صالح.');
      }
      const user = request.authUser!;
      const body = request.body as { message: string };

      const msg = await addTicketMessage(pool, id, {
        senderId: user.id,
        message: body.message,
        isAdmin: user.role === 'admin',
      });

      reply.code(201);
      return { message: msg };
    },
  );

  // تغيير حالة التذكرة
  app.patch(
    '/tickets/:id/status',
    {
      preHandler: guards.requireAuth,
      schema: {
        body: {
          type: 'object',
          required: ['status'],
          properties: {
            status: { type: 'string', enum: ['open', 'in_progress', 'resolved', 'closed'] },
          },
          additionalProperties: false,
        },
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      if (!isUuid(id)) {
        throw ApiError.badRequest('invalid_id', 'معرّف التذكرة غير صالح.');
      }
      const user = request.authUser!;
      const body = request.body as { status: string };

      await updateTicketStatus(pool, id, body.status, {
        userId: user.id,
        isAdmin: user.role === 'admin',
      });

      await writeAudit(
        pool,
        {
          actorUserId: user.id,
          actorUsername: user.username,
          action: 'ticket.status_updated',
          entityType: 'ticket',
          entityId: id,
          details: { status: body.status },
        },
        extractAuditContext(request),
      );

      return { success: true, status: body.status };
    },
  );
}
