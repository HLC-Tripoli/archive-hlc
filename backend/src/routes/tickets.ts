import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import sharp from 'sharp';
import type { AppConfig } from '../config.js';
import { ApiError } from '../lib/errors.js';
import { isUuid } from '../lib/validation.js';
import type { AuthGuards } from '../plugins/auth.js';
import { writeAudit, type AuditContext } from '../services/audit.js';
import {
  createNotification,
  notifyAdmins,
} from '../services/notifications.js';
import type { StorageProvider } from '../services/storage/types.js';
import {
  addTicketMessage,
  createTicket,
  deleteTicket,
  getTicketById,
  getTicketMessageAttachment,
  listTickets,
  updateTicket,
  updateTicketStatus,
  type TicketAttachmentInfo,
} from '../services/tickets.js';

export interface TicketRoutesDeps {
  pool: Pool;
  guards: AuthGuards;
  storage: StorageProvider;
  config: AppConfig;
}

const ALLOWED_IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

function extractAuditContext(request: FastifyRequest): AuditContext {
  return {
    ip: request.ip,
    userAgent: (request.headers['user-agent'] ?? '') || null,
  };
}

function resolveImageExtension(mime: string, filename: string): string {
  const ext = path.extname(filename).toLowerCase().replace('.', '');
  if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) {
    return ext === 'jpeg' ? 'jpg' : ext;
  }
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/gif') return 'gif';
  return 'jpg';
}

async function readLimitedBuffer(
  fileStream: NodeJS.ReadableStream,
  maxBytes: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of fileStream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buf.length;
    if (totalBytes > maxBytes) {
      throw ApiError.badRequest('file_too_large', 'حجم الصورة المرفقة يتجاوز الحد الأقصى المسموح.');
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks, totalBytes);
}

async function validateTicketImage(buffer: Buffer): Promise<void> {
  try {
    const meta = await sharp(buffer, { limitInputPixels: 268402689, failOn: 'error' }).metadata();
    if (!meta.format || !['jpeg', 'png', 'webp', 'gif'].includes(meta.format)) {
      throw ApiError.badRequest('invalid_file_type', 'نوع الصورة غير مدعوم أو تالف.');
    }
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw ApiError.badRequest('invalid_file_type', 'ملف الصورة غير صالح أو تالف.');
  }
}

export function registerTicketRoutes(app: FastifyInstance, deps: TicketRoutesDeps): void {
  const { pool, guards, storage, config } = deps;

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

  // إنشاء تذكرة دعم جديدة (يدعم JSON و multipart/form-data مع صورة اختيارية)
  app.post(
    '/tickets',
    {
      preHandler: guards.requireAuth,
    },
    async (request, reply) => {
      const user = request.authUser!;
      let title = '';
      let message = '';
      let imageBuffer: Buffer | null = null;
      let imageName = '';
      let imageMime = '';

      if (request.isMultipart()) {
        const parts = request.parts();
        for await (const part of parts) {
          if (part.type === 'file') {
            if (part.fieldname === 'image' || part.fieldname === 'file') {
              imageName = part.filename;
              imageMime = part.mimetype;
              const maxBytes = Math.min(config.uploadMaxMb, 20) * 1024 * 1024;
              imageBuffer = await readLimitedBuffer(part.file, maxBytes);
            } else {
              part.file.resume();
            }
          } else if (part.type === 'field') {
            if (part.fieldname === 'title') {
              title = String(part.value ?? '');
            } else if (part.fieldname === 'message') {
              message = String(part.value ?? '');
            }
          }
        }
      } else {
        const body = (request.body ?? {}) as { title?: string; message?: string };
        title = String(body.title ?? '');
        message = String(body.message ?? '');
      }

      title = title.trim();
      message = message.trim();

      if (title.length < 3 || title.length > 255) {
        throw ApiError.badRequest('invalid_title', 'عنوان التذكرة يجب أن يكون بين 3 و 255 حرفاً.');
      }
      if (message.length < 3 || message.length > 5000) {
        throw ApiError.badRequest('invalid_message', 'تفاصيل المشكلة يجب أن تكون بين 3 و 5000 حرفاً.');
      }

      let attachment: TicketAttachmentInfo | undefined;
      if (imageBuffer && imageBuffer.length > 0) {
        if (!ALLOWED_IMAGE_MIMES.has(imageMime)) {
          throw ApiError.badRequest(
            'invalid_file_type',
            'نوع الصورة غير مدعوم. يُسمح بالصور من نوع PNG أو JPG أو WEBP أو GIF فقط.',
          );
        }
        await validateTicketImage(imageBuffer);

        const ext = resolveImageExtension(imageMime, imageName);
        const fileId = randomUUID();
        const storageKey = `ticket-attachments/${fileId}.${ext}`;
        await storage.putObject(storageKey, imageBuffer, {
          contentType: imageMime,
          contentLength: imageBuffer.length,
        });

        attachment = {
          name: imageName || `image.${ext}`,
          mimeType: imageMime,
          sizeBytes: imageBuffer.length,
          storageKey,
        };
      }

      const ticketId = await createTicket(pool, {
        userId: user.id,
        departmentId: user.departmentId,
        title,
        message,
        attachment,
      });

      await writeAudit(
        pool,
        {
          actorUserId: user.id,
          actorUsername: user.username,
          action: 'ticket.created',
          entityType: 'ticket',
          entityId: ticketId,
          details: { title, hasAttachment: Boolean(attachment) },
        },
        extractAuditContext(request),
      );

      try {
        await notifyAdmins(pool, {
          actorUserId: user.id,
          title: 'تذكرة دعم جديدة',
          body: `قام ${user.displayName || user.username} بفتح تذكرة: ${title}`,
          type: 'ticket',
          link: `#about?ticket=${ticketId}`,
          metadata: { ticketId, action: 'created' },
        });
      } catch {
        /* ignore notification errors */
      }

      reply.code(201);
      return { id: ticketId, title, status: 'open', hasAttachment: Boolean(attachment) };
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

  // إضافة رد داخل التذكرة (يدعم JSON و multipart/form-data مع صورة اختيارية)
  app.post(
    '/tickets/:id/messages',
    {
      preHandler: guards.requireAuth,
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!isUuid(id)) {
        throw ApiError.badRequest('invalid_id', 'معرّف التذكرة غير صالح.');
      }
      const user = request.authUser!;

      let message = '';
      let imageBuffer: Buffer | null = null;
      let imageName = '';
      let imageMime = '';

      if (request.isMultipart()) {
        const parts = request.parts();
        for await (const part of parts) {
          if (part.type === 'file') {
            if (part.fieldname === 'image' || part.fieldname === 'file') {
              imageName = part.filename;
              imageMime = part.mimetype;
              const maxBytes = Math.min(config.uploadMaxMb, 20) * 1024 * 1024;
              imageBuffer = await readLimitedBuffer(part.file, maxBytes);
            } else {
              part.file.resume();
            }
          } else if (part.type === 'field') {
            if (part.fieldname === 'message') {
              message = String(part.value ?? '');
            }
          }
        }
      } else {
        const body = (request.body ?? {}) as { message?: string };
        message = String(body.message ?? '');
      }

      message = message.trim();
      if (!message && imageBuffer && imageBuffer.length > 0) {
        message = 'صورة مرفقة';
      }

      if (message.length < 1 || message.length > 5000) {
        throw ApiError.badRequest('invalid_message', 'نص الرسالة يجب أن يكون بين 1 و 5000 حرفاً.');
      }

      let attachment: TicketAttachmentInfo | undefined;
      if (imageBuffer && imageBuffer.length > 0) {
        if (!ALLOWED_IMAGE_MIMES.has(imageMime)) {
          throw ApiError.badRequest(
            'invalid_file_type',
            'نوع الصورة غير مدعوم. يُسمح بالصور من نوع PNG أو JPG أو WEBP أو GIF فقط.',
          );
        }
        await validateTicketImage(imageBuffer);

        const ext = resolveImageExtension(imageMime, imageName);
        const fileId = randomUUID();
        const storageKey = `ticket-attachments/${fileId}.${ext}`;
        await storage.putObject(storageKey, imageBuffer, {
          contentType: imageMime,
          contentLength: imageBuffer.length,
        });

        attachment = {
          name: imageName || `image.${ext}`,
          mimeType: imageMime,
          sizeBytes: imageBuffer.length,
          storageKey,
        };
      }

      const msg = await addTicketMessage(pool, id, {
        senderId: user.id,
        message,
        isAdmin: user.role === 'admin',
        attachment,
      });

      try {
        const details = await getTicketById(pool, id, {
          userId: user.id,
          isAdmin: true,
        });
        const snippet = message.slice(0, 100);
        if (user.role === 'admin') {
          if (details.ticket.userId !== user.id) {
            await createNotification(pool, {
              userId: details.ticket.userId,
              actorUserId: user.id,
              title: 'رد جديد على تذكرة الدعم',
              body: `${user.displayName || user.username}: ${snippet}`,
              type: 'ticket',
              link: `#about?ticket=${id}`,
              metadata: { ticketId: id, action: 'replied' },
            });
          }
        } else {
          await notifyAdmins(pool, {
            actorUserId: user.id,
            title: 'رد جديد على تذكرة الدعم',
            body: `${user.displayName || user.username}: ${snippet}`,
            type: 'ticket',
            link: `#about?ticket=${id}`,
            metadata: { ticketId: id, action: 'replied' },
          });
        }
      } catch {
        /* ignore notification errors */
      }

      reply.code(201);
      return { message: msg };
    },
  );

  // عرض أو تحميل مرفق رسالة التذكرة
  app.get(
    '/tickets/:ticketId/messages/:messageId/attachment',
    { preHandler: guards.requireAuth },
    async (request, reply) => {
      const { ticketId, messageId } = request.params as {
        ticketId: string;
        messageId: string;
      };
      if (!isUuid(ticketId) || !isUuid(messageId)) {
        throw ApiError.badRequest('invalid_id', 'معرّف غير صالح.');
      }
      const user = request.authUser!;
      const attachment = await getTicketMessageAttachment(pool, ticketId, messageId, {
        userId: user.id,
        isAdmin: user.role === 'admin',
      });

      const obj = await storage.getObject(attachment.storageKey);
      reply.header('Content-Type', attachment.mimeType);
      reply.header('X-Content-Type-Options', 'nosniff');
      reply.header('Cache-Control', 'private, max-age=86400');
      reply.header(
        'Content-Disposition',
        `inline; filename="${encodeURIComponent(attachment.name)}"`,
      );
      if (attachment.sizeBytes > 0) {
        reply.header('Content-Length', attachment.sizeBytes);
      }
      return reply.send(obj.body);
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

      try {
        const details = await getTicketById(pool, id, {
          userId: user.id,
          isAdmin: true,
        });
        const statusMap: Record<string, string> = {
          open: 'مفتوحة',
          in_progress: 'قيد المعالجة',
          resolved: 'تم الحل',
          closed: 'مغلقة',
        };
        if (details.ticket.userId !== user.id) {
          await createNotification(pool, {
            userId: details.ticket.userId,
            actorUserId: user.id,
            title: 'تحديث حالة تذكرة الدعم',
            body: `تم تحديث حالة تذكرتك "${details.ticket.title}" إلى: ${statusMap[body.status] || body.status}`,
            type: 'ticket',
            link: `#about?ticket=${id}`,
            metadata: { ticketId: id, action: 'status_updated', status: body.status },
          });
        }
      } catch {
        /* ignore notification errors */
      }

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

  // تعديل تذكرة الدعم (عنوان أو حالة - للمدير فقط)
  app.patch(
    '/tickets/:id',
    {
      preHandler: guards.requireAdmin,
      schema: {
        body: {
          type: 'object',
          properties: {
            title: { type: 'string', minLength: 3, maxLength: 255 },
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
      const body = request.body as { title?: string; status?: string };

      if (!body.title && !body.status) {
        throw ApiError.badRequest('empty_payload', 'يجب تحديد حقل واحد على الأقل للتعديل.');
      }

      const updated = await updateTicket(pool, id, body);

      await writeAudit(
        pool,
        {
          actorUserId: user.id,
          actorUsername: user.username,
          action: 'ticket.updated',
          entityType: 'ticket',
          entityId: id,
          details: { title: updated.title, status: updated.status },
        },
        extractAuditContext(request),
      );

      return { success: true, ticket: updated };
    },
  );

  // حذف تذكرة الدعم بالكامل ورسائلها (للمدير فقط)
  app.delete(
    '/tickets/:id',
    {
      preHandler: guards.requireAdmin,
    },
    async (request) => {
      const { id } = request.params as { id: string };
      if (!isUuid(id)) {
        throw ApiError.badRequest('invalid_id', 'معرّف التذكرة غير صالح.');
      }
      const user = request.authUser!;

      const deleted = await deleteTicket(pool, id, storage);

      await writeAudit(
        pool,
        {
          actorUserId: user.id,
          actorUsername: user.username,
          action: 'ticket.deleted',
          entityType: 'ticket',
          entityId: id,
          details: { title: deleted.title },
        },
        extractAuditContext(request),
      );

      return { success: true };
    },
  );
}
