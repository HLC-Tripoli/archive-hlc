-- 0006_attachment_storage_type.sql
-- إضافة نوع وثيقة جديد لتخزين المرفقات:
--   * other_attachments: تخزين مرفقات أخرى

ALTER TYPE document_type ADD VALUE IF NOT EXISTS 'other_attachments';
