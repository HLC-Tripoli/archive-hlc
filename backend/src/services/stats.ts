import type { Pool } from 'pg';
import type { Queryable } from '../db/pool.js';
import { containsPattern } from '../lib/sql.js';
import { listDocuments, type DocumentListFilters } from './documents.js';

export interface DashboardStats {
  activeDocuments: number;
  deletedDocuments: number;
  incoming: number;
  outgoing: number;
  byStatus: Record<string, number>;
  thisMonth: number;
  departments: number;
  users: number | null;
  recent: Awaited<ReturnType<typeof listDocuments>>['items'];
}

export async function getDashboardStats(pool: Pool, options: { includeAdminInfo: boolean }): Promise<DashboardStats> {
  const counts = await pool.query<{
    active_documents: number;
    deleted_documents: number;
    incoming: number;
    outgoing: number;
    new_count: number;
    in_progress: number;
    completed: number;
    archived: number;
    this_month: number;
  }>(
    `SELECT
       count(*) FILTER (WHERE deleted_at IS NULL)::int AS active_documents,
       count(*) FILTER (WHERE deleted_at IS NOT NULL)::int AS deleted_documents,
       count(*) FILTER (WHERE deleted_at IS NULL AND doc_type = 'incoming')::int AS incoming,
       count(*) FILTER (WHERE deleted_at IS NULL AND doc_type = 'outgoing')::int AS outgoing,
       count(*) FILTER (WHERE deleted_at IS NULL AND status = 'new')::int AS new_count,
       count(*) FILTER (WHERE deleted_at IS NULL AND status = 'in_progress')::int AS in_progress,
       count(*) FILTER (WHERE deleted_at IS NULL AND status = 'completed')::int AS completed,
       count(*) FILTER (WHERE deleted_at IS NULL AND status = 'archived')::int AS archived,
       count(*) FILTER (WHERE deleted_at IS NULL AND created_at >= date_trunc('month', now()))::int AS this_month
     FROM documents`,
  );

  const departments = await pool.query<{ count: number }>('SELECT count(*)::int AS count FROM departments');
  const row = counts.rows[0];

  const users = options.includeAdminInfo
    ? await pool.query<{ count: number }>('SELECT count(*)::int AS count FROM users WHERE is_active')
    : null;

  const recent = await listDocuments(pool, {
    includeDeleted: false,
    sort: 'createdAt',
    order: 'desc',
    page: 1,
    pageSize: 5,
  });

  return {
    activeDocuments: row?.active_documents ?? 0,
    deletedDocuments: row?.deleted_documents ?? 0,
    incoming: row?.incoming ?? 0,
    outgoing: row?.outgoing ?? 0,
    byStatus: {
      new: row?.new_count ?? 0,
      in_progress: row?.in_progress ?? 0,
      completed: row?.completed ?? 0,
      archived: row?.archived ?? 0,
    },
    thisMonth: row?.this_month ?? 0,
    departments: departments.rows[0]?.count ?? 0,
    users: users?.rows[0]?.count ?? null,
    recent: recent.items,
  };
}

export interface ReportSummaryFilters {
  q?: string;
  type?: DocumentListFilters['type'];
  status?: DocumentListFilters['status'];
  departmentId?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface ReportSummary {
  total: number;
  byStatus: Array<{ status: string; count: number }>;
  byType: Array<{ type: string; count: number }>;
  byDepartment: Array<{ department: string; count: number }>;
  byMonth: Array<{ month: string; count: number }>;
}

function buildFilterClause(filters: ReportSummaryFilters, params: unknown[]): string {
  const conditions: string[] = ['doc.deleted_at IS NULL'];
  const addParam = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };
  if (filters.q) {
    const pattern = addParam(containsPattern(filters.q));
    conditions.push(
      `(doc.reference ILIKE ${pattern} ESCAPE '\\' OR doc.title ILIKE ${pattern} ESCAPE '\\' ` +
        `OR doc.sender ILIKE ${pattern} ESCAPE '\\' OR doc.recipient ILIKE ${pattern} ESCAPE '\\' ` +
        `OR dep.name ILIKE ${pattern} ESCAPE '\\')`,
    );
  }
  if (filters.type) conditions.push(`doc.doc_type = ${addParam(filters.type)}`);
  if (filters.status) conditions.push(`doc.status = ${addParam(filters.status)}`);
  if (filters.departmentId) conditions.push(`doc.department_id = ${addParam(filters.departmentId)}`);
  if (filters.dateFrom) conditions.push(`doc.transaction_date >= ${addParam(filters.dateFrom)}`);
  if (filters.dateTo) conditions.push(`doc.transaction_date <= ${addParam(filters.dateTo)}`);
  return `WHERE ${conditions.join(' AND ')}`;
}

export async function getReportSummary(pool: Pool, filters: ReportSummaryFilters): Promise<ReportSummary> {
  const baseParams: unknown[] = [];
  const where = buildFilterClause(filters, baseParams);

  const [statusRows, typeRows, departmentRows, monthRows] = await Promise.all([
    pool.query<{ status: string; count: number }>(
      `SELECT doc.status::text AS status, count(*)::int AS count
         FROM documents doc LEFT JOIN departments dep ON dep.id = doc.department_id
         ${where} GROUP BY doc.status ORDER BY doc.status`,
      baseParams,
    ),
    pool.query<{ type: string; count: number }>(
      `SELECT doc.doc_type::text AS type, count(*)::int AS count
         FROM documents doc LEFT JOIN departments dep ON dep.id = doc.department_id
         ${where} GROUP BY doc.doc_type ORDER BY doc.doc_type`,
      baseParams,
    ),
    pool.query<{ department: string; count: number }>(
      `SELECT COALESCE(dep.name, 'غير محددة') AS department, count(*)::int AS count
         FROM documents doc LEFT JOIN departments dep ON dep.id = doc.department_id
         ${where} GROUP BY COALESCE(dep.name, 'غير محددة') ORDER BY count DESC LIMIT 20`,
      baseParams,
    ),
    pool.query<{ month: string; count: number }>(
      `SELECT to_char(date_trunc('month', doc.transaction_date), 'YYYY-MM') AS month, count(*)::int AS count
         FROM documents doc LEFT JOIN departments dep ON dep.id = doc.department_id
         ${where} AND doc.transaction_date >= date_trunc('month', now()) - interval '11 months'
        GROUP BY 1 ORDER BY 1 ASC`,
      baseParams,
    ),
  ]);

  const total = statusRows.rows.reduce((sum, row) => sum + row.count, 0);
  return {
    total,
    byStatus: statusRows.rows,
    byType: typeRows.rows,
    byDepartment: departmentRows.rows,
    byMonth: monthRows.rows,
  };
}

export interface CsvExportRow {
  reference: string;
  title: string;
  type: string;
  date: string;
  sender: string;
  recipient: string;
  department: string;
  status: string;
  notes: string;
  files_count: number;
  created_at: Date;
}

/** يجمع صفوف التقرير للتصدير (بحد أقصى ثابت لحماية الذاكرة). */
export async function collectDocumentsForCsv(
  db: Queryable,
  filters: ReportSummaryFilters,
  limit: number,
): Promise<CsvExportRow[]> {
  const params: unknown[] = [];
  const where = buildFilterClause(filters, params);
  params.push(limit);
  const { rows } = await db.query<CsvExportRow>(
    `SELECT doc.reference, doc.title, doc.doc_type::text AS type,
            to_char(doc.transaction_date, 'YYYY-MM-DD') AS date,
            doc.sender, doc.recipient,
            COALESCE(dep.name, 'غير محددة') AS department,
            doc.status::text AS status, doc.notes,
            (SELECT count(*)::int FROM document_files f WHERE f.document_id = doc.id) AS files_count,
            doc.created_at
       FROM documents doc
       LEFT JOIN departments dep ON dep.id = doc.department_id
       ${where}
      ORDER BY doc.transaction_date DESC, doc.id ASC
      LIMIT $${params.length}`,
    params,
  );
  return rows;
}
