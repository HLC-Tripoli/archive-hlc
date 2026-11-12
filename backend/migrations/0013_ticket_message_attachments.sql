-- 0013_ticket_message_attachments.sql
-- إضافة دعم إرفاق الصور لتذاكر الدعم ورسائل المحادثة

ALTER TABLE support_ticket_messages
  ADD COLUMN IF NOT EXISTS attachment_name TEXT,
  ADD COLUMN IF NOT EXISTS attachment_mime_type TEXT,
  ADD COLUMN IF NOT EXISTS attachment_size_bytes BIGINT,
  ADD COLUMN IF NOT EXISTS attachment_storage_key TEXT;
