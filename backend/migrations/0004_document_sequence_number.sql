-- 0004_document_sequence_number.sql
-- إضافة «رقم التسلسل» كحقل نصي اختياري للمستندات.
-- ملاحظات التصميم:
--   * النص لا العدد: نحفظ الأصفار البادئة والقيم الأبجدية الرقمية كما هي.
--   * العمود قابل لـ NULL كي تبقى السجلات القديمة قابلة للقراءة والتعديل دون تعبئة.
--   * الحد الأقصى 100 حرف مطابق للتحقق في طبقة التطبيق.
--   * الترحيل إضافي فقط: لا يعدّل أي صف موجود ولا يفرض قيمة افتراضية.

ALTER TABLE documents
  ADD COLUMN sequence_number text
  CHECK (sequence_number IS NULL OR length(sequence_number) BETWEEN 1 AND 100);

COMMENT ON COLUMN documents.sequence_number IS
  'رقم تسلسل داخلي اختياري (نص للحفاظ على الأصفار البادئة والقيم الأبجدية الرقمية).';

-- البحث النصي الجزئي (ILIKE) على رقم التسلسل، والترتيب عليه.
CREATE INDEX documents_sequence_number_trgm_idx
  ON documents USING gin (lower(sequence_number) gin_trgm_ops);
CREATE INDEX documents_sequence_number_idx
  ON documents (sequence_number);
