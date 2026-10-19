import type { Pool } from 'pg';
import type { Queryable } from '../db/pool.js';
import { containsPattern } from '../lib/sql.js';
import type { UserRole } from './sessions.js';

export interface UserRecord {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  isActive: boolean;
  createdAt: Date;
  lastLoginAt: Date | null;
}

export interface UserWithHash extends UserRecord {
  passwordHash: string;
}

interface UserRow {
  id: string;
  username: string;
  display_name: string;
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
    conditions.push(`(username ILIKE ${pattern} ESCAPE '\\' OR display_name ILIKE ${pattern} ESCAPE '\\')`);
  }
  if (filters.role) conditions.push(`role = ${addParam(filters.role)}`);
  if (filters.isActive !== undefined) conditions.push(`is_active = ${addParam(filters.isActive)}`);

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = addParam(filters.pageSize);
  const offset = addParam((filters.page - 1) * filters.pageSize);

  const { rows } = await pool.query<UserRow & { total_count: number }>(
    `SELECT id, username, display_name, role, is_active, created_at, last_login_at,
            count(*) OVER()::int AS total_count
       FROM users
       ${where}
      ORDER BY created_at ASC
      LIMIT ${limit} OFFSET ${offset}`,
    params,
  );

  return {
    items: rows.map(toRecord),
    total: rows[0]?.total_count ?? 0,
  };
}

export async function findUserByUsername(pool: Pool, username: string): Promise<UserWithHash | null> {
  const { rows } = await pool.query<UserRow>(
    `SELECT id, username, display_name, role, is_active, created_at, last_login_at, password_hash
       FROM users
      WHERE lower(username) = lower($1)`,
    [username],
  );
  const row = rows[0];
  if (!row || !row.password_hash) return null;
  return { ...toRecord(row), passwordHash: row.password_hash };
}

export async function getUserById(pool: Pool, id: string): Promise<UserWithHash | null> {
  const { rows } = await pool.query<UserRow>(
    `SELECT id, username, display_name, role, is_active, created_at, last_login_at, password_hash
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
  input: { username: string; displayName: string; role: UserRole; passwordHash: string },
): Promise<UserRecord> {
  const { rows } = await db.query<UserRow>(
    `INSERT INTO users (username, display_name, role, password_hash)
     VALUES ($1, $2, $3, $4)
     RETURNING id, username, display_name, role, is_active, created_at, last_login_at`,
    [input.username, input.displayName, input.role, input.passwordHash],
  );
  const row = rows[0];
  if (!row) throw new Error('failed to create user');
  return toRecord(row);
}

export interface UserUpdate {
  displayName?: string;
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
  if (update.role !== undefined) sets.push(`role = ${addParam(update.role)}`);
  if (update.isActive !== undefined) sets.push(`is_active = ${addParam(update.isActive)}`);
  if (sets.length === 0) return null;
  sets.push('updated_at = now()');
  params.push(id);

  const { rows } = await db.query<UserRow>(
    `UPDATE users SET ${sets.join(', ')}
      WHERE id = $${params.length}
      RETURNING id, username, display_name, role, is_active, created_at, last_login_at`,
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
