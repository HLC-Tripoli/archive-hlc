import type { Pool } from 'pg';
import type { Queryable } from '../db/pool.js';
import type { DocumentAccessScope } from '../lib/access.js';
import { containsPattern } from '../lib/sql.js';
import { listFilesForDocument, type FileRecordPublic } from './files.js';

export type DocumentTypeDb = 'incoming' | 'outgoing' | 'other' | 'minutes' | 'proposal' | 'report';

/**
 * حالة المستند قيمة تاريخية داخلية فقط بعد إيقاف الحقل من واجهة المستخدم.
 * تبقى في قاعدة البيانات للحفاظ على السجلات القديمة والنسخ الاحتياطية،
 * وتُستخدم قيمتها الافتراضية عند الإدراج كي يبقى القيد NOT NULL صالحاً.
 */
export type DocumentStatus = 'new' | 'in_progress' | 'completed' | 'archived';

export const DOCUMENT_TYPES: readonly DocumentTypeDb[] = [
  'incoming',
  'outgoing',
  'other',
  'minutes',
  'proposal',
  'report',
];
export const DOCUMENT_STATUSES: readonly DocumentStatus[] = ['new', 'in_progress', 'completed', 'archived'];
export const DEFAULT_DOCUMENT_STATUS: DocumentStatus = 'new';

export const SEQUENCE_NUMBER_MAX_LENGTH = 100;

/** يطبّع رقم التسلسل: تشذيب الفراغات الطرفية، والفراغ فقط يصبح NULL. */
export function normalizeSequenceNumber(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

export interface DocumentDepartmentRef {
  id: string;
  name: string;
}

export interface DocumentListItem {
  id: string;
  reference: string | null;
  sequenceNumber: string | null;
  title: string | null;
  type: DocumentTypeDb;
  date: string;
  sender: string;
  recipient: string;
  department: DocumentDepartmentRef | null;
  filesCount: number;
  createdByName: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface DocumentDetail extends DocumentListItem {
  notes: string;
  updatedByName: string | null;
  deletedByName: string | null;
  restoredAt: Date | null;
  files: FileRecordPublic[];
}

export interface DocumentListFilters {
  q?: string;
  type?: DocumentTypeDb;
  departmentId?: string;
  dateFrom?: string;
  dateTo?: string;
  includeDeleted: boolean;
  sort: 'date' | 'createdAt' | 'updatedAt' | 'reference' | 'sequenceNumber' | 'title';
  order: 'asc' | 'desc';
  page: number;
  pageSize: number;
}

const SORT_EXPRESSIONS: Record<DocumentListFilters['sort'], string> = {
  date: 'doc.transaction_date',
  createdAt: 'doc.created_at',
  updatedAt: 'doc.updated_at',
  reference: "lower(COALESCE(doc.reference, ''))",
  sequenceNumber: "lower(COALESCE(doc.sequence_number, ''))",
  title: "lower(COALESCE(doc.title, ''))",
};

interface DocumentListRow {
  id: string;
  reference: string | null;
  sequence_number: string | null;
  title: string | null;
  doc_type: DocumentTypeDb;
  transaction_date: string;
  sender: string;
  recipient: string;
  department_id: string | null;
  department_name: string | null;
  files_count: number;
  created_by_name: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

interface DocumentDetailRow extends DocumentListRow {
  notes: string;
  updated_by_name: string | null;
  deleted_by_name: string | null;
  restored_at: Date | null;
}

function toListItem(row: DocumentListRow | DocumentDetailRow): DocumentListItem {
  return {
    id: row.id,
    reference: row.reference,
    sequenceNumber: row.sequence_number,
    title: row.title,
    type: row.doc_type,
    date: row.transaction_date,
    sender: row.sender,
    recipient: row.recipient,
    department:
      row.department_id && row.department_name
        ? { id: row.department_id, name: row.department_name }
        : null,
    filesCount: row.files_count,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

const LIST_SELECT = `
  SELECT doc.id, doc.reference, doc.sequence_number, doc.title, doc.doc_type,
         to_char(doc.transaction_date, 'YYYY-MM-DD') AS transaction_date,
         doc.sender, doc.recipient, doc.department_id, dep.name AS department_name,
         (SELECT count(*)::int FROM document_files f WHERE f.document_id = doc.id) AS files_count,
         creator.display_name AS created_by_name,
         doc.created_at, doc.updated_at, doc.deleted_at
    FROM documents doc
    LEFT JOIN departments dep ON dep.id = doc.department_id
    LEFT JOIN users creator ON creator.id = doc.created_by`;

export async function listDocuments(
  pool: Pool,
  filters: DocumentListFilters,
  access: DocumentAccessScope,
): Promise<{ items: DocumentListItem[]; total: number }> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  const addParam = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };

  // نطاق الموظف يُضاف دائماً قبل أي مرشِّح من العميل، ولا يمكن لأي طلب
  // (departmentId مختلف، includeDeleted، بحث واسع...) أن يوسّع هذا النطاق.
  if (!access.isAdmin) {
    conditions.push('doc.deleted_at IS NULL');
    conditions.push(`doc.department_id = ${addParam(access.departmentId)}`);
  } else if (!filters.includeDeleted) {
    conditions.push('doc.deleted_at IS NULL');
  }
  if (filters.q) {
    const pattern = addParam(containsPattern(filters.q));
    conditions.push(
      `(doc.reference ILIKE ${pattern} ESCAPE '\\' OR doc.sequence_number ILIKE ${pattern} ESCAPE '\\' ` +
        `OR doc.title ILIKE ${pattern} ESCAPE '\\' ` +
        `OR doc.sender ILIKE ${pattern} ESCAPE '\\' OR doc.recipient ILIKE ${pattern} ESCAPE '\\' ` +
        `OR dep.name ILIKE ${pattern} ESCAPE '\\')`,
    );
  }
  if (filters.type) conditions.push(`doc.doc_type = ${addParam(filters.type)}`);
  if (filters.departmentId) conditions.push(`doc.department_id = ${addParam(filters.departmentId)}`);
  if (filters.dateFrom) conditions.push(`doc.transaction_date >= ${addParam(filters.dateFrom)}`);
  if (filters.dateTo) conditions.push(`doc.transaction_date <= ${addParam(filters.dateTo)}`);

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // عدّاد منفصل: count(*) OVER() كان يعيد صفراً عندما تتجاوز الإزاحة نهاية
  // النتائج، وهو ما كان يفسد إجمالي الصفحات في الواجهة.
  const countResult = await pool.query<{ total: number }>(
    `SELECT count(*)::int AS total
       FROM documents doc
       LEFT JOIN departments dep ON dep.id = doc.department_id
       ${where}`,
    params,
  );

  const sortExpression = SORT_EXPRESSIONS[filters.sort];
  const direction = filters.order === 'asc' ? 'ASC' : 'DESC';
  const limit = addParam(filters.pageSize);
  const offset = addParam((filters.page - 1) * filters.pageSize);

  const { rows } = await pool.query<DocumentListRow>(
    `${LIST_SELECT}
     ${where}
     ORDER BY ${sortExpression} ${direction} NULLS LAST, doc.id ASC
     LIMIT ${limit} OFFSET ${offset}`,
    params,
  );

  return {
    items: rows.map((row) => toListItem(row)),
    total: countResult.rows[0]?.total ?? 0,
  };
}

export async function getDocumentById(
  db: Queryable,
  id: string,
  access: DocumentAccessScope,
): Promise<DocumentDetail | null> {
  const params: unknown[] = [id];
  const conditions = ['doc.id = $1'];
  if (!access.isAdmin) {
    // الموظف لا يرى إلا مستندات إدارته، ولا يرى المحذوفة إطلاقاً.
    params.push(access.departmentId);
    conditions.push(`doc.department_id = $${params.length}`);
    conditions.push('doc.deleted_at IS NULL');
  }
  const { rows } = await db.query<DocumentDetailRow>(
    `SELECT doc.id, doc.reference, doc.sequence_number, doc.title, doc.doc_type,
            to_char(doc.transaction_date, 'YYYY-MM-DD') AS transaction_date,
            doc.sender, doc.recipient, doc.department_id, dep.name AS department_name,
            doc.notes,
            (SELECT count(*)::int FROM document_files f WHERE f.document_id = doc.id) AS files_count,
            creator.display_name AS created_by_name,
            updater.display_name AS updated_by_name,
            deleter.display_name AS deleted_by_name,
            doc.restored_at,
            doc.created_at, doc.updated_at, doc.deleted_at
       FROM documents doc
       LEFT JOIN departments dep ON dep.id = doc.department_id
       LEFT JOIN users creator ON creator.id = doc.created_by
       LEFT JOIN users updater ON updater.id = doc.updated_by
       LEFT JOIN users deleter ON deleter.id = doc.deleted_by
      WHERE ${conditions.join(' AND ')}`,
    params,
  );
  const row = rows[0];
  if (!row) return null;
  const files = await listFilesForDocument(db, id);
  return {
    ...toListItem(row),
    notes: row.notes,
    updatedByName: row.updated_by_name,
    deletedByName: row.deleted_by_name,
    restoredAt: row.restored_at,
    files,
  };
}

export interface DocumentInput {
  reference?: string | null;
  title?: string | null;
  type: DocumentTypeDb;
  date?: string | null;
  sender?: string;
  recipient?: string;
  sequenceNumber?: string | null;
  departmentId?: string | null;
  notes?: string;
}

export type DocumentPatch = Partial<DocumentInput>;

const PATCH_COLUMNS: Record<keyof DocumentInput, string> = {
  reference: 'reference',
  title: 'title',
  type: 'doc_type',
  date: 'transaction_date',
  sender: 'sender',
  recipient: 'recipient',
  sequenceNumber: 'sequence_number',
  departmentId: 'department_id',
  notes: 'notes',
};

export async function insertDocument(
  db: Queryable,
  input: DocumentInput,
  userId: string,
  access: DocumentAccessScope,
): Promise<string> {
  // إدارة الموظف تأتي من هويته الموثوقة، لا من جسم الطلب. حتى لو أخطأ
  // استدعاء أعلى المستوى، لا يمكن إنشاء مستند موظف في إدارة أخرى.
  const departmentId = access.isAdmin ? input.departmentId : access.departmentId;
  if (!access.isAdmin && !departmentId) {
    throw new Error('employee document requires an assigned department');
  }
  const dateVal = (input.date ?? '').trim() || new Date().toISOString().slice(0, 10);
  const refVal = (input.reference ?? '').trim() || null;
  const titleVal = (input.title ?? '').trim() || null;
  const senderVal = (input.sender ?? '').trim();
  const recipientVal = (input.recipient ?? '').trim();
  const notesVal = (input.notes ?? '').trim();
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO documents
       (reference, title, doc_type, transaction_date, sender, recipient, sequence_number,
        department_id, status, notes, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
     RETURNING id`,
    [
      refVal,
      titleVal,
      input.type,
      dateVal,
      senderVal,
      recipientVal,
      input.sequenceNumber,
      departmentId,
      DEFAULT_DOCUMENT_STATUS,
      notesVal,
      userId,
    ],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error('failed to insert document');
  return id;
}

export type DocumentUpdateResult =
  | { status: 'not_found' }
  | { status: 'deleted' }
  | { status: 'department_forbidden' }
  | { status: 'updated'; changedFields: string[] };

export async function updateDocument(
  db: Queryable,
  id: string,
  patch: DocumentPatch,
  userId: string,
  access: DocumentAccessScope,
): Promise<DocumentUpdateResult> {
  const existingParams: unknown[] = [id];
  let existingScope = '';
  if (!access.isAdmin) {
    existingParams.push(access.departmentId);
    existingScope = ` AND department_id = $${existingParams.length}`;
  }
  const existing = await db.query<{ deleted_at: Date | null }>(
    `SELECT deleted_at FROM documents WHERE id = $1${existingScope}`,
    existingParams,
  );
  const existingRow = existing.rows[0];
  if (!existingRow) return { status: 'not_found' };
  if (existingRow.deleted_at) return { status: 'deleted' };

  // لا يمكن للموظف نقل مستنده إلى إدارة أخرى أو إزالته من إدارته.
  if (
    !access.isAdmin &&
    patch.departmentId !== undefined &&
    patch.departmentId !== access.departmentId
  ) {
    return { status: 'department_forbidden' };
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  const changedFields: string[] = [];
  for (const key of Object.keys(patch) as (keyof DocumentInput)[]) {
    const value = key === 'departmentId' && !access.isAdmin ? access.departmentId : patch[key];
    if (value === undefined) continue;
    params.push(value);
    sets.push(`${PATCH_COLUMNS[key]} = $${params.length}`);
    changedFields.push(key);
  }

  if (sets.length === 0) return { status: 'updated', changedFields };

  params.push(userId);
  sets.push(`updated_by = $${params.length}`);
  sets.push('updated_at = now()');
  params.push(id);
  const idParam = params.length;
  let scopeSql = '';
  if (!access.isAdmin) {
    params.push(access.departmentId);
    scopeSql = ` AND department_id = $${params.length}`;
  }
  // شرط الإدارة جزء من أمر UPDATE نفسه، لا مجرد فحص سابق في المسار.
  const result = await db.query(
    `UPDATE documents SET ${sets.join(', ')}
      WHERE id = $${idParam} AND deleted_at IS NULL${scopeSql}`,
    params,
  );
  if ((result.rowCount ?? 0) === 0) return { status: 'not_found' };
  return { status: 'updated', changedFields };
}

export async function softDeleteDocument(
  db: Queryable,
  id: string,
  userId: string,
): Promise<'not_found' | 'already_deleted' | 'deleted'> {
  const result = await db.query(
    `UPDATE documents
        SET deleted_at = now(), deleted_by = $2, updated_at = now(), updated_by = $2
      WHERE id = $1 AND deleted_at IS NULL`,
    [id, userId],
  );
  if ((result.rowCount ?? 0) > 0) return 'deleted';
  const existing = await db.query<{ id: string }>('SELECT id FROM documents WHERE id = $1', [id]);
  return existing.rows[0] ? 'already_deleted' : 'not_found';
}

export async function restoreDocument(
  db: Queryable,
  id: string,
  userId: string,
): Promise<'not_found' | 'not_deleted' | 'conflict' | 'restored'> {
  const existing = await db.query<{ deleted_at: Date | null; reference: string }>(
    'SELECT deleted_at, reference FROM documents WHERE id = $1',
    [id],
  );
  const row = existing.rows[0];
  if (!row) return 'not_found';
  if (!row.deleted_at) return 'not_deleted';
  const duplicate = await db.query<{ id: string }>(
    `SELECT id FROM documents
      WHERE lower(reference) = lower($1) AND deleted_at IS NULL AND id <> $2
      LIMIT 1`,
    [row.reference, id],
  );
  if (duplicate.rows.length > 0) return 'conflict';
  await db.query(
    `UPDATE documents
        SET deleted_at = NULL, deleted_by = NULL, restored_at = now(), restored_by = $2,
            updated_at = now(), updated_by = $2
      WHERE id = $1`,
    [id, userId],
  );
  return 'restored';
}
