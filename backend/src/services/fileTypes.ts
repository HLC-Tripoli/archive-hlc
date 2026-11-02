import type { Queryable } from '../db/pool.js';
import { ApiError } from '../lib/errors.js';

export interface FileTypeRecord {
  extension: string;
  mimeType: string;
  category: string;
  labelAr: string;
  labelEn: string;
  isEnabled: boolean;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateFileTypeInput {
  extension: string;
  mimeType: string;
  category?: string;
  labelAr?: string;
  labelEn?: string;
  isEnabled?: boolean;
}

export const DEFAULT_FILE_TYPES: Array<Omit<FileTypeRecord, 'createdAt' | 'updatedAt'>> = [
  { extension: 'pdf',  mimeType: 'application/pdf', category: 'document', labelAr: 'مستند PDF', labelEn: 'PDF Document', isEnabled: true, isDefault: true },
  { extension: 'doc',  mimeType: 'application/msword', category: 'document', labelAr: 'مستند Word قديم', labelEn: 'Word 97-2003 Document', isEnabled: true, isDefault: true },
  { extension: 'docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', category: 'document', labelAr: 'مستند Word حديث', labelEn: 'Word Document', isEnabled: true, isDefault: true },
  { extension: 'odt',  mimeType: 'application/vnd.oasis.opendocument.text', category: 'document', labelAr: 'مستند OpenDocument', labelEn: 'OpenDocument Text', isEnabled: true, isDefault: true },
  { extension: 'rtf',  mimeType: 'application/rtf', category: 'document', labelAr: 'نص منسق RTF', labelEn: 'Rich Text Format', isEnabled: true, isDefault: true },
  { extension: 'txt',  mimeType: 'text/plain', category: 'document', labelAr: 'ملف نصي عادي', labelEn: 'Plain Text Document', isEnabled: true, isDefault: true },

  { extension: 'jpg',  mimeType: 'image/jpeg', category: 'image', labelAr: 'صورة JPEG', labelEn: 'JPEG Image', isEnabled: true, isDefault: true },
  { extension: 'jpeg', mimeType: 'image/jpeg', category: 'image', labelAr: 'صورة JPEG', labelEn: 'JPEG Image', isEnabled: true, isDefault: true },
  { extension: 'png',  mimeType: 'image/png', category: 'image', labelAr: 'صورة PNG', labelEn: 'PNG Image', isEnabled: true, isDefault: true },
  { extension: 'webp', mimeType: 'image/webp', category: 'image', labelAr: 'صورة WebP', labelEn: 'WebP Image', isEnabled: true, isDefault: true },
  { extension: 'gif',  mimeType: 'image/gif', category: 'image', labelAr: 'صورة متحركة GIF', labelEn: 'GIF Image', isEnabled: true, isDefault: true },
  { extension: 'bmp',  mimeType: 'image/bmp', category: 'image', labelAr: 'صورة نقطية BMP', labelEn: 'Bitmap Image', isEnabled: true, isDefault: true },
  { extension: 'tif',  mimeType: 'image/tiff', category: 'image', labelAr: 'صورة فاكس TIFF', labelEn: 'TIFF Image', isEnabled: true, isDefault: true },
  { extension: 'tiff', mimeType: 'image/tiff', category: 'image', labelAr: 'صورة فاكس TIFF', labelEn: 'TIFF Image', isEnabled: true, isDefault: true },
  { extension: 'svg',  mimeType: 'image/svg+xml', category: 'image', labelAr: 'رسم متجهي SVG', labelEn: 'Scalable Vector Graphics', isEnabled: true, isDefault: true },

  { extension: 'xls',  mimeType: 'application/vnd.ms-excel', category: 'spreadsheet', labelAr: 'جدول Excel قديم', labelEn: 'Excel 97-2003 Workbook', isEnabled: true, isDefault: true },
  { extension: 'xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', category: 'spreadsheet', labelAr: 'جدول Excel حديث', labelEn: 'Excel Workbook', isEnabled: true, isDefault: true },
  { extension: 'ods',  mimeType: 'application/vnd.oasis.opendocument.spreadsheet', category: 'spreadsheet', labelAr: 'جدول OpenDocument', labelEn: 'OpenDocument Spreadsheet', isEnabled: true, isDefault: true },
  { extension: 'csv',  mimeType: 'text/csv', category: 'spreadsheet', labelAr: 'ملف قيم مفصولة بفواصل CSV', labelEn: 'CSV Spreadsheet', isEnabled: true, isDefault: true },

  { extension: 'ppt',  mimeType: 'application/vnd.ms-powerpoint', category: 'presentation', labelAr: 'عرض PowerPoint قديم', labelEn: 'PowerPoint Presentation', isEnabled: true, isDefault: true },
  { extension: 'pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', category: 'presentation', labelAr: 'عرض PowerPoint حديث', labelEn: 'PowerPoint Presentation', isEnabled: true, isDefault: true },
  { extension: 'odp',  mimeType: 'application/vnd.oasis.opendocument.presentation', category: 'presentation', labelAr: 'عرض OpenDocument', labelEn: 'OpenDocument Presentation', isEnabled: true, isDefault: true },

  { extension: 'zip',  mimeType: 'application/zip', category: 'archive', labelAr: 'أرشيف مضغوط ZIP', labelEn: 'ZIP Archive', isEnabled: true, isDefault: true },
  { extension: 'rar',  mimeType: 'application/vnd.rar', category: 'archive', labelAr: 'أرشيف مضغوط RAR', labelEn: 'RAR Archive', isEnabled: true, isDefault: true },
  { extension: '7z',   mimeType: 'application/x-7z-compressed', category: 'archive', labelAr: 'أرشيف مضغوط 7-Zip', labelEn: '7-Zip Archive', isEnabled: true, isDefault: true },

  { extension: 'json', mimeType: 'application/json', category: 'data', labelAr: 'ملف بيانات JSON', labelEn: 'JSON Data File', isEnabled: true, isDefault: true },
  { extension: 'xml',  mimeType: 'application/xml', category: 'data', labelAr: 'ملف بيانات XML', labelEn: 'XML Data File', isEnabled: true, isDefault: true },
];

let cachedAllowedTypes: Map<string, FileTypeRecord> | null = null;

function rowToRecord(row: any): FileTypeRecord {
  return {
    extension: row.extension,
    mimeType: row.mime_type,
    category: row.category,
    labelAr: row.label_ar,
    labelEn: row.label_en,
    isEnabled: row.is_enabled,
    isDefault: row.is_default,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function sanitizeExtension(ext: string): string {
  const cleaned = ext.trim().toLowerCase().replace(/^\.+/, '');
  if (!/^[a-z0-9]{1,16}$/.test(cleaned)) {
    throw ApiError.badRequest('invalid_extension', 'امتداد الملف غير صالح. يجب أن يتكون من 1 إلى 16 حرفاً أو رقماً إنجليزياً.');
  }
  return cleaned;
}

export async function refreshFileTypesCache(pool: Queryable): Promise<Map<string, FileTypeRecord>> {
  const res = await pool.query(
    `SELECT extension, mime_type, category, label_ar, label_en, is_enabled, is_default, created_at, updated_at
       FROM allowed_file_types
      ORDER BY category ASC, extension ASC`
  );
  const map = new Map<string, FileTypeRecord>();
  for (const row of res.rows) {
    const record = rowToRecord(row);
    map.set(record.extension, record);
  }
  cachedAllowedTypes = map;
  return map;
}

export async function getFileTypesMap(pool?: Queryable): Promise<Map<string, FileTypeRecord>> {
  if (cachedAllowedTypes && cachedAllowedTypes.size > 0) {
    return cachedAllowedTypes;
  }
  if (pool) {
    return refreshFileTypesCache(pool);
  }
  // Fallback to static defaults if DB is not provided
  const map = new Map<string, FileTypeRecord>();
  const now = new Date();
  for (const item of DEFAULT_FILE_TYPES) {
    map.set(item.extension, { ...item, createdAt: now, updatedAt: now });
  }
  return map;
}

export async function getAllFileTypes(pool: Queryable): Promise<FileTypeRecord[]> {
  const map = await getFileTypesMap(pool);
  return Array.from(map.values());
}

export async function getActiveFileTypes(pool?: Queryable): Promise<FileTypeRecord[]> {
  const map = await getFileTypesMap(pool);
  return Array.from(map.values()).filter((f) => f.isEnabled);
}

export async function getActiveAllowedExtensions(pool?: Queryable): Promise<string[]> {
  const active = await getActiveFileTypes(pool);
  return active.map((f) => f.extension);
}

export async function isExtensionAllowed(extension: string, pool?: Queryable): Promise<boolean> {
  const ext = extension.trim().toLowerCase().replace(/^\.+/, '');
  const map = await getFileTypesMap(pool);
  const record = map.get(ext);
  return Boolean(record && record.isEnabled);
}

export async function getMimeTypeForExtension(extension: string, pool?: Queryable): Promise<string | null> {
  const ext = extension.trim().toLowerCase().replace(/^\.+/, '');
  const map = await getFileTypesMap(pool);
  const record = map.get(ext);
  if (!record || !record.isEnabled) return null;
  return record.mimeType;
}

export async function addFileType(
  pool: Queryable,
  input: CreateFileTypeInput
): Promise<FileTypeRecord> {
  const extension = sanitizeExtension(input.extension);
  const mimeType = input.mimeType.trim().toLowerCase();
  if (!mimeType || !mimeType.includes('/')) {
    throw ApiError.badRequest('invalid_mime_type', 'نوع المحتوى (MIME type) غير صالح.');
  }
  const category = input.category ? input.category.trim().toLowerCase() : 'other';
  const labelAr = input.labelAr?.trim() || `ملف ${extension.toUpperCase()}`;
  const labelEn = input.labelEn?.trim() || `${extension.toUpperCase()} File`;
  const isEnabled = input.isEnabled !== false;

  const res = await pool.query(
    `INSERT INTO allowed_file_types (extension, mime_type, category, label_ar, label_en, is_enabled, is_default, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, false, NOW(), NOW())
     ON CONFLICT (extension) DO UPDATE
       SET mime_type = EXCLUDED.mime_type,
           category = EXCLUDED.category,
           label_ar = EXCLUDED.label_ar,
           label_en = EXCLUDED.label_en,
           is_enabled = EXCLUDED.is_enabled,
           updated_at = NOW()
     RETURNING extension, mime_type, category, label_ar, label_en, is_enabled, is_default, created_at, updated_at`,
    [extension, mimeType, category, labelAr, labelEn, isEnabled]
  );

  await refreshFileTypesCache(pool);
  return rowToRecord(res.rows[0]);
}

export async function toggleFileType(
  pool: Queryable,
  extension: string,
  isEnabled: boolean
): Promise<FileTypeRecord | null> {
  const ext = sanitizeExtension(extension);
  const res = await pool.query(
    `UPDATE allowed_file_types
        SET is_enabled = $1,
            updated_at = NOW()
      WHERE extension = $2
     RETURNING extension, mime_type, category, label_ar, label_en, is_enabled, is_default, created_at, updated_at`,
    [isEnabled, ext]
  );
  if (!res.rows[0]) return null;
  await refreshFileTypesCache(pool);
  return rowToRecord(res.rows[0]);
}

export async function deleteFileType(pool: Queryable, extension: string): Promise<boolean> {
  const ext = sanitizeExtension(extension);
  const res = await pool.query(
    `DELETE FROM allowed_file_types
      WHERE extension = $1`,
    [ext]
  );
  const deleted = (res.rowCount ?? 0) > 0;
  if (deleted) {
    await refreshFileTypesCache(pool);
  }
  return deleted;
}

export async function resetFileTypesToDefault(pool: Queryable): Promise<FileTypeRecord[]> {
  await pool.query('DELETE FROM allowed_file_types');
  for (const item of DEFAULT_FILE_TYPES) {
    await pool.query(
      `INSERT INTO allowed_file_types (extension, mime_type, category, label_ar, label_en, is_enabled, is_default)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [item.extension, item.mimeType, item.category, item.labelAr, item.labelEn, item.isEnabled, item.isDefault]
    );
  }
  await refreshFileTypesCache(pool);
  return getAllFileTypes(pool);
}
