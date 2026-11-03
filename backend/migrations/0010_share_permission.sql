-- 0010_share_permission.sql
-- إضافة صلاحية مشاركة المعاملات والمرفقات: share
-- تحديث القيمة الافتراضية لصلاحيات المستخدمين لتشمل share
-- منح الصلاحية لجميع المدراء وللمستخدمين الذين لديهم صلاحية view افتراضياً

ALTER TABLE users
  ALTER COLUMN permissions SET DEFAULT '{view,create,edit,delete,share,attach_view,attach_upload,attach_delete}';

UPDATE users
   SET permissions = array_append(permissions, 'share')
 WHERE role = 'admin'
   AND NOT ('share' = ANY(permissions));

UPDATE users
   SET permissions = array_append(permissions, 'share')
 WHERE 'view' = ANY(permissions)
   AND NOT ('share' = ANY(permissions));
