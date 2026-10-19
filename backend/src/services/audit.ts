import type { Queryable } from '../db/pool.js';

export interface AuditEntry {
  actorUserId?: string | null;
  actorUsername?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  details?: unknown;
}

export interface AuditContext {
  ip?: string | null;
  userAgent?: string | null;
}

export async function writeAudit(
  db: Queryable,
  entry: AuditEntry,
  context: AuditContext = {},
): Promise<void> {
  await db.query(
    `INSERT INTO audit_log (actor_user_id, actor_username, action, entity_type, entity_id, details, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      entry.actorUserId ?? null,
      entry.actorUsername ?? null,
      entry.action,
      entry.entityType ?? null,
      entry.entityId ?? null,
      JSON.stringify(entry.details ?? {}),
      context.ip ?? null,
      context.userAgent ?? null,
    ],
  );
}
