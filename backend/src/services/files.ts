import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Pool } from 'pg';
import type { AppConfig } from '../config.js';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../lib/errors.js';
import type { StorageProvider } from './storage/types.js';

/**
 * أنواع المرفقات المسموحة: الامتداد -> نوع المحتوى المعتمد.
 * يُشتق نوع المحتوى المخزَّن من الامتداد وليس من قيمة العميل،
 * كما يُفحص أن النوع المعلن من المتصفح لا يتعارض مع الفئة المتوقعة.
 */
export const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  rtf: 'application/rtf',
  txt: 'text/plain',
  csv: 'text/csv',
};

export const ALLOWED_EXTENSIONS = Object.keys(MIME_BY_EXTENSION);

export function extensionOf(filename: string): string | null {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(filename.trim());
  return match ? match[1]!.toLowerCase() : null;
}

export function sanitizeOriginalName(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? '';
  // إزالة أحرف التحكم (حماية من حقن الترويسات) ثم تحديد الطول.
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return (cleaned.length > 0 ? cleaned : 'ملف').slice(0, 300);
}

export function resolveMimeType(filename: string): { extension: string; mimeType: string } {
  const extension = extensionOf(filename);
  const mimeType = extension ? MIME_BY_EXTENSION[extension] : undefined;
  if (!extension || !mimeType) {
    throw ApiError.badRequest(
      'unsupported_file_type',
      `نوع الملف غير مدعوم. الأنواع المسموحة: ${ALLOWED_EXTENSIONS.join(', ')}`,
    );
  }
  return { extension, mimeType };
}

/**
 * مفتاح التخزين الداخلي: مسار نسبي مولَّد بالكامل من الخادم
 * (لا يدخل اسم الملف الأصلي في المسار إطلاقاً)، وهو نفس الشكل لمزوّد
 * التخزين المحلي والنسخة الوهمية في الاختبارات.
 */
export function buildStorageKey(documentId: string, fileId: string, extension: string): string {
  return `documents/${documentId}/${fileId}.${extension}`;
}

export function attachmentContentDisposition(filename: string): string {
  const asciiFallback = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || 'attachment';
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

export interface FileRecordPublic {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string | null;
  createdAt: Date;
  uploadedByName: string | null;
}

interface FileRow {
  id: string;
  original_name: string;
  mime_type: string;
  size_bytes: string | number;
  checksum_sha256: string | null;
  created_at: Date;
  uploaded_by_name: string | null;
}

function toFileRecord(row: FileRow): FileRecordPublic {
  return {
    id: row.id,
    originalName: row.original_name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    checksumSha256: row.checksum_sha256,
    createdAt: row.created_at,
    uploadedByName: row.uploaded_by_name,
  };
}

export async function listFilesForDocument(db: Queryable, documentId: string): Promise<FileRecordPublic[]> {
  const { rows } = await db.query<FileRow>(
    `SELECT f.id, f.original_name, f.mime_type, f.size_bytes, f.checksum_sha256, f.created_at,
            uploader.display_name AS uploaded_by_name
       FROM document_files f
       LEFT JOIN users uploader ON uploader.id = f.uploaded_by
      WHERE f.document_id = $1
      ORDER BY f.created_at ASC`,
    [documentId],
  );
  return rows.map(toFileRecord);
}

export interface StoredFileWithDocument {
  file: FileRecordPublic & { storageKey: string; storageProvider: string; documentId: string };
  document: { id: string; reference: string; deletedAt: Date | null };
}

export async function getFileWithDocument(db: Queryable, fileId: string): Promise<StoredFileWithDocument | null> {
  const { rows } = await db.query<FileRow & {
    storage_key: string;
    storage_provider: string;
    document_id: string;
    doc_reference: string;
    doc_deleted_at: Date | null;
  }>(
    `SELECT f.id, f.original_name, f.mime_type, f.size_bytes, f.checksum_sha256, f.created_at,
            f.storage_key, f.storage_provider, f.document_id,
            uploader.display_name AS uploaded_by_name,
            doc.reference AS doc_reference, doc.deleted_at AS doc_deleted_at
       FROM document_files f
       JOIN documents doc ON doc.id = f.document_id
       LEFT JOIN users uploader ON uploader.id = f.uploaded_by
      WHERE f.id = $1`,
    [fileId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    file: {
      ...toFileRecord(row),
      storageKey: row.storage_key,
      storageProvider: row.storage_provider,
      documentId: row.document_id,
    },
    document: { id: row.document_id, reference: row.doc_reference, deletedAt: row.doc_deleted_at },
  };
}

export async function deleteFileRow(db: Queryable, fileId: string): Promise<boolean> {
  const result = await db.query('DELETE FROM document_files WHERE id = $1', [fileId]);
  return (result.rowCount ?? 0) > 0;
}

export interface StoreAttachmentInput {
  documentId: string;
  userId: string;
  stream: Readable & { truncated?: boolean };
  filename: string;
  declaredMimeType?: string;
}

export interface StoreAttachmentDeps {
  pool: Pool;
  storage: StorageProvider;
  config: AppConfig;
}

/**
 * يخزّن مرفقاً جديداً:
 *   1. يتحقق من الامتداد والنوع والحجم.
 *   2. يكتب الملف مؤقتاً على القرص (مع بصمة SHA-256) دون تحميله كاملاً في الذاكرة.
 *   3. يرفعه إلى مزوّد التخزين، ثم يسجّل السطر في قاعدة البيانات.
 *   4. عند فشل التسجيل بعد نجاح الرفع، يحذف الكائن من التخزين (تعويض) كي لا يبقى يتيم.
 */
export async function storeAttachment(
  deps: StoreAttachmentDeps,
  input: StoreAttachmentInput,
): Promise<FileRecordPublic & { storageKey: string }> {
  const { extension, mimeType } = resolveMimeType(input.filename);
  if (
    input.declaredMimeType &&
    input.declaredMimeType !== 'application/octet-stream' &&
    input.declaredMimeType !== mimeType
  ) {
    const declaredCategory = input.declaredMimeType.split('/')[0];
    const expectedCategory = mimeType.split('/')[0];
    const sameFamily =
      (declaredCategory === 'image' && expectedCategory === 'image') ||
      (declaredCategory === 'text' && expectedCategory === 'text') ||
      input.declaredMimeType === 'application/octet-stream';
    if (!sameFamily) {
      throw ApiError.badRequest(
        'mime_mismatch',
        'نوع المحتوى المعلن للملف لا يطابق امتداده. تأكد من صحة الملف.',
      );
    }
  }

  const originalName = sanitizeOriginalName(input.filename);
  const fileId = randomUUID();
  const storageKey = buildStorageKey(input.documentId, fileId, extension);
  const maxBytes = deps.config.uploadMaxMb * 1024 * 1024;

  const tempDir = await mkdtemp(path.join(tmpdir(), 'hlc-upload-'));
  const tempPath = path.join(tempDir, 'upload.bin');
  const hash = createHash('sha256');
  let size = 0;

  try {
    const tap = new Transform({
      transform(chunk: Buffer, _encoding, callback): void {
        size += chunk.length;
        if (size > maxBytes) {
          callback(ApiError.payloadTooLarge(`حجم الملف يتجاوز الحد المسموح (${deps.config.uploadMaxMb} ميجابايت).`));
          return;
        }
        hash.update(chunk);
        callback(null, chunk);
      },
    });

    try {
      await pipeline(input.stream, tap, createWriteStream(tempPath));
    } catch (error) {
      if (
        error instanceof ApiError ||
        input.stream.truncated === true ||
        (typeof error === 'object' && error !== null && (error as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE')
      ) {
        throw error instanceof ApiError
          ? error
          : ApiError.payloadTooLarge(`حجم الملف يتجاوز الحد المسموح (${deps.config.uploadMaxMb} ميجابايت).`);
      }
      throw error;
    }

    if (input.stream.truncated === true) {
      throw ApiError.payloadTooLarge(
        `حجم الملف يتجاوز الحد المسموح (${deps.config.uploadMaxMb} ميجابايت).`,
      );
    }

    const checksum = hash.digest('hex');
    await deps.storage.putObject(storageKey, createReadStream(tempPath), {
      contentType: mimeType,
      contentLength: size,
    });

    try {
      const { rows } = await deps.pool.query<{ id: string; created_at: Date }>(
        `INSERT INTO document_files
           (document_id, original_name, mime_type, size_bytes, checksum_sha256, storage_provider, storage_key, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, created_at`,
        [
          input.documentId,
          originalName,
          mimeType,
          size,
          checksum,
          deps.storage.name,
          storageKey,
          input.userId,
        ],
      );
      const row = rows[0];
      if (!row) throw new Error('failed to insert document_files row');
      return {
        id: row.id,
        originalName,
        mimeType,
        sizeBytes: size,
        checksumSha256: checksum,
        createdAt: row.created_at,
        uploadedByName: null,
        storageKey,
      };
    } catch (error) {
      // تعويض: حذف الكائن المرفوع كي لا يبقى يتيماً في التخزين.
      await deps.storage.deleteObject(storageKey).catch(() => undefined);
      throw error;
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
