import type { Pool } from 'pg';

export interface NotificationRecord {
  id: string;
  userId: string;
  actorUserId: string | null;
  actorName?: string | null;
  title: string;
  body: string;
  type: string;
  link: string | null;
  metadata: Record<string, unknown> | null;
  isRead: boolean;
  createdAt: string;
}

export interface CreateNotificationInput {
  userId: string;
  actorUserId?: string | null;
  title: string;
  body: string;
  type?: string;
  link?: string | null;
  metadata?: Record<string, unknown> | null;
}

export async function createNotification(
  pool: Pool,
  input: CreateNotificationInput,
): Promise<NotificationRecord> {
  const res = await pool.query<{
    id: string;
    user_id: string;
    actor_user_id: string | null;
    title: string;
    body: string;
    type: string;
    link: string | null;
    metadata: Record<string, unknown> | null;
    is_read: boolean;
    created_at: Date;
  }>(
    `INSERT INTO notifications (user_id, actor_user_id, title, body, type, link, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, user_id, actor_user_id, title, body, type, link, metadata, is_read, created_at`,
    [
      input.userId,
      input.actorUserId || null,
      input.title.trim(),
      input.body.trim(),
      input.type || 'system',
      input.link || null,
      input.metadata ? JSON.stringify(input.metadata) : null,
    ],
  );

  const row = res.rows[0];
  if (!row) {
    throw new Error('Failed to insert notification');
  }
  return {
    id: row.id,
    userId: row.user_id,
    actorUserId: row.actor_user_id,
    title: row.title,
    body: row.body,
    type: row.type,
    link: row.link,
    metadata: row.metadata,
    isRead: row.is_read,
    createdAt: row.created_at.toISOString(),
  };
}

export async function notifyAdmins(
  pool: Pool,
  input: Omit<CreateNotificationInput, 'userId'>,
): Promise<void> {
  const adminsRes = await pool.query<{ id: string }>(
    `SELECT id FROM users
     WHERE role = 'admin' AND is_active = true
       AND ($1::uuid IS NULL OR id != $1::uuid)`,
    [input.actorUserId || null],
  );

  for (const admin of adminsRes.rows) {
    await createNotification(pool, {
      ...input,
      userId: admin.id,
    });
  }
}

export async function notifyDepartmentUsers(
  pool: Pool,
  departmentId: string | null,
  input: Omit<CreateNotificationInput, 'userId'>,
): Promise<void> {
  const usersRes = await pool.query<{ id: string }>(
    `SELECT id FROM users
     WHERE is_active = true
       AND ($1::uuid IS NULL OR id != $1::uuid)
       AND (role = 'admin' OR ($2::uuid IS NOT NULL AND department_id = $2::uuid))`,
    [input.actorUserId || null, departmentId || null],
  );

  for (const user of usersRes.rows) {
    await createNotification(pool, {
      ...input,
      userId: user.id,
    });
  }
}

export async function listUserNotifications(
  pool: Pool,
  userId: string,
  options: { limit?: number; offset?: number; unreadOnly?: boolean } = {},
): Promise<{ items: NotificationRecord[]; unreadCount: number }> {
  const limit = Math.max(1, Math.min(options.limit ?? 20, 100));
  const offset = Math.max(0, options.offset ?? 0);

  const unreadRes = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text as count FROM notifications WHERE user_id = $1 AND is_read = false`,
    [userId],
  );
  const unreadCount = parseInt(unreadRes.rows[0]?.count || '0', 10);

  let query = `
    SELECT n.id, n.user_id, n.actor_user_id, n.title, n.body, n.type, n.link, n.metadata, n.is_read, n.created_at,
           u.display_name AS actor_name
    FROM notifications n
    LEFT JOIN users u ON u.id = n.actor_user_id
    WHERE n.user_id = $1
  `;
  const params: unknown[] = [userId];

  if (options.unreadOnly) {
    query += ` AND n.is_read = false`;
  }

  query += ` ORDER BY n.created_at DESC LIMIT $2 OFFSET $3`;
  params.push(limit, offset);

  const itemsRes = await pool.query<{
    id: string;
    user_id: string;
    actor_user_id: string | null;
    actor_name: string | null;
    title: string;
    body: string;
    type: string;
    link: string | null;
    metadata: Record<string, unknown> | null;
    is_read: boolean;
    created_at: Date;
  }>(query, params);

  const items: NotificationRecord[] = itemsRes.rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    actorUserId: row.actor_user_id,
    actorName: row.actor_name,
    title: row.title,
    body: row.body,
    type: row.type,
    link: row.link,
    metadata: row.metadata,
    isRead: row.is_read,
    createdAt: row.created_at.toISOString(),
  }));

  return { items, unreadCount };
}

export async function getUnreadCount(pool: Pool, userId: string): Promise<number> {
  const res = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text as count FROM notifications WHERE user_id = $1 AND is_read = false`,
    [userId],
  );
  return parseInt(res.rows[0]?.count || '0', 10);
}

export async function markNotificationRead(
  pool: Pool,
  userId: string,
  notificationId: string,
): Promise<boolean> {
  const res = await pool.query(
    `UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2`,
    [notificationId, userId],
  );
  return (res.rowCount ?? 0) > 0;
}

export async function markAllNotificationsRead(
  pool: Pool,
  userId: string,
): Promise<number> {
  const res = await pool.query(
    `UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false`,
    [userId],
  );
  return res.rowCount ?? 0;
}
