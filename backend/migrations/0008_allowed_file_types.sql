-- 0008_allowed_file_types.sql
-- جدول إدارة أنواع وصيغ الملفات المسموحة في المنظومة
-- يتيح للمدير تفعيل/تعطيل الصيغ، إضافة صيغ جديدة، أو حذف صيغ غير مرغوبة.

CREATE TABLE IF NOT EXISTS allowed_file_types (
  extension VARCHAR(16) PRIMARY KEY,
  mime_type VARCHAR(128) NOT NULL,
  category VARCHAR(32) NOT NULL DEFAULT 'other',
  label_ar VARCHAR(64) NOT NULL,
  label_en VARCHAR(64) NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_allowed_file_types_enabled
  ON allowed_file_types (is_enabled);

-- إدراج الصيغ الافتراضية
INSERT INTO allowed_file_types (extension, mime_type, category, label_ar, label_en, is_enabled, is_default)
VALUES
  -- المستندات والنصوص
  ('pdf',  'application/pdf', 'document', 'مستند PDF', 'PDF Document', true, true),
  ('doc',  'application/msword', 'document', 'مستند Word قديم', 'Word 97-2003 Document', true, true),
  ('docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'document', 'مستند Word حديث', 'Word Document', true, true),
  ('odt',  'application/vnd.oasis.opendocument.text', 'document', 'مستند OpenDocument', 'OpenDocument Text', true, true),
  ('rtf',  'application/rtf', 'document', 'نص منسق RTF', 'Rich Text Format', true, true),
  ('txt',  'text/plain', 'document', 'ملف نصي عادي', 'Plain Text Document', true, true),

  -- الصور والرسومات
  ('jpg',  'image/jpeg', 'image', 'صورة JPEG', 'JPEG Image', true, true),
  ('jpeg', 'image/jpeg', 'image', 'صورة JPEG', 'JPEG Image', true, true),
  ('png',  'image/png', 'image', 'صورة PNG', 'PNG Image', true, true),
  ('webp', 'image/webp', 'image', 'صورة WebP', 'WebP Image', true, true),
  ('gif',  'image/gif', 'image', 'صورة متحركة GIF', 'GIF Image', true, true),
  ('bmp',  'image/bmp', 'image', 'صورة نقطية BMP', 'Bitmap Image', true, true),
  ('tif',  'image/tiff', 'image', 'صورة فاكس TIFF', 'TIFF Image', true, true),
  ('tiff', 'image/tiff', 'image', 'صورة فاكس TIFF', 'TIFF Image', true, true),
  ('svg',  'image/svg+xml', 'image', 'رسم متجهي SVG', 'Scalable Vector Graphics', true, true),

  -- جداول البيانات
  ('xls',  'application/vnd.ms-excel', 'spreadsheet', 'جدول Excel قديم', 'Excel 97-2003 Workbook', true, true),
  ('xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'spreadsheet', 'جدول Excel حديث', 'Excel Workbook', true, true),
  ('ods',  'application/vnd.oasis.opendocument.spreadsheet', 'spreadsheet', 'جدول OpenDocument', 'OpenDocument Spreadsheet', true, true),
  ('csv',  'text/csv', 'spreadsheet', 'ملف قيم مفصولة بفواصل CSV', 'CSV Spreadsheet', true, true),

  -- العروض التقديمية
  ('ppt',  'application/vnd.ms-powerpoint', 'presentation', 'عرض PowerPoint قديم', 'PowerPoint Presentation', true, true),
  ('pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'presentation', 'عرض PowerPoint حديث', 'PowerPoint Presentation', true, true),
  ('odp',  'application/vnd.oasis.opendocument.presentation', 'presentation', 'عرض OpenDocument', 'OpenDocument Presentation', true, true),

  -- الأرشيف والملفات المضغوطة
  ('zip',  'application/zip', 'archive', 'أرشيف مضغوط ZIP', 'ZIP Archive', true, true),
  ('rar',  'application/vnd.rar', 'archive', 'أرشيف مضغوط RAR', 'RAR Archive', true, true),
  ('7z',   'application/x-7z-compressed', 'archive', 'أرشيف مضغوط 7-Zip', '7-Zip Archive', true, true),

  -- ملفات البيانات
  ('json', 'application/json', 'data', 'ملف بيانات JSON', 'JSON Data File', true, true),
  ('xml',  'application/xml', 'data', 'ملف بيانات XML', 'XML Data File', true, true)
ON CONFLICT (extension) DO NOTHING;
