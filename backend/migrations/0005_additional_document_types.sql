-- 0005_additional_document_types.sql
-- إضافة أنواع وثائق جديدة لقيمة التعداد document_type:
--   * other: مراسلات أخرى
--   * minutes: محاضر اجتماعات
--   * proposal: مقترحات
--   * report: تقارير
-- إتاحة حفظ المراسلات والوثائق بحقول اختيارية دون اشتراط الرقم الإشاري أو الموضوع.

ALTER TYPE document_type ADD VALUE IF NOT EXISTS 'other';
ALTER TYPE document_type ADD VALUE IF NOT EXISTS 'minutes';
ALTER TYPE document_type ADD VALUE IF NOT EXISTS 'proposal';
ALTER TYPE document_type ADD VALUE IF NOT EXISTS 'report';

-- جعل الرقم الإشاري والموضوع والتاريخ اختياريين في جدول المستندات
ALTER TABLE documents ALTER COLUMN reference DROP NOT NULL;
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_reference_check;
ALTER TABLE documents ADD CONSTRAINT documents_reference_check
  CHECK (reference IS NULL OR length(reference) BETWEEN 1 AND 200);

ALTER TABLE documents ALTER COLUMN title DROP NOT NULL;
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_title_check;
ALTER TABLE documents ADD CONSTRAINT documents_title_check
  CHECK (title IS NULL OR length(title) BETWEEN 1 AND 500);

ALTER TABLE documents ALTER COLUMN transaction_date DROP NOT NULL;
ALTER TABLE documents ALTER COLUMN transaction_date SET DEFAULT CURRENT_DATE;
