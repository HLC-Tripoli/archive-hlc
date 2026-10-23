import type { Pool, PoolClient } from 'pg';
import type { Queryable } from '../db/pool.js';
import { isValidIsoDate, isValidIsoDateTime } from '../lib/dates.js';
import { withTransaction } from '../db/pool.js';
import {
  DOCUMENT_TYPES,
  DOCUMENT_STATUSES,
  normalizeSequenceNumber,
  SEQUENCE_NUMBER_MAX_LENGTH,
  type DocumentStatus,
  type DocumentTypeDb,
} from './documents.js';
import { writeAudit } from './audit.js';

/**
 * استيراد بيانات النموذج القديم (localStorage) والنسخ الاحتياطية JSON.
 * الضمانات:
 *   * العملية كلها داخل معاملة واحدة (نجاح كامل أو تراجع كامل).
 *   * التكرار يُكتشف عبر المعرّف القديم (legacy_id) أو الرقم الاشاري النشط،
 *     لذا إعادة تشغيل الاستيراد لا تُنشئ سجلات مكرّرة.
 *   * كل سجل مرفوض يُعاد مع سبب واضح بالعربية.
 *   * يُسجَّل ملخّص العملية في data_imports وسجل التدقيق.
 */

const LEGACY_STATUS_MAP: Record<string, DocumentStatus> = {
  'جديدة': 'new',
  'قيد الإجراء': 'in_progress',
  'مكتملة': 'completed',
  'مؤرشفة': 'archived',
};

export function normalizeStatus(value: unknown): DocumentStatus | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if ((DOCUMENT_STATUSES as readonly string[]).includes(trimmed)) {
    return trimmed as DocumentStatus;
  }
  return LEGACY_STATUS_MAP[trimmed] ?? null;
}

export interface ImportDocumentInput {
  legacyId?: string | null;
  reference: string;
  title: string;
  type: string;
  date: string;
  sender?: string | null;
  recipient?: string | null;
  sequenceNumber?: string | null;
  /** حالة تاريخية من نسخة قديمة؛ تُحفظ في قاعدة البيانات ولا تُعرض في الواجهة. */
  status?: string | null;
  notes?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  /** لبيانات المتصفح: معرّف القسم القديم؛ وللنسخ الاحتياطية: اسم القسم. */
  departmentLegacyId?: string | null;
  departmentName?: string | null;
}

export interface ImportRecordResult {
  index: number;
  legacyId: string | null;
  status: 'imported' | 'duplicate' | 'rejected';
  reason?: string;
}

export interface ImportSummary {
  documentsImported: number;
  departmentsCreated: number;
  duplicates: number;
  rejected: number;
}

export interface ImportOutcome {
  summary: ImportSummary;
  results: ImportRecordResult[];
  warnings: string[];
}

interface ImportContext {
  pool: Pool;
  actorUserId: string;
  actorUsername: string;
  ip?: string | null;
  userAgent?: string | null;
}

async function prepareDepartmentMaps(
  client: PoolClient,
  entries: Array<{ legacyId?: string | null; name: string }>,
): Promise<{ legacyMap: Map<string, string>; nameMap: Map<string, string>; created: number }> {
  const legacyMap = new Map<string, string>();
  const nameMap = new Map<string, string>();
  const { rows } = await client.query<{ id: string; name: string; legacy_id: string | null }>(
    'SELECT id, name, legacy_id FROM departments',
  );
  for (const row of rows) {
    nameMap.set(row.name.toLowerCase(), row.id);
    if (row.legacy_id) legacyMap.set(row.legacy_id, row.id);
  }

  let created = 0;
  for (const entry of entries) {
    const name = entry.name.trim();
    if (!name) continue;
    const legacyId = entry.legacyId?.trim() || null;
    const existingByLegacy = legacyId ? legacyMap.get(legacyId) : undefined;
    const existingByName = nameMap.get(name.toLowerCase());
    if (existingByLegacy || existingByName) {
      const id = (existingByLegacy ?? existingByName)!;
      nameMap.set(name.toLowerCase(), id);
      if (legacyId) legacyMap.set(legacyId, id);
      continue;
    }
    const inserted = await client.query<{ id: string }>(
      'INSERT INTO departments (name, legacy_id) VALUES ($1, $2) RETURNING id',
      [name, legacyId],
    );
    const id = inserted.rows[0]!.id;
    created += 1;
    nameMap.set(name.toLowerCase(), id);
    if (legacyId) legacyMap.set(legacyId, id);
  }

  return { legacyMap, nameMap, created };
}

function validateDocumentInput(doc: ImportDocumentInput): string | null {
  if (!doc.reference || !doc.reference.trim()) return 'الرقم الاشاري مفقود.';
  if (doc.reference.trim().length > 200) return 'الرقم الاشاري أطول من الحد المسموح.';
  if (!doc.title || !doc.title.trim()) return 'موضوع الرسالة مفقود.';
  if (doc.title.trim().length > 500) return 'موضوع الرسالة أطول من الحد المسموح.';
  const sequenceNumber = normalizeSequenceNumber(doc.sequenceNumber);
  if (sequenceNumber && sequenceNumber.length > SEQUENCE_NUMBER_MAX_LENGTH) {
    return `رقم التسلسل أطول من الحد المسموح (${SEQUENCE_NUMBER_MAX_LENGTH} حرفاً).`;
  }
  if (!(DOCUMENT_TYPES as readonly string[]).includes(doc.type)) {
    return 'نوع المعاملة غير معروف (يجب أن يكون وارداً أو صادراً).';
  }
  if (!isValidIsoDate(doc.date)) return 'تاريخ الرسالة غير صالح (الصيغة المطلوبة YYYY-MM-DD).';
  if (doc.notes && doc.notes.length > 4000) return 'الملاحظات أطول من الحد المسموح.';
  return null;
}

async function importDocumentsCore(
  client: PoolClient,
  documents: ImportDocumentInput[],
  maps: { legacyMap: Map<string, string>; nameMap: Map<string, string> },
): Promise<{ results: ImportRecordResult[]; imported: number; duplicates: number; rejected: number; warnings: string[] }> {
  const results: ImportRecordResult[] = [];
  const warnings: string[] = [];
  let imported = 0;
  let duplicates = 0;
  let rejected = 0;

  for (let index = 0; index < documents.length; index += 1) {
    const doc = documents[index]!;
    const legacyId = doc.legacyId?.trim() || null;
    const invalidReason = validateDocumentInput(doc);
    if (invalidReason) {
      rejected += 1;
      results.push({ index, legacyId, status: 'rejected', reason: invalidReason });
      continue;
    }

    if (legacyId) {
      const duplicate = await client.query('SELECT 1 FROM documents WHERE legacy_id = $1', [legacyId]);
      if (duplicate.rows.length > 0) {
        duplicates += 1;
        results.push({ index, legacyId, status: 'duplicate', reason: 'مستورد مسبقاً (نفس المعرّف القديم).' });
        continue;
      }
    }
    const duplicateReference = await client.query(
      'SELECT 1 FROM documents WHERE lower(reference) = lower($1) AND deleted_at IS NULL LIMIT 1',
      [doc.reference.trim()],
    );
    if (duplicateReference.rows.length > 0) {
      duplicates += 1;
      results.push({ index, legacyId, status: 'duplicate', reason: 'يوجد مستند نشط بنفس الرقم الاشاري.' });
      continue;
    }

    let departmentId: string | null = null;
    const legacyDepartmentId = doc.departmentLegacyId?.trim();
    const departmentName = doc.departmentName?.trim();
    if (legacyDepartmentId) {
      departmentId = maps.legacyMap.get(legacyDepartmentId) ?? null;
    } else if (departmentName) {
      departmentId = maps.nameMap.get(departmentName.toLowerCase()) ?? null;
    }
    if ((legacyDepartmentId || departmentName) && !departmentId) {
      warnings.push(`السجل رقم ${index + 1}: تعذّر مطابقة القسم «${departmentName ?? legacyDepartmentId}»؛ استُورد بدون قسم.`);
    }

    // نحفظ الحالة التاريخية القادمة من النسخ القديمة كما هي إن كانت معروفة،
    // لكنها لا تدخل في أي استجابة أو تصدير جديد.
    const status = normalizeStatus(doc.status) ?? 'new';
    const sequenceNumber = normalizeSequenceNumber(doc.sequenceNumber);
    const createdAt = isValidIsoDateTime(doc.createdAt) ? doc.createdAt : null;
    const updatedAt = isValidIsoDateTime(doc.updatedAt) ? doc.updatedAt : null;

    await client.query(
      `INSERT INTO documents
         (reference, title, doc_type, transaction_date, sender, recipient, sequence_number,
          department_id, status, notes, created_by, updated_by, legacy_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11, $12,
               COALESCE($13::timestamptz, now()), COALESCE($14::timestamptz, COALESCE($13::timestamptz, now())))`,
      [
        doc.reference.trim(),
        doc.title.trim(),
        doc.type as DocumentTypeDb,
        doc.date,
        (doc.sender ?? '').trim().slice(0, 200),
        (doc.recipient ?? '').trim().slice(0, 200),
        sequenceNumber,
        departmentId,
        status,
        (doc.notes ?? '').slice(0, 4000),
        null,
        legacyId,
        createdAt,
        updatedAt,
      ],
    );
    imported += 1;
    results.push({ index, legacyId, status: 'imported' });
  }

  return { results, imported, duplicates, rejected, warnings };
}

export interface LegacyImportPayload {
  source: string;
  departments: Array<{ legacyId?: string | null; name: string }>;
  documents: ImportDocumentInput[];
}

export async function importLegacyData(
  context: ImportContext,
  payload: LegacyImportPayload,
): Promise<ImportOutcome> {
  return withTransaction(context.pool, async (client) => {
    const maps = await prepareDepartmentMaps(client, payload.departments);

    const core = await importDocumentsCore(client, payload.documents, {
      legacyMap: maps.legacyMap,
      nameMap: maps.nameMap,
    });

    const summary: ImportSummary = {
      documentsImported: core.imported,
      departmentsCreated: maps.created,
      duplicates: core.duplicates,
      rejected: core.rejected,
    };

    await client.query(
      `INSERT INTO data_imports (kind, source, actor_user_id, stats) VALUES ('legacy_browser', $1, $2, $3)`,
      [payload.source.slice(0, 100), context.actorUserId, JSON.stringify(summary)],
    );
    await writeAudit(
      client,
      {
        actorUserId: context.actorUserId,
        actorUsername: context.actorUsername,
        action: 'import.legacy',
        entityType: 'data_import',
        details: summary,
      },
      { ip: context.ip, userAgent: context.userAgent },
    );

    return { summary, results: core.results, warnings: core.warnings };
  });
}

export interface BackupImportPayload {
  formatVersion: number;
  departments: Array<{ name: string; isActive?: boolean }>;
  documents: ImportDocumentInput[];
}

export async function importBackupData(
  context: ImportContext,
  payload: BackupImportPayload,
): Promise<ImportOutcome> {
  return withTransaction(context.pool, async (client) => {
    const maps = await prepareDepartmentMaps(
      client,
      payload.departments.map((department) => ({ name: department.name })),
    );

    const core = await importDocumentsCore(client, payload.documents, {
      legacyMap: maps.legacyMap,
      nameMap: maps.nameMap,
    });

    const filesWarnings: string[] = [];
    const documentsWithFiles = payload.documents.filter((doc) => {
      const files = (doc as { files?: unknown[] }).files;
      return Array.isArray(files) && files.length > 0;
    }).length;
    if (documentsWithFiles > 0) {
      filesWarnings.push(
        `تضمّنت النسخة الاحتياطية بيانات ${documentsWithFiles} مرفقاً؛ لا تُستورد محتويات المرفقات من ملف JSON ويجب إعادة رفعها يدوياً.`,
      );
    }

    const summary: ImportSummary = {
      documentsImported: core.imported,
      departmentsCreated: maps.created,
      duplicates: core.duplicates,
      rejected: core.rejected,
    };

    await client.query(
      `INSERT INTO data_imports (kind, source, actor_user_id, stats) VALUES ('json_backup', $1, $2, $3)`,
      [`format-${payload.formatVersion}`, context.actorUserId, JSON.stringify(summary)],
    );
    await writeAudit(
      client,
      {
        actorUserId: context.actorUserId,
        actorUsername: context.actorUsername,
        action: 'import.backup',
        entityType: 'data_import',
        details: summary,
      },
      { ip: context.ip, userAgent: context.userAgent },
    );

    return { summary, results: core.results, warnings: [...core.warnings, ...filesWarnings] };
  });
}

export interface BackupExport {
  formatVersion: number;
  app: string;
  exportedAt: string;
  notes: string;
  departments: Array<{ name: string; isActive: boolean }>;
  documents: Array<Record<string, unknown>>;
}

/** يبني نسخة JSON كاملة (البيانات الوصفية فقط؛ لا تُضمَّن محتويات المرفقات). */
export async function buildBackupExport(pool: Pool): Promise<BackupExport> {
  const departments = await pool.query<{ name: string; is_active: boolean }>(
    'SELECT name, is_active FROM departments ORDER BY name ASC',
  );
  const documents = await pool.query<{
    reference: string;
    sequence_number: string | null;
    title: string;
    doc_type: DocumentTypeDb;
    transaction_date: string;
    sender: string;
    recipient: string;
    notes: string;
    legacy_id: string | null;
    created_at: Date;
    updated_at: Date;
    department_name: string | null;
    file_count: number;
  }>(
    `SELECT doc.reference, doc.sequence_number, doc.title, doc.doc_type,
            to_char(doc.transaction_date, 'YYYY-MM-DD') AS transaction_date,
            doc.sender, doc.recipient, doc.notes, doc.legacy_id,
            doc.created_at, doc.updated_at,
            dep.name AS department_name,
            (SELECT count(*)::int FROM document_files f WHERE f.document_id = doc.id) AS file_count
       FROM documents doc
       LEFT JOIN departments dep ON dep.id = doc.department_id
      WHERE doc.deleted_at IS NULL
      ORDER BY doc.created_at ASC`,
  );

  return {
    formatVersion: 1,
    app: 'archive-hlc',
    exportedAt: new Date().toISOString(),
    notes:
      'نسخة احتياطية للبيانات الوصفية فقط. لا تُضمَّن محتويات المرفقات؛ تُبقي الملفات في خدمة التخزين ويجب نسخها بشكل مستقل.',
    departments: departments.rows.map((row) => ({ name: row.name, isActive: row.is_active })),
    documents: documents.rows.map((row) => ({
      reference: row.reference,
      sequenceNumber: row.sequence_number,
      title: row.title,
      type: row.doc_type,
      date: row.transaction_date,
      sender: row.sender,
      recipient: row.recipient,
      notes: row.notes,
      legacyId: row.legacy_id,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      departmentName: row.department_name,
      filesCount: row.file_count,
    })),
  };
}
