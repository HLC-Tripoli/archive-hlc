-- 0011_system_settings_and_support_tickets.sql
-- إعدادات المنظومة ونظام تذاكر الدعم الفني

-- 1. جدول الإعدادات العامة للنظام (مثل الحد الأقصى لحجم رفع المرفقات)
CREATE TABLE IF NOT EXISTS system_settings (
  key VARCHAR(64) PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- إدراج الحد الأقصى الافتراضي لرفع المرفقات (25 ميجابايت)
INSERT INTO system_settings (key, value)
VALUES ('upload_max_mb', '25')
ON CONFLICT (key) DO NOTHING;

-- 2. جدول تذاكر الدعم الفني والاستفسارات
CREATE TABLE IF NOT EXISTS support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  department_id UUID REFERENCES departments(id),
  title VARCHAR(255) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_user_id ON support_tickets (user_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets (status);
CREATE INDEX IF NOT EXISTS idx_support_tickets_updated_at ON support_tickets (updated_at DESC);

-- 3. جدول رسائل ومحادثات تذاكر الدعم
CREATE TABLE IF NOT EXISTS support_ticket_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES users(id),
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_ticket_messages_ticket_id ON support_ticket_messages (ticket_id, created_at ASC);
