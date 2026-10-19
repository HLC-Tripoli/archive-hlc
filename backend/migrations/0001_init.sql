-- 0001_init.sql
-- المخطط الأساسي لمنظومة الأرشيف الإلكتروني.
-- ملاحظات التصميم:
--   * لا تُخزَّن أي ملفات ثنائية في قاعدة البيانات؛ الأسطر في document_files تشير فقط
--     إلى كائنات مخزنة في خدمة التخزين المتوافقة مع S3 (RustFS).
--   * منع التكرار في رقم المعاملة يتم عبر فهرس فريد على lower(reference)
--     للمستندات غير المحذوفة (الحذف الناعم يحفظ السجل للاستعادة).
--   * كل الجداول تستخدم معرّفات UUID (عدا سجل التدقيق التراكمي).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TYPE user_role AS ENUM ('admin', 'employee');
CREATE TYPE document_type AS ENUM ('incoming', 'outgoing');
CREATE TYPE document_status AS ENUM ('new', 'in_progress', 'completed', 'archived');
CREATE TYPE import_kind AS ENUM ('legacy_browser', 'json_backup');

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username      text NOT NULL CHECK (length(username) BETWEEN 3 AND 64),
  display_name  text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 200),
  role          user_role NOT NULL,
  password_hash text NOT NULL,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

CREATE UNIQUE INDEX users_username_lower_uidx ON users (lower(username));
CREATE INDEX users_role_idx ON users (role);

CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE,
  csrf_token   text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  ip           text,
  user_agent   text
);

CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

CREATE TABLE departments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  is_active  boolean NOT NULL DEFAULT true,
  legacy_id  text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX departments_name_lower_uidx ON departments (lower(name));
CREATE UNIQUE INDEX departments_legacy_uidx ON departments (legacy_id) WHERE legacy_id IS NOT NULL;

CREATE TABLE documents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference        text NOT NULL CHECK (length(reference) BETWEEN 1 AND 200),
  title            text NOT NULL CHECK (length(title) BETWEEN 1 AND 500),
  doc_type         document_type NOT NULL,
  transaction_date date NOT NULL,
  sender           text NOT NULL DEFAULT '' CHECK (length(sender) <= 200),
  recipient        text NOT NULL DEFAULT '' CHECK (length(recipient) <= 200),
  department_id    uuid REFERENCES departments(id) ON DELETE RESTRICT,
  status           document_status NOT NULL DEFAULT 'new',
  notes            text NOT NULL DEFAULT '' CHECK (length(notes) <= 4000),
  created_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz,
  deleted_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  restored_at      timestamptz,
  restored_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  legacy_id        text
);

CREATE UNIQUE INDEX documents_reference_lower_active_uidx
  ON documents (lower(reference)) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX documents_legacy_uidx
  ON documents (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE INDEX documents_date_idx ON documents (transaction_date DESC);
CREATE INDEX documents_status_idx ON documents (status);
CREATE INDEX documents_type_idx ON documents (doc_type);
CREATE INDEX documents_department_idx ON documents (department_id);
CREATE INDEX documents_deleted_idx ON documents (deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX documents_created_idx ON documents (created_at DESC);

-- فهارس البحث النصي الجزئي (ILIKE) على الحقول المستخدمة في البحث.
CREATE INDEX documents_reference_trgm_idx ON documents USING gin (lower(reference) gin_trgm_ops);
CREATE INDEX documents_title_trgm_idx ON documents USING gin (lower(title) gin_trgm_ops);
CREATE INDEX documents_sender_trgm_idx ON documents USING gin (lower(sender) gin_trgm_ops);
CREATE INDEX documents_recipient_trgm_idx ON documents USING gin (lower(recipient) gin_trgm_ops);

CREATE TABLE document_files (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id      uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  original_name    text NOT NULL CHECK (length(original_name) BETWEEN 1 AND 300),
  mime_type        text NOT NULL,
  size_bytes       bigint NOT NULL CHECK (size_bytes >= 0),
  checksum_sha256  text,
  storage_provider text NOT NULL,
  storage_key      text NOT NULL UNIQUE,
  uploaded_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX document_files_document_idx ON document_files (document_id);

CREATE TABLE audit_log (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_username text,
  action         text NOT NULL,
  entity_type    text,
  entity_id      text,
  details        jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip             text,
  user_agent     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_log_created_idx ON audit_log (created_at DESC);
CREATE INDEX audit_log_actor_idx ON audit_log (actor_user_id);
CREATE INDEX audit_log_action_idx ON audit_log (action);
CREATE INDEX audit_log_entity_idx ON audit_log (entity_type, entity_id);

CREATE TABLE data_imports (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          import_kind NOT NULL,
  source        text,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  stats         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);
