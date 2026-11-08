import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { ApiError } from '../lib/errors.js';
import { isUuid } from '../lib/validation.js';
import type { AuthGuards } from '../plugins/auth.js';
import {
  clearAllNotifications,
  deleteNotification,
  getUnreadCount,
  listUserNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../services/notifications.js';

export interface NotificationRoutesDeps {
  pool: Pool;
  guards: AuthGuards;
}

export function registerNotificationRoutes(
  app: FastifyInstance,
  deps: NotificationRoutesDeps,
): void {
  const { pool, guards } = deps;

  // استرجاع إشعارات المستخدم الحالي مع إجمالي غير المقروء
  app.get(
    '/notifications',
    { preHandler: guards.requireAuth },
    async (request) => {
      const user = request.authUser!;
      const query = request.query as {
        limit?: string;
        offset?: string;
        unreadOnly?: string;
      };

      const limit = query.limit ? parseInt(query.limit, 10) : 20;
      const offset = query.offset ? parseInt(query.offset, 10) : 0;
      const unreadOnly = query.unreadOnly === 'true' || query.unreadOnly === '1';

      const result = await listUserNotifications(pool, user.id, {
        limit,
        offset,
        unreadOnly,
      });

      return result;
    },
  );

  // استرجاع عدد الإشعارات غير المقروءة فقط (فحص سريع وخفيف للمتصفح)
  app.get(
    '/notifications/unread-count',
    { preHandler: guards.requireAuth },
    async (request) => {
      const user = request.authUser!;
      const unreadCount = await getUnreadCount(pool, user.id);
      return { unreadCount };
    },
  );

  // تحديد إشعار معين كمقروء
  app.patch(
    '/notifications/:id/read',
    { preHandler: guards.requireAuth },
    async (request) => {
      const user = request.authUser!;
      const { id } = request.params as { id: string };

      if (!isUuid(id)) {
        throw new ApiError(400, 'invalid_id', 'معرف الإشعار غير صحيح');
      }

      const updated = await markNotificationRead(pool, user.id, id);
      if (!updated) {
        throw new ApiError(404, 'not_found', 'الإشعار غير موجود');
      }

      const unreadCount = await getUnreadCount(pool, user.id);
      return { success: true, unreadCount };
    },
  );

  // تحديد كافة الإشعارات كمقروءة للمستخدم الحالي
  app.post(
    '/notifications/read-all',
    { preHandler: guards.requireAuth },
    async (request) => {
      const user = request.authUser!;
      const markedCount = await markAllNotificationsRead(pool, user.id);
      return { success: true, markedCount, unreadCount: 0 };
    },
  );

  // حذف إشعار معين للمستخدم الحالي
  app.delete(
    '/notifications/:id',
    { preHandler: guards.requireAuth },
    async (request) => {
      const user = request.authUser!;
      const { id } = request.params as { id: string };

      if (!isUuid(id)) {
        throw new ApiError(400, 'invalid_id', 'معرف الإشعار غير صحيح');
      }

      const deleted = await deleteNotification(pool, user.id, id);
      if (!deleted) {
        throw new ApiError(404, 'not_found', 'الإشعار غير موجود');
      }

      const unreadCount = await getUnreadCount(pool, user.id);
      return { success: true, unreadCount };
    },
  );

  // مسح كافة إشعارات المستخدم الحالي
  app.delete(
    '/notifications',
    { preHandler: guards.requireAuth },
    async (request) => {
      const user = request.authUser!;
      const deletedCount = await clearAllNotifications(pool, user.id);
      return { success: true, deletedCount, unreadCount: 0 };
    },
  );
}
