import type { Pool } from 'pg';
import type { Queryable } from '../db/pool.js';
import { containsPattern } from '../lib/sql.js';

export interface DepartmentRecord {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  documentCount: number;
}

interface DepartmentRow {
  id: string;
  name: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  document_count: number;
}

function toRecord(row: DepartmentRow): DepartmentRecord {
  return {
    id: row.id,
    name: row.name,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    documentCount: row.document_count,
  };
}

const DEPARTMENT_SELECT = `
  SELECT dep.id, dep.name, dep.is_active, dep.created_at, dep.updated_at,
         (SELECT count(*)::int FROM documents doc
           WHERE doc.department_id = dep.id AND doc.deleted_at IS NULL) AS document_count
    FROM departments dep`;

export async function listDepartments(
  pool: Pool,
  filters: { includeInactive: boolean; q?: string },
): Promise<DepartmentRecord[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (!filters.includeInactive) conditions.push('dep.is_active');
  if (filters.q) {
    params.push(containsPattern(filters.q));
    conditions.push(`dep.name ILIKE $${params.length} ESCAPE '\\'`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query<DepartmentRow>(
    `${DEPARTMENT_SELECT} ${where} ORDER BY dep.name ASC`,
    params,
  );
  return rows.map(toRecord);
}

export async function getDepartmentById(db: Queryable, id: string): Promise<DepartmentRecord | null> {
  const { rows } = await db.query<DepartmentRow>(`${DEPARTMENT_SELECT} WHERE dep.id = $1`, [id]);
  const row = rows[0];
  return row ? toRecord(row) : null;
}

export async function findDepartmentByName(pool: Pool, name: string): Promise<{ id: string } | null> {
  const { rows } = await pool.query<{ id: string }>(
    'SELECT id FROM departments WHERE lower(name) = lower($1)',
    [name],
  );
  return rows[0] ?? null;
}

export async function createDepartment(db: Queryable, name: string): Promise<DepartmentRecord> {
  const { rows } = await db.query<{ id: string }>(
    'INSERT INTO departments (name) VALUES ($1) RETURNING id',
    [name],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error('failed to create department');
  const created = await getDepartmentById(db, id);
  if (!created) throw new Error('failed to load created department');
  return created;
}

export async function updateDepartment(
  db: Queryable,
  id: string,
  update: { name?: string; isActive?: boolean },
): Promise<DepartmentRecord | null> {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (update.name !== undefined) {
    params.push(update.name);
    sets.push(`name = $${params.length}`);
  }
  if (update.isActive !== undefined) {
    params.push(update.isActive);
    sets.push(`is_active = $${params.length}`);
  }
  if (sets.length === 0) return null;
  sets.push('updated_at = now()');
  params.push(id);
  const result = await db.query(`UPDATE departments SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
  if ((result.rowCount ?? 0) === 0) return null;
  return getDepartmentById(db, id);
}

export async function deleteDepartment(db: Queryable, id: string): Promise<boolean> {
  const result = await db.query('DELETE FROM departments WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}

export async function countDocumentsInDepartment(db: Queryable, id: string): Promise<number> {
  const { rows } = await db.query<{ count: number }>(
    'SELECT count(*)::int AS count FROM documents WHERE department_id = $1',
    [id],
  );
  return rows[0]?.count ?? 0;
}
