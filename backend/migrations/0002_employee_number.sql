-- 0002_employee_number.sql
-- الرقم الوظيفي: معرّف اختياري لحسابات المستخدمين، يُستخدم للعرض والبحث وتسجيل الدخول.
-- ملاحظات التصميم:
--   * الحقل اختياري بالكامل: الحسابات الموجودة تبقى بقيمة NULL ولا يُولَّد لها أي رقم.
--   * يُخزَّن كنص لا كرقم، للحفاظ على الأصفار البادئة (001245) والقيم الأبجدية الرقمية.
--   * التطبيق يزيل الفراغات الطرفية قبل الحفظ، والقيد أدناه يضمن ذلك على مستوى القاعدة.
--   * التفرّد بلا حساسية لحالة الأحرف، وفقط للقيم غير الفارغة (NULL مسموح ومتكرر).
--   * هذا الترحيل إضافي وقابل للتطبيق على قاعدة بيانات قائمة دون المساس بأي صف.

ALTER TABLE users
  ADD COLUMN employee_number text
  CHECK (
    employee_number IS NULL
    OR (
      length(employee_number) BETWEEN 1 AND 64
      -- لا فراغات طرفية ولا محارف تحكّم، حتى عند الكتابة المباشرة إلى القاعدة.
      AND employee_number !~ '^[[:space:]]|[[:space:]]$|[[:cntrl:]]'
    )
  );

CREATE UNIQUE INDEX users_employee_number_lower_uidx
  ON users (lower(employee_number))
  WHERE employee_number IS NOT NULL;
