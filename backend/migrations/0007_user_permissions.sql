-- 0007_user_permissions.sql
-- إضافة عمود الصلاحيات المخصصة لحسابات المستخدمين
-- الصلاحيات الأساسية: view, create, edit, delete
-- المدراء يملكون كافة الصلاحيات حكماً، والموظفون يملكون الصلاحيات المحددة لهم.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS permissions text[] NOT NULL DEFAULT '{view,create,edit}';

UPDATE users
   SET permissions = '{view,create,edit,delete}'
 WHERE role = 'admin';
