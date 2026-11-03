-- 0009_attachment_permissions.sql
-- إضافة صلاحيات المرفقات المخصصة لحسابات المستخدمين:
-- attach_view, attach_upload, attach_delete
-- تحديث حسابات المدراء لتشمل كافة الصلاحيات.
-- تحديث حسابات الموظفين الحالية لمنحهم صلاحيات المرفقات الموافقة لصلاحياتهم الأساسية:
-- إذا كان يملك view -> يمنح attach_view
-- إذا كان يملك create -> يمنح attach_upload
-- إذا كان يملك delete -> يمنح attach_delete

ALTER TABLE users
  ALTER COLUMN permissions SET DEFAULT '{view,create,edit,delete,attach_view,attach_upload,attach_delete}';

UPDATE users
   SET permissions = array_cat(permissions, '{attach_view,attach_upload,attach_delete}'::text[])
 WHERE role = 'admin'
   AND NOT (permissions @> '{attach_view,attach_upload,attach_delete}');

UPDATE users
   SET permissions = array_append(permissions, 'attach_view')
 WHERE 'view' = ANY(permissions)
   AND NOT ('attach_view' = ANY(permissions));

UPDATE users
   SET permissions = array_append(permissions, 'attach_upload')
 WHERE 'create' = ANY(permissions)
   AND NOT ('attach_upload' = ANY(permissions));

UPDATE users
   SET permissions = array_append(permissions, 'attach_delete')
 WHERE 'delete' = ANY(permissions)
   AND NOT ('attach_delete' = ANY(permissions));
