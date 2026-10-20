import type { Pool } from 'pg';
import type { Queryable } from '../db/pool.js';
import { containsPattern } from '../lib/sql.js';
import type { UserRole } from './sessions.js';

export interface UserRecord {
  id: string;
  username: string;
  displayName: string;
  employeeNumber: string | null;
  role: UserRole;
  isActive: boolean;
  createdAt: Date;
  lastLoginAt: Date | null;
}

/** أعمدة القراءة الموحّدة لحسابات المستخدمين (لا تتضمن أي أسرار مثل password_hash). */
const USER_COLUMNS =
  'id, username, display_name, employee_number, role, is_active, created_at, last_login_at';

export interface UserWithHash extends UserRecord {
  passwordHash: string;
}

interface UserRow {
  id: string;
  username: string;
  display_name: string;
  employee_number: string | null;
  role: UserRole;
  is_active: boolean;
  created_at: Date;
  last_login_at: Date | null;
  password_hash?: string;
}

function toRecord(row: UserRow): UserRecord {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    employeeNumber: row.employee_number,
    role: row.role,
    isActive: row.is_active,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  };
}

export interface ListUsersFilters {
  q?: string;
  role?: UserRole;
  isActive?: boolean;
  page: number;
  pageSize: number;
}

export async function listUsers(
  pool: Pool,
  filters: ListUsersFilters,
): Promise<{ items: UserRecord[]; total: number }> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  const addParam = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };

  if (filters.q) {
    const pattern = addParam(containsPattern(filters.q));
    conditions.push(
      `(username ILIKE ${pattern} ESCAPE '\\'
        OR display_name ILIKE ${pattern} ESCAPE '\\'
        OR employee_number ILIKE ${pattern} ESCAPE '\\')`,
    );
  }
  if (filters.role) conditions.push(`role = ${addParam(filters.role)}`);
  if (filters.isActive !== undefined) conditions.push(`is_active = ${addParam(filters.isActive)}`);

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // عدّاد منفصل بنفس المرشِّحات: لا يعتمد على الصفوف المعادة، فيبقى صحيحاً حتى
  // عندما يتجاوز الإزاحة نهاية النتائج (صفحة فارغة) بخلاف count(*) OVER().
  const countResult = await pool.query<{ total: number }>(
    `SELECT count(*)::int AS total FROM users ${where}`,
    params,
  );

  const limit = addParam(filters.pageSize);
  const offset = addParam((filters.page - 1) * filters.pageSize);

  const { rows } = await pool.query<UserRow>(
    `SELECT ${USER_COLUMNS}
       FROM users
       ${where}
      ORDER BY created_at ASC
      LIMIT ${limit} OFFSET ${offset}`,
    params,
  );

  return {
    items: rows.map(toRecord),
    total: countResult.rows[0]?.total ?? 0,
  };
}

export async function findUserByUsername(pool: Pool, username: string): Promise<UserWithHash | null> {
  const { rows } = await pool.query<UserRow>(
    `SELECT ${USER_COLUMNS}, password_hash
       FROM users
      WHERE lower(username) = lower($1)`,
    [username],
  );
  const row = rows[0];
  if (!row || !row.password_hash) return null;
  return { ...toRecord(row), passwordHash: row.password_hash };
}

export interface IdentifierLookup {
  user: UserWithHash | null;
  /** صحيح عندما يطابق المعرّف اسم مستخدم لحساب ورقم وظيفي لحساب آخر في آن واحد. */
  ambiguous: boolean;
}

/**
 * يبحث عن حساب بمعرّف دخول واحد: اسم المستخدم أو الرقم الوظيفي، دون حساسية لحالة الأحرف.
 * نستخدم LIMIT 2 لكشف التعارض بين الحقلين: اسم مستخدم يطابق حساباً ورقم وظيفي يطابق
 * حساباً آخر. عندها نرفض المصادقة بدل اختيار أحد الحسابين عشوائياً.
 */
export async function findUserByIdentifier(
  pool: Pool,
  identifier: string,
): Promise<IdentifierLookup> {
  const { rows } = await pool.query<UserRow>(
    `SELECT ${USER_COLUMNS}, password_hash
       FROM users
      WHERE lower(username) = lower($1)
         OR (employee_number IS NOT NULL AND lower(employee_number) = lower($1))
      ORDER BY created_at ASC
      LIMIT 2`,
    [identifier],
  );
  if (rows.length === 0) return { user: null, ambiguous: false };
  if (rows.length > 1) return { user: null, ambiguous: true };
  const row = rows[0]!;
  if (!row.password_hash) return { user: null, ambiguous: false };
  return { user: { ...toRecord(row), passwordHash: row.password_hash }, ambiguous: false };
}

export async function getUserById(pool: Pool, id: string): Promise<UserWithHash | null> {
  const { rows } = await pool.query<UserRow>(
    `SELECT ${USER_COLUMNS}, password_hash
       FROM users
      WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row || !row.password_hash) return null;
  return { ...toRecord(row), passwordHash: row.password_hash };
}

export async function countActiveAdmins(db: Queryable, excludeUserId?: string): Promise<number> {
  const { rows } = await db.query<{ count: number }>(
    `SELECT count(*)::int AS count
       FROM users
      WHERE role = 'admin' AND is_active
        AND ($1::uuid IS NULL OR id <> $1::uuid)`,
    [excludeUserId ?? null],
  );
  return rows[0]?.count ?? 0;
}

export async function createUser(
  db: Queryable,
  input: {
    username: string;
    displayName: string;
    employeeNumber?: string | null;
    role: UserRole;
    passwordHash: string;
  },
): Promise<UserRecord> {
  const { rows } = await db.query<UserRow>(
    `INSERT INTO users (username, display_name, employee_number, role, password_hash)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${USER_COLUMNS}`,
    [
      input.username,
      input.displayName,
      input.employeeNumber ?? null,
      input.role,
      input.passwordHash,
    ],
  );
  const row = rows[0];
  if (!row) throw new Error('failed to create user');
  return toRecord(row);
}

export interface UserUpdate {
  displayName?: string;
  employeeNumber?: string | null;
  role?: UserRole;
  isActive?: boolean;
}

export async function updateUser(
  db: Queryable,
  id: string,
  update: UserUpdate,
): Promise<UserRecord | null> {
  const sets: string[] = [];
  const params: unknown[] = [];
  const addParam = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };
  if (update.displayName !== undefined) sets.push(`display_name = ${addParam(update.displayName)}`);
  // null يعني مسح الرقم الوظيفي صراحةً، أما undefined فيعني عدم تغييره.
  if (update.employeeNumber !== undefined) {
    sets.push(`employee_number = ${addParam(update.employeeNumber)}`);
  }
  if (update.role !== undefined) sets.push(`role = ${addParam(update.role)}`);
  if (update.isActive !== undefined) sets.push(`is_active = ${addParam(update.isActive)}`);
  if (sets.length === 0) return null;
  sets.push('updated_at = now()');
  params.push(id);

  const { rows } = await db.query<UserRow>(
    `UPDATE users SET ${sets.join(', ')}
      WHERE id = $${params.length}
      RETURNING ${USER_COLUMNS}`,
    params,
  );
  const row = rows[0];
  return row ? toRecord(row) : null;
}

export async function setUserPassword(db: Queryable, id: string, passwordHash: string): Promise<boolean> {
  const result = await db.query('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1', [
    id,
    passwordHash,
  ]);
  return (result.rowCount ?? 0) > 0;
}

export async function touchLastLogin(db: Queryable, id: string): Promise<void> {
  await db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [id]);
}
