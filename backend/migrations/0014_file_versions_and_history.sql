-- 0014_file_versions_and_history.sql
-- دعم إصدارات المرفقات، الأرشفة الناعمة للملفات، وفحص التكرار عبر البصمة

ALTER TABLE document_files
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archived_reason TEXT,
  ADD COLUMN IF NOT EXISTS replaced_by_file_id UUID REFERENCES document_files(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS original_checksum_sha256 TEXT;

CREATE INDEX IF NOT EXISTS document_files_active_doc_idx
  ON document_files (document_id, created_at ASC) WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS document_files_checksum_idx
  ON document_files (checksum_sha256) WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS document_files_orig_checksum_idx
  ON document_files (original_checksum_sha256) WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS audit_log_details_doc_id_idx
  ON audit_log ((details->>'documentId')) WHERE details ? 'documentId';
