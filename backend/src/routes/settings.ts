import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { ApiError } from '../lib/errors.js';
import type { AuthGuards } from '../plugins/auth.js';
import { writeAudit, type AuditContext } from '../services/audit.js';
import { getUploadMaxMb, setSetting } from '../services/settings.js';

export interface SettingsRoutesDeps {
  pool: Pool;
  guards: AuthGuards;
  defaultUploadMaxMb: number;
}

function extractAuditContext(request: FastifyRequest): AuditContext {
  return {
    ip: request.ip,
    userAgent: (request.headers['user-agent'] ?? '') || null,
  };
}

export function registerSettingsRoutes(app: FastifyInstance, deps: SettingsRoutesDeps): void {
  const { pool, guards, defaultUploadMaxMb } = deps;

  // استرجاع الإعدادات العامة (متاح لجميع المستخدمين المسجلين لعرض قيود الرفع في الواجهة)
  app.get(
    '/settings',
    { preHandler: guards.requireAuth },
    async () => {
      const uploadMaxMb = await getUploadMaxMb(pool, defaultUploadMaxMb);
      return { uploadMaxMb };
    },
  );

  // تعديل الإعدادات العامة (للمدير فقط)
  app.patch(
    '/settings',
    {
      preHandler: [guards.requireAuth, guards.requireAdmin],
      schema: {
        body: {
          type: 'object',
          properties: {
            uploadMaxMb: { type: 'integer', minimum: 5, maximum: 100 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request) => {
      const body = request.body as { uploadMaxMb?: number };

      if (body.uploadMaxMb !== undefined) {
        if (!Number.isInteger(body.uploadMaxMb) || body.uploadMaxMb < 5 || body.uploadMaxMb > 100) {
          throw ApiError.badRequest('invalid_upload_max', 'يجب أن يكون الحد الأقصى بين 5 و 100 ميجابايت.');
        }
        await setSetting(pool, 'upload_max_mb', String(body.uploadMaxMb));

        await writeAudit(
          pool,
          {
            actorUserId: request.authUser!.id,
            actorUsername: request.authUser!.username,
            action: 'setting.updated',
            entityType: 'setting',
            entityId: 'upload_max_mb',
            details: { uploadMaxMb: body.uploadMaxMb },
          },
          extractAuditContext(request),
        );
      }

      const uploadMaxMb = await getUploadMaxMb(pool, defaultUploadMaxMb);
      return { uploadMaxMb };
    },
  );
}
