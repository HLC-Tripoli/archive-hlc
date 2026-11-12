import type { Pool } from 'pg';
import { ApiError } from '../lib/errors.js';
import type { StorageProvider } from './storage/types.js';

export interface TicketSummary {
  id: string;
  title: string;
  status: string;
  userId: string;
  creatorName: string;
  departmentName: string | null;
  messageCount: number;
  lastMessageAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface TicketMessage {
  id: string;
  ticketId: string;
  senderId: string;
  senderName: string;
  senderRole: string;
  message: string;
  attachmentName?: string | null;
  attachmentMimeType?: string | null;
  attachmentSizeBytes?: number | null;
  hasAttachment?: boolean;
  createdAt: Date;
}

export interface TicketDetails {
  ticket: TicketSummary;
  messages: TicketMessage[];
}

export interface TicketAttachmentInfo {
  name: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
}

export async function listTickets(
  pool: Pool,
  options: { userId: string; isAdmin: boolean },
): Promise<TicketSummary[]> {
  const params: unknown[] = [];
  let userCondition = '';
  if (!options.isAdmin) {
    params.push(options.userId);
    userCondition = `WHERE t.user_id = $${params.length}`;
  }

  const { rows } = await pool.query<{
    id: string;
    title: string;
    status: string;
    user_id: string;
    creator_name: string;
    department_name: string | null;
    message_count: string;
    last_message_at: Date;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT t.id,
            t.title,
            t.status,
            t.user_id,
            u.display_name AS creator_name,
            d.name AS department_name,
            COUNT(m.id)::int AS message_count,
            COALESCE(MAX(m.created_at), t.created_at) AS last_message_at,
            t.created_at,
            t.updated_at
       FROM support_tickets t
       JOIN users u ON u.id = t.user_id
  LEFT JOIN departments d ON d.id = t.department_id
  LEFT JOIN support_ticket_messages m ON m.ticket_id = t.id
      ${userCondition}
   GROUP BY t.id, u.display_name, d.name
   ORDER BY t.updated_at DESC`,
    params,
  );

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    userId: r.user_id,
    creatorName: r.creator_name,
    departmentName: r.department_name,
    messageCount: Number(r.message_count) || 0,
    lastMessageAt: r.last_message_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export async function createTicket(
  pool: Pool,
  input: {
    userId: string;
    departmentId: string | null;
    title: string;
    message: string;
    attachment?: TicketAttachmentInfo;
  },
): Promise<string> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO support_tickets (user_id, department_id, title, status)
       VALUES ($1, $2, $3, 'open')
       RETURNING id`,
      [input.userId, input.departmentId, input.title.trim()],
    );
    const ticketId = rows[0]!.id;

    await client.query(
      `INSERT INTO support_ticket_messages (
         ticket_id, sender_id, message,
         attachment_name, attachment_mime_type, attachment_size_bytes, attachment_storage_key
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        ticketId,
        input.userId,
        input.message.trim(),
        input.attachment?.name ?? null,
        input.attachment?.mimeType ?? null,
        input.attachment?.sizeBytes ?? null,
        input.attachment?.storageKey ?? null,
      ],
    );

    await client.query('COMMIT');
    return ticketId;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function getTicketById(
  pool: Pool,
  ticketId: string,
  options: { userId: string; isAdmin: boolean },
): Promise<TicketDetails> {
  const { rows: ticketRows } = await pool.query<{
    id: string;
    title: string;
    status: string;
    user_id: string;
    creator_name: string;
    department_name: string | null;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT t.id, t.title, t.status, t.user_id,
            u.display_name AS creator_name,
            d.name AS department_name,
            t.created_at, t.updated_at
       FROM support_tickets t
       JOIN users u ON u.id = t.user_id
  LEFT JOIN departments d ON d.id = t.department_id
      WHERE t.id = $1`,
    [ticketId],
  );

  const t = ticketRows[0];
  if (!t) {
    throw ApiError.notFound('تذكرة الدعم غير موجودة.');
  }

  if (!options.isAdmin && t.user_id !== options.userId) {
    throw ApiError.forbidden('ليس لديك صلاحية الوصول إلى هذه التذكرة.');
  }

  const { rows: messageRows } = await pool.query<{
    id: string;
    ticket_id: string;
    sender_id: string;
    sender_name: string;
    sender_role: string;
    message: string;
    attachment_name: string | null;
    attachment_mime_type: string | null;
    attachment_size_bytes: string | null;
    attachment_storage_key: string | null;
    created_at: Date;
  }>(
    `SELECT m.id, m.ticket_id, m.sender_id, m.message, m.created_at,
            m.attachment_name, m.attachment_mime_type, m.attachment_size_bytes, m.attachment_storage_key,
            u.display_name AS sender_name,
            u.role AS sender_role
       FROM support_ticket_messages m
       JOIN users u ON u.id = m.sender_id
      WHERE m.ticket_id = $1
      ORDER BY m.created_at ASC`,
    [ticketId],
  );

  return {
    ticket: {
      id: t.id,
      title: t.title,
      status: t.status,
      userId: t.user_id,
      creatorName: t.creator_name,
      departmentName: t.department_name,
      messageCount: messageRows.length,
      lastMessageAt: messageRows[messageRows.length - 1]?.created_at || t.created_at,
      createdAt: t.created_at,
      updatedAt: t.updated_at,
    },
    messages: messageRows.map((m) => ({
      id: m.id,
      ticketId: m.ticket_id,
      senderId: m.sender_id,
      senderName: m.sender_name,
      senderRole: m.sender_role,
      message: m.message,
      attachmentName: m.attachment_name,
      attachmentMimeType: m.attachment_mime_type,
      attachmentSizeBytes: m.attachment_size_bytes ? Number(m.attachment_size_bytes) : null,
      hasAttachment: Boolean(m.attachment_storage_key),
      createdAt: m.created_at,
    })),
  };
}

export async function addTicketMessage(
  pool: Pool,
  ticketId: string,
  input: {
    senderId: string;
    message: string;
    isAdmin: boolean;
    attachment?: TicketAttachmentInfo;
  },
): Promise<TicketMessage> {
  const { rows: ticketRows } = await pool.query<{ user_id: string; status: string }>(
    'SELECT user_id, status FROM support_tickets WHERE id = $1',
    [ticketId],
  );
  const ticket = ticketRows[0];
  if (!ticket) {
    throw ApiError.notFound('تذكرة الدعم غير موجودة.');
  }

  if (!input.isAdmin && ticket.user_id !== input.senderId) {
    throw ApiError.forbidden('ليس لديك صلاحية الرد على هذه التذكرة.');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ id: string; created_at: Date }>(
      `INSERT INTO support_ticket_messages (
         ticket_id, sender_id, message,
         attachment_name, attachment_mime_type, attachment_size_bytes, attachment_storage_key
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, created_at`,
      [
        ticketId,
        input.senderId,
        input.message.trim(),
        input.attachment?.name ?? null,
        input.attachment?.mimeType ?? null,
        input.attachment?.sizeBytes ?? null,
        input.attachment?.storageKey ?? null,
      ],
    );

    // إذا كان الرد من موظف وكانت مغلقة، يُعاد فتحها؛ وإذا كان الرد من مدير وتذكرة مفتوحة، يمكن أن تصبح قيد المعالجة
    const newStatus = input.isAdmin && ticket.status === 'open' ? 'in_progress' : ticket.status === 'closed' ? 'open' : ticket.status;

    await client.query(
      'UPDATE support_tickets SET updated_at = NOW(), status = $1 WHERE id = $2',
      [newStatus, ticketId],
    );

    await client.query('COMMIT');

    const { rows: senderRows } = await pool.query<{ display_name: string; role: string }>(
      'SELECT display_name, role FROM users WHERE id = $1',
      [input.senderId],
    );

    return {
      id: rows[0]!.id,
      ticketId,
      senderId: input.senderId,
      senderName: senderRows[0]?.display_name || '—',
      senderRole: senderRows[0]?.role || 'employee',
      message: input.message.trim(),
      attachmentName: input.attachment?.name ?? null,
      attachmentMimeType: input.attachment?.mimeType ?? null,
      attachmentSizeBytes: input.attachment?.sizeBytes ?? null,
      hasAttachment: Boolean(input.attachment?.storageKey),
      createdAt: rows[0]!.created_at,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function getTicketMessageAttachment(
  pool: Pool,
  ticketId: string,
  messageId: string,
  options: { userId: string; isAdmin: boolean },
): Promise<{
  storageKey: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
}> {
  const { rows } = await pool.query<{
    user_id: string;
    attachment_name: string | null;
    attachment_mime_type: string | null;
    attachment_size_bytes: string | null;
    attachment_storage_key: string | null;
  }>(
    `SELECT t.user_id, m.attachment_name, m.attachment_mime_type, m.attachment_size_bytes, m.attachment_storage_key
       FROM support_ticket_messages m
       JOIN support_tickets t ON t.id = m.ticket_id
      WHERE t.id = $1 AND m.id = $2`,
    [ticketId, messageId],
  );

  const row = rows[0];
  if (!row || !row.attachment_storage_key) {
    throw ApiError.notFound('المرفق غير موجود.');
  }

  if (!options.isAdmin && row.user_id !== options.userId) {
    throw ApiError.forbidden('ليس لديك صلاحية الوصول إلى هذا المرفق.');
  }

  return {
    storageKey: row.attachment_storage_key,
    name: row.attachment_name || 'image',
    mimeType: row.attachment_mime_type || 'application/octet-stream',
    sizeBytes: Number(row.attachment_size_bytes) || 0,
  };
}

export async function updateTicketStatus(
  pool: Pool,
  ticketId: string,
  status: string,
  options: { userId: string; isAdmin: boolean },
): Promise<void> {
  const validStatuses = ['open', 'in_progress', 'resolved', 'closed'];
  if (!validStatuses.includes(status)) {
    throw ApiError.badRequest('invalid_status', 'حالة التذكرة غير صالحة.');
  }

  const { rows: ticketRows } = await pool.query<{ user_id: string }>(
    'SELECT user_id FROM support_tickets WHERE id = $1',
    [ticketId],
  );
  const ticket = ticketRows[0];
  if (!ticket) {
    throw ApiError.notFound('تذكرة الدعم غير موجودة.');
  }

  // يمكن للموظف إغلاق تذكرته الخاصة فقط؛ المدير يمكنه تغيير أي حالة
  if (!options.isAdmin) {
    if (ticket.user_id !== options.userId || status !== 'closed') {
      throw ApiError.forbidden('لا تملك صلاحية تعديل هذه الحالة.');
    }
  }

  await pool.query(
    'UPDATE support_tickets SET status = $1, updated_at = NOW() WHERE id = $2',
    [status, ticketId],
  );
}

export async function deleteTicket(
  pool: Pool,
  ticketId: string,
  storage?: StorageProvider,
): Promise<{ title: string }> {
  const { rows: files } = await pool.query<{ attachment_storage_key: string | null }>(
    'SELECT attachment_storage_key FROM support_ticket_messages WHERE ticket_id = $1 AND attachment_storage_key IS NOT NULL',
    [ticketId],
  );

  const { rows } = await pool.query<{ title: string }>(
    'DELETE FROM support_tickets WHERE id = $1 RETURNING title',
    [ticketId],
  );
  if (!rows[0]) {
    throw ApiError.notFound('تذكرة الدعم غير موجودة.');
  }

  if (storage && files.length > 0) {
    for (const f of files) {
      if (f.attachment_storage_key) {
        try {
          await storage.deleteObject(f.attachment_storage_key);
        } catch {
          /* ignore deletion error */
        }
      }
    }
  }

  return rows[0];
}

export async function updateTicket(
  pool: Pool,
  ticketId: string,
  input: { title?: string; status?: string },
): Promise<{ id: string; title: string; status: string }> {
  const sets: string[] = ['updated_at = NOW()'];
  const params: unknown[] = [];

  if (input.title !== undefined) {
    const trimmed = input.title.trim();
    if (trimmed.length < 3 || trimmed.length > 255) {
      throw ApiError.badRequest('invalid_title', 'عنوان التذكرة يجب أن يكون بين 3 و 255 حرفاً.');
    }
    params.push(trimmed);
    sets.push(`title = $${params.length}`);
  }

  if (input.status !== undefined) {
    const validStatuses = ['open', 'in_progress', 'resolved', 'closed'];
    if (!validStatuses.includes(input.status)) {
      throw ApiError.badRequest('invalid_status', 'حالة التذكرة غير صالحة.');
    }
    params.push(input.status);
    sets.push(`status = $${params.length}`);
  }

  params.push(ticketId);
  const { rows } = await pool.query<{ id: string; title: string; status: string }>(
    `UPDATE support_tickets SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING id, title, status`,
    params,
  );

  if (!rows[0]) {
    throw ApiError.notFound('تذكرة الدعم غير موجودة.');
  }
  return rows[0];
}

