import type { Pool } from 'pg';
import type { Queryable } from '../db/pool.js';
import { randomToken, safeEqual, sha256Hex } from '../lib/security.js';

export const SESSION_COOKIE_NAME = 'hlc_session';

export type UserRole = 'admin' | 'employee';

export interface SessionUserInfo {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  isActive: boolean;
  /** الإدارة المعيّنة للموظف، أو null للمدير/الحساب غير المعيّن. */
  departmentId: string | null;
  departmentName: string | null;
  /** حالة الإدارة الحالية من قاعدة البيانات، وليس من قيمة قديمة في الجلسة. */
  departmentActive: boolean | null;
}

export interface SessionRecord {
  id: string;
  userId: string;
  csrfToken: string;
  expiresAt: Date;
}

export interface SessionLookup {
  session: SessionRecord;
  user: SessionUserInfo;
}

interface SessionRow {
  session_id: string;
  user_id: string;
  csrf_token: string;
  expires_at: Date;
  username: string;
  display_name: string;
  role: UserRole;
  is_active: boolean;
  department_id: string | null;
  department_name: string | null;
  department_active: boolean | null;
}

export async function createSession(
  db: Queryable,
  userId: string,
  options: { ttlHours: number; ip?: string | null; userAgent?: string | null },
): Promise<{ token: string; csrfToken: string; expiresAt: Date }> {
  const token = randomToken();
  const csrfToken = randomToken();
  const expiresAt = new Date(Date.now() + options.ttlHours * 3600 * 1000);
  await db.query(
    `INSERT INTO sessions (user_id, token_hash, csrf_token, expires_at, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, sha256Hex(token), csrfToken, expiresAt, options.ip ?? null, options.userAgent ?? null],
  );
  return { token, csrfToken, expiresAt };
}

export async function findSessionWithUser(pool: Pool, token: string): Promise<SessionLookup | null> {
  const { rows } = await pool.query<SessionRow>(
    `SELECT s.id AS session_id, s.user_id, s.csrf_token, s.expires_at,
            u.username, u.display_name, u.role, u.is_active,
            u.department_id, dep.name AS department_name, dep.is_active AS department_active
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN departments dep ON dep.id = u.department_id
      WHERE s.token_hash = $1`,
    [sha256Hex(token)],
  );
  const row = rows[0];
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await pool.query('DELETE FROM sessions WHERE id = $1', [row.session_id]);
    return null;
  }
  if (!row.is_active) {
    await pool.query('DELETE FROM sessions WHERE id = $1', [row.session_id]);
    return null;
  }
  // تحديث آخر نشاط بشكل مخفف: مرة كل خمس دقائق كحد أقصى.
  await pool.query(
    `UPDATE sessions SET last_seen_at = now()
      WHERE id = $1 AND last_seen_at < now() - interval '5 minutes'`,
    [row.session_id],
  );
  return {
    session: {
      id: row.session_id,
      userId: row.user_id,
      csrfToken: row.csrf_token,
      expiresAt: new Date(row.expires_at),
    },
    user: {
      id: row.user_id,
      username: row.username,
      displayName: row.display_name,
      role: row.role,
      isActive: row.is_active,
      departmentId: row.department_id,
      departmentName: row.department_name,
      departmentActive: row.department_active,
    },
  };
}

export async function destroySession(pool: Pool, token: string): Promise<void> {
  await pool.query('DELETE FROM sessions WHERE token_hash = $1', [sha256Hex(token)]);
}

export async function destroyUserSessions(
  pool: Pool,
  userId: string,
  options: { exceptToken?: string } = {},
): Promise<number> {
  const result = options.exceptToken
    ? await pool.query('DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2', [
        userId,
        sha256Hex(options.exceptToken),
      ])
    : await pool.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
  return result.rowCount ?? 0;
}

export async function purgeExpiredSessions(pool: Pool): Promise<number> {
  const result = await pool.query('DELETE FROM sessions WHERE expires_at < now()');
  return result.rowCount ?? 0;
}

export function verifyCsrfToken(session: SessionRecord, provided: string | undefined): boolean {
  if (!provided) return false;
  return safeEqual(session.csrfToken, provided);
}
