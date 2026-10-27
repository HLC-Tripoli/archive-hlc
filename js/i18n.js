"use strict";
/* ==========================================================================
   قاموس الترجمة والتدويل (i18n) — منظومة الأرشيف الإلكتروني
   Bilingual translation dictionary (Arabic / English)
   ========================================================================== */

(function () {
  var translations = {
    ar: {
      // General & Brand
      brand_name: "هاتف ليبيا",
      brand_sub: "الأرشيف الإلكتروني",
      app_title: "أرشيف هاتف ليبيا الإلكتروني",
      today_prefix: "تاريخ اليوم: ",
      loading: "جارٍ التحميل…",
      loading_session: "جارٍ التحقق من الجلسة…",
      session_expired: "انتهت صلاحية الجلسة. الرجاء تسجيل الدخول من جديد.",
      save: "حفظ",
      saving: "جارٍ الحفظ…",
      cancel: "إلغاء",
      close: "إغلاق",
      confirm: "تأكيد",
      delete: "حذف",
      deleting: "جارٍ الحذف…",
      edit: "تعديل",
      view: "عرض",
      restore: "استعادة",
      restoring: "جارٍ الاستعادة…",
      download: "تنزيل",
      refresh: "تحديث",
      clear_filters: "مسح الفلاتر",
      export_csv: "تصدير CSV",
      actions: "الإجراءات",
      status: "الحالة",
      notes: "الملاحظات",
      none: "—",
      unspecified: "غير محددة",
      active: "نشط",
      disabled: "معطّل",
      deleted_badge: "محذوفة",
      unknown: "؟",

      // Navigation & Menu
      menu_main: "القائمة الرئيسية",
      menu_system: "الإدارة والنظام",
      nav_dashboard: "الرئيسية",
      nav_incoming: "المراسلات الواردة",
      nav_outgoing: "المراسلات الصادرة",
      nav_archive: "الأرشيف الإلكتروني",
      nav_departments: "الإدارات",
      nav_reports: "التقارير والإحصائيات",
      nav_audit: "سجل التدقيق",
      nav_users: "إدارة المستخدمين",
      nav_settings: "الإعدادات",
      nav_about: "حول المنظومة",
      logout: "تسجيل الخروج",

      // Topbar buttons
      back_to_dashboard: "الرجوع إلى لوحة التحكم",
      sidebar_toggle_hide: "إخفاء القائمة الجانبية",
      sidebar_toggle_show: "إظهار القائمة الجانبية",
      lang_switch_title: "Switch to English",

      // Roles
      role_admin: "مدير المنظومة",
      role_employee: "موظف",
      role_admin_short: "مدير",
      role_employee_short: "موظف",

      // Dashboard
      dashboard_greeting: "مرحباً بك في الأرشيف الإلكتروني",
      dashboard_sub: "إدارة المراسلات والوثائق من مكان واحد.",
      stat_incoming: "الوارد",
      stat_incoming_sub: "معاملات واردة مسجلة",
      stat_outgoing: "الصادر",
      stat_outgoing_sub: "معاملات صادرة مسجلة",
      stat_total: "إجمالي المعاملات",
      stat_total_sub: "معاملات نشطة في المنظومة",
      stat_month: "هذا الشهر",
      stat_month_sub: "معاملات مسجلة هذا الشهر",
      latest_transactions: "أحدث المعاملات",
      dashboard_search_placeholder: "ابحث بالرقم الإشاري أو الموضوع أو رقم التسلسل أو الجهة...",
      dashboard_search_aria: "بحث في أحدث المعاملات",

      // Incoming / Outgoing
      incoming_title: "المراسلات الواردة",
      incoming_desc: "تسجيل ومتابعة المراسلات المستلمة.",
      add_incoming: "+ إضافة وارد",
      outgoing_title: "المراسلات الصادرة",
      outgoing_desc: "تسجيل ومتابعة المراسلات المرسلة.",
      add_outgoing: "+ إضافة صادر",
      search_transactions_placeholder: "ابحث بالرقم الإشاري أو الموضوع أو رقم التسلسل أو الجهة...",

      // Archive
      archive_title: "الأرشيف الإلكتروني",
      archive_desc: "جميع الوثائق المسجلة في المنظومة مع البحث والتصفية.",
      all_types: "جميع الأنواع",
      type_incoming: "وارد",
      type_outgoing: "صادر",
      all_departments: "جميع الإدارات",
      date_from: "من تاريخ",
      date_to: "إلى تاريخ",
      date_from_placeholder: "من تاريخ (DD/MM/YYYY)",
      date_to_placeholder: "إلى تاريخ (DD/MM/YYYY)",
      sort_date_desc: "التاريخ (الأحدث أولاً)",
      sort_date_asc: "التاريخ (الأقدم أولاً)",
      sort_created_desc: "تاريخ التسجيل (الأحدث)",
      sort_updated_desc: "آخر تعديل",
      sort_ref_asc: "الرقم الاشاري",
      sort_seq_asc: "رقم التسلسل",
      sort_title_asc: "موضوع الرسالة",
      show_deleted: "إظهار المحذوفة",

      // Document table headers
      col_ref: "الرقم الإشاري",
      col_seq: "رقم التسلسل",
      col_title: "الموضوع",
      col_type: "النوع",
      col_date: "التاريخ",
      col_party: "الإدارة / الجهة",
      no_documents: "لا توجد معاملات لعرضها.",

      // Document modal
      create_incoming_title: "تسجيل مراسلة واردة",
      create_outgoing_title: "تسجيل مراسلة صادرة",
      edit_doc_title: "تعديل مراسلة",
      doc_date_label: "تاريخ المراسلة *",
      doc_date_placeholder: "يوم/شهر/سنة (DD/MM/YYYY)",
      doc_ref_label: "الرقم الإشاري *",
      doc_ref_placeholder: "مثال: 2026/و/001",
      doc_seq_label: "رقم التسلسل",
      doc_seq_placeholder: "مثال: 142",
      doc_from_label: "من",
      doc_from_placeholder: "مثال: إدارة الشؤون الإدارية",
      doc_to_label: "إلى",
      doc_to_placeholder: "مثال: شركة هاتف ليبيا",
      doc_title_label: "موضوع المراسلة *",
      doc_title_placeholder: "مثال: طلب تزويد بمعدات حاسوبية",
      doc_dept_label: "الإدارة المختصة",
      doc_notes_label: "ملاحظات",
      doc_notes_placeholder: "أي تفاصيل أو ملاحظات إضافية...",
      doc_attachments_label: "المرفقات",
      doc_attachments_hint: "إضافة ملفات (PDF، صور، مستندات - حد أقصى 50 م.ب لكل ملف)",
      choose_calendar_title: "اختر التاريخ من التقويم",
      saving_with_files: "جارٍ الحفظ ورفع المرفقات…",
      invalid_date_error: "تاريخ المراسلة غير صالح. يرجى إدخال التاريخ بالصيغة: يوم/شهر/سنة (مثال: 20/10/2026).",

      // Document Details modal
      detail_doc_title: "تفاصيل المعاملة",
      field_ref: "الرقم الاشاري",
      field_seq: "رقم التسلسل",
      field_subject: "موضوع الرسالة",
      field_type: "النوع",
      field_date: "تاريخ الرسالة",
      field_dept: "الإدارة",
      field_sender: "من",
      field_recipient: "إلى",
      field_notes: "الملاحظات",
      field_created_by: "سُجلت بواسطة",
      field_created_at: "تاريخ التسجيل",
      field_updated_by: "آخر تعديل بواسطة",
      field_updated_at: "تاريخ آخر تعديل",
      field_deleted_by: "حُذفت بواسطة",
      field_deleted_at: "تاريخ الحذف",
      attachments_section: "المرفقات",
      no_attachments: "لا توجد مرفقات لهذه المراسلة.",
      no_saved_attachments: "لا توجد مرفقات محفوظة بعد.",
      pending_files_label: "ملفات بانتظار الحفظ:",

      // Preview modal
      preview_title: "معاينة المرفق",
      preview_failed: "تعذر عرض هذا الملف مباشرة.",

      // Departments page
      departments_title: "إدارة الأقسام والإدارات",
      departments_desc: "إضافة وتعديل وحذف الإدارات المعتمدة في المنظومة.",
      add_department: "+ إضافة إدارة",
      show_inactive_depts: "إظهار المعطّلة",
      dept_form_create: "إضافة إدارة جديدة",
      dept_form_edit: "تعديل الإدارة",
      dept_name_label: "اسم الإدارة *",
      dept_name_placeholder: "اسم الإدارة أو القسم (مثال: إدارة تقنية المعلومات)",
      dept_desc_label: "الوصف",
      dept_desc_placeholder: "وصف موجز لاختصاصات الإدارة...",
      no_departments: "لم تتم إضافة إدارات بعد.",
      col_dept_name: "اسم الإدارة",
      col_dept_desc: "الوصف",
      col_dept_users: "الموظفون",
      col_dept_created: "تاريخ الإنشاء",

      // Reports page
      reports_title: "التقارير والإحصائيات",
      reports_desc: "ملخص المعاملات المسجلة في المنظومة.",
      print_report: "🖨️ طباعة",
      report_total: "إجمالي الوثائق",
      report_incoming: "المراسلات الواردة",
      report_outgoing: "المراسلات الصادرة",
      report_by_type: "حسب النوع",
      report_by_dept: "حسب الإدارة",
      report_by_month: "حسب الشهر (آخر 12 شهراً)",
      no_report_data: "لا توجد بيانات.",

      // Users page
      users_title: "إدارة المستخدمين",
      users_desc: "إنشاء الحسابات وتعديل الأدوار والتعطيل وإعادة تعيين كلمات المرور.",
      add_user: "+ إضافة مستخدم",
      users_search_placeholder: "اسم المستخدم أو الاسم الكامل أو الرقم الوظيفي...",
      all_roles: "جميع الأدوار",
      all_statuses: "الجميع",
      col_user_name: "الاسم والمستخدم",
      col_user_emp_num: "الرقم الوظيفي",
      col_user_role: "الدور",
      col_user_dept: "الإدارة",
      col_user_status: "الحالة",
      col_user_created: "تاريخ التسجيل",
      col_user_last_login: "آخر دخول",
      no_users: "لا يوجد مستخدمون مطابقون.",
      user_modal_add: "إضافة مستخدم",
      user_modal_edit: "تعديل مستخدم",
      user_username_label: "اسم المستخدم *",
      user_username_placeholder: "مثال: m.benyousef",
      user_fullname_label: "الاسم الكامل *",
      user_fullname_placeholder: "مثال: مهند عبدالفتاح بن يوسف",
      user_emp_num_label: "الرقم الوظيفي (اختياري)",
      user_emp_num_placeholder: "مثال: 1042",
      user_role_label: "الدور *",
      user_dept_label: "الإدارة المعيّنة",
      user_dept_hint: "الموظف يحتاج إدارة نشطة للوصول إلى معاملاتها. المدير يرى جميع الإدارات.",
      user_password_label: "كلمة المرور *",
      user_password_edit_label: "كلمة مرور جديدة (اتركها فارغة للإبقاء على الحالية)",
      user_password_placeholder: "8 أحرف على الأقل...",
      user_active_label: "الحساب نشط (يمكنه تسجيل الدخول)",

      // Audit page
      audit_title: "سجل التدقيق",
      audit_desc: "تتبّع عمليات الدخول وإدارة المعاملات والمستخدمين والإدارات.",
      audit_action_placeholder: "نوع العملية (مثال: document.created)",
      audit_entity_placeholder: "نوع الكيان (مثال: document)",
      col_audit_time: "الوقت",
      col_audit_user: "المستخدم",
      col_audit_action: "العملية",
      col_audit_entity: "الكيان",
      col_audit_details: "التفاصيل",
      col_audit_ip: "عنوان IP",
      no_audit: "لا توجد سجلات مطابقة.",
      action_login_success: "دخول ناجح",
      action_login_failed: "محاولة دخول فاشلة",
      action_logout: "تسجيل خروج",
      action_password_changed: "تغيير كلمة المرور",
      action_document_created: "تسجيل معاملة",
      action_document_updated: "تعديل معاملة",
      action_document_deleted: "حذف معاملة",
      action_document_restored: "استعادة معاملة",
      action_file_uploaded: "رفع مرفق",
      action_file_downloaded: "تنزيل مرفق",
      action_file_viewed: "عرض مرفق",
      action_file_deleted: "حذف مرفق",
      action_user_created: "إنشاء مستخدم",
      action_user_updated: "تعديل مستخدم",
      action_user_password_reset: "إعادة تعيين كلمة مرور",
      action_dept_created: "إضافة إدارة",
      action_dept_updated: "تعديل إدارة",
      action_dept_deleted: "حذف إدارة",
      action_import_legacy: "ترحيل بيانات من المتصفح",
      action_import_backup: "استيراد نسخة احتياطية",

      // Settings page
      settings_my_account: "حسابي",
      settings_dept_info: "الإدارة المعيّنة: ",
      settings_password_desc: "تغيير كلمة المرور الخاصة بحسابك. سيؤدي ذلك إلى إنهاء الجلسات الأخرى.",
      current_password_label: "كلمة المرور الحالية *",
      current_password_placeholder: "أدخل كلمة المرور الحالية",
      new_password_label: "كلمة المرور الجديدة *",
      new_password_placeholder: "8 أحرف على الأقل",
      confirm_password_label: "تأكيد كلمة المرور الجديدة *",
      update_password_btn: "تغيير كلمة المرور",
      theme_title: "المظهر",
      theme_desc: "اختر مظهر الواجهة: النظام أو الداكن أو الفاتح.",
      backup_title: "النسخ الاحتياطي والاستيراد",
      backup_desc: "تنزيل نسخة JSON من بيانات المنظومة، أو استيراد نسخة سابقة.",
      export_backup_btn: "تنزيل نسخة احتياطية JSON",
      import_backup_title: "استيراد نسخة احتياطية",
      import_backup_btn: "استيراد النسخة الاحتياطية",
      legacy_import_title: "استيراد بيانات النسخة التجريبية من المتصفح",
      legacy_import_desc: "إن كانت بيانات الإصدار التجريبي السابق ما زالت محفوظة في هذا المتصفح، فيمكن ترحيلها إلى الخادم. تُنقل المعاملات والإدارات، ويُتجاهل تكرار السجلات، ولا تُنقل محتويات المرفقات.",
      legacy_import_btn: "ترحيل بيانات المتصفح إلى الخادم",
      legacy_clear_btn: "حذف نسخة المتصفح بعد النجاح",
      about_system_title: "حول المنظومة",
      about_system_desc: "منظومة إدارة الوثائق والأرشيف الإلكتروني — هاتف ليبيا (الإصدار 1.0).",
      about_system_hint: "يمكنك استعراض دليل الميزات والقدرات وصلاحيات الوصول والنبذة التقنية الكاملة.",
      open_about_btn: "فتح صفحة حول المنظومة",

      // About page
      about_page_title: "منظومة الأرشيف الإلكتروني — هاتف ليبيا",
      about_page_subtitle: "منصة رقمية موحدة لتسجيل وتنظيم وأرشفة المراسلات الإدارية والوثائق الرسمية ومتابعتها بدقة وأمان.",
      about_system_overview: "نظرة عامة على المنظومة",
      about_overview_text: "تم تصميم المنظومة لتوفير بيئة رقمية متكاملة لأرشفة المراسلات الصادرة والواردة، مع إتاحة البحث السريع والفرز المتقدم والتصنيف الدقيق حسب الإدارات المختصة، مع ضمان عدم فقدان أي وثيقة وإتاحة الوصول إليها بسرعة وموثوقية.",
      about_feature_archive: "إدارة المراسلات والوثائق",
      about_feature_archive_desc: "تسجيل المراسلات الواردة والصادرة بدقة عالية، وتعيين الأرقام الإشارية والتسلسل والتواريخ والجهات، ومتابعة حالات المعاملة (جديدة، قيد المعالجة، مكتملة، مؤرشفة).",
      about_feature_isolation: "عزل بيانات صارم للإدارات",
      about_feature_isolation_desc: "صلاحيات مشددة تضمن بقاء معاملات كل إدارة معزولة وخاصة بموظفيها فقط دون تسريب.",
      about_feature_search: "الأرشيف الإلكتروني والبحث",
      about_feature_search_desc: "أرشفة مركزية منظمة توفر بحثاً ذكياً بالرقم الإشاري أو التسلسل أو الموضوع، وتصفية شاملة حسب الإدارة المختصة والنطاق الزمني وحالة المراسلة.",
      about_feature_attachments: "المرفقات والمعاينة الفورية",
      about_feature_attachments_desc: "إرفاق المستندات الرسمية بصيغة PDF والصور عالية الدقة، مع ميزة المعاينة المباشرة للمرفقات داخل المنظومة قبل الحفظ وبعده وتنزيلها بسهولة.",
      about_feature_reports: "التقارير والإحصائيات",
      about_feature_reports_desc: "متابعة حركة المراسلات عبر لوحات بيانية تفاعلية ورسوم إحصائية توضح نسب الإنجاز وتوزيع المعاملات على الإدارات، مع إمكانية تصدير التقارير إلى صيغة CSV.",
      about_feature_backup: "النسخ الاحتياطي وحماية البيانات",
      about_feature_backup_desc: "دعم كامل لتصدير النسخ الاحتياطية واستيرادها بصيغة JSON الموحدة، مع تخزين آمن للمرفقات في مسار محمي وتشفير كلمات المرور وحماية الجلسات.",
      about_feature_audit: "الصلاحيات وسجل التدقيق",
      about_feature_audit_desc: "فصل دقيق للمهام بين مديري النظام وموظفي الأرشيف، مع توثيق زمني غير قابل للتعديل لجميع العمليات الإدارية وسجلات الدخول في سجل التدقيق.",
      about_roles_title: "الأدوار وصلاحيات الوصول",
      about_role_admin_badge: "مدير النظام (Administrator)",
      about_role_admin_1: "إدارة وتعديل بيانات الإدارات والأقسام في الشركة.",
      about_role_admin_2: "إنشاء حسابات المستخدمين وتحديد أدوارهم وتعيينهم للإدارات.",
      about_role_admin_3: "الاطلاع الكامل على سجل التدقيق الأمني ومراقبة كافة الحركات.",
      about_role_admin_4: "تصدير واستيراد النسخ الاحتياطية وإدارة الإعدادات العامة.",
      about_role_admin_5: "تسجيل وتعديل واستعراض المراسلات والأرشيف والتقارير.",
      about_role_emp_badge: "موظف الأرشيف (Employee)",
      about_role_emp_1: "تسجيل المراسلات الواردة والصادرة للإدارات المصرح له بالوصول إليها.",
      about_role_emp_2: "إرفاق الملفات والمستندات واستعراض المرفقات وتحميلها.",
      about_role_emp_3: "البحث في الأرشيف ومتابعة حالة المعاملات وتحديثها.",
      about_role_emp_4: "توليد وتصدير التقارير الإحصائية المعتمدة.",
      about_role_emp_5: "تغيير كلمة المرور وتخصيص المظهر (الوضع الفاتح / الداكن).",
      about_tech_title: "البنية التقنية ومعايير الأمان",
      about_tech_desc1: "تعمل المنظومة بواجهة استخدام عربية متكاملة تتوافق مع معايير القراءة من اليمين إلى اليسار (RTL) وتتواصل بأمان مع واجهة برمجة التطبيقات (REST API) الخلفية وقاعدة بيانات PostgreSQL الموثوقة.",
      about_tech_desc2: "يتم تخزين المرفقات بشكل منفصل وآمن على الخادم دون إتاحة الوصول المباشر إليها إلا بعد التحقق من صحة جلسة المستخدم وصلاحياته، مع الالتزام بسياسات أمان صارمة تشمل الحماية من هجمات CSRF و XSS وحظر النوافذ غير المصرح بها (Content Security Policy).",

      // Login screen
      login_title: "تسجيل الدخول",
      login_subtitle: "منظومة الأرشيف الإلكتروني — هاتف ليبيا",
      login_username_label: "اسم المستخدم أو الرقم الوظيفي",
      login_username_placeholder: "اسم المستخدم أو الرقم الوظيفي",
      login_password_label: "كلمة المرور",
      login_password_placeholder: "كلمة المرور",
      login_submit: "تسجيل الدخول",

      // Pager
      pager_prev: "السابق",
      pager_next: "التالي",
      pager_info: "صفحة {page} من {totalPages} — إجمالي {total}",

      // Access Notice
      notice_blocked_title: "الوصول إلى المعاملات غير متاح حالياً",

      // Prompts & Dialogs
      prompt_input_title: "إدخال نص",
      confirm_action_title: "تأكيد الإجراء",
      confirm_delete_doc: "هل أنت متأكد من حذف هذه المراسلة؟",
      confirm_restore_doc: "هل أنت متأكد من استعادة هذه المراسلة؟",
      confirm_delete_dept: "هل أنت متأكد من حذف هذه الإدارة؟",
      confirm_delete_file: "هل أنت متأكد من حذف هذا المرفق؟",
      confirm_toggle_user: "هل أنت متأكد من تغيير حالة هذا الحساب؟"
    },

    en: {
      // General & Brand
      brand_name: "Libya Telecom",
      brand_sub: "Electronic Archive",
      app_title: "Libya Telecom Electronic Archive",
      today_prefix: "Today: ",
      loading: "Loading…",
      loading_session: "Verifying session…",
      session_expired: "Session expired. Please sign in again.",
      save: "Save",
      saving: "Saving…",
      cancel: "Cancel",
      close: "Close",
      confirm: "Confirm",
      delete: "Delete",
      deleting: "Deleting…",
      edit: "Edit",
      view: "View",
      restore: "Restore",
      restoring: "Restoring…",
      download: "Download",
      refresh: "Refresh",
      clear_filters: "Clear Filters",
      export_csv: "Export CSV",
      actions: "Actions",
      status: "Status",
      notes: "Notes",
      none: "—",
      unspecified: "Unspecified",
      active: "Active",
      disabled: "Disabled",
      deleted_badge: "Deleted",
      unknown: "?",

      // Navigation & Menu
      menu_main: "Main Menu",
      menu_system: "System & Admin",
      nav_dashboard: "Dashboard",
      nav_incoming: "Incoming Mail",
      nav_outgoing: "Outgoing Mail",
      nav_archive: "Electronic Archive",
      nav_departments: "Departments",
      nav_reports: "Reports & Stats",
      nav_audit: "Audit Log",
      nav_users: "User Management",
      nav_settings: "Settings",
      nav_about: "About System",
      logout: "Logout",

      // Topbar buttons
      back_to_dashboard: "Back to Dashboard",
      sidebar_toggle_hide: "Hide Sidebar",
      sidebar_toggle_show: "Show Sidebar",
      lang_switch_title: "التبديل إلى اللغة العربية",

      // Roles
      role_admin: "System Administrator",
      role_employee: "Employee",
      role_admin_short: "Admin",
      role_employee_short: "Employee",

      // Dashboard
      dashboard_greeting: "Welcome to the Electronic Archive",
      dashboard_sub: "Manage correspondence and official records in one place.",
      stat_incoming: "Incoming",
      stat_incoming_sub: "Registered incoming documents",
      stat_outgoing: "Outgoing",
      stat_outgoing_sub: "Registered outgoing documents",
      stat_total: "Total Documents",
      stat_total_sub: "Active documents in system",
      stat_month: "This Month",
      stat_month_sub: "Transactions recorded this month",
      latest_transactions: "Latest Transactions",
      dashboard_search_placeholder: "Search by reference, subject, sequence, or party...",
      dashboard_search_aria: "Search latest transactions",

      // Incoming / Outgoing
      incoming_title: "Incoming Mail",
      incoming_desc: "Register and track received correspondence.",
      add_incoming: "+ New Incoming",
      outgoing_title: "Outgoing Mail",
      outgoing_desc: "Register and track dispatched correspondence.",
      add_outgoing: "+ New Outgoing",
      search_transactions_placeholder: "Search by reference, subject, sequence, or party...",

      // Archive
      archive_title: "Electronic Archive",
      archive_desc: "All recorded documents with search and comprehensive filtering.",
      all_types: "All Types",
      type_incoming: "Incoming",
      type_outgoing: "Outgoing",
      all_departments: "All Departments",
      date_from: "From Date",
      date_to: "To Date",
      date_from_placeholder: "From date (DD/MM/YYYY)",
      date_to_placeholder: "To date (DD/MM/YYYY)",
      sort_date_desc: "Date (Newest first)",
      sort_date_asc: "Date (Oldest first)",
      sort_created_desc: "Registration Date (Newest)",
      sort_updated_desc: "Last Modified",
      sort_ref_asc: "Reference Number",
      sort_seq_asc: "Sequence Number",
      sort_title_asc: "Subject",
      show_deleted: "Show Deleted",

      // Document table headers
      col_ref: "Reference No.",
      col_seq: "Sequence No.",
      col_title: "Subject",
      col_type: "Type",
      col_date: "Date",
      col_party: "Department / Party",
      no_documents: "No documents to display.",

      // Document modal
      create_incoming_title: "Register Incoming Document",
      create_outgoing_title: "Register Outgoing Document",
      edit_doc_title: "Edit Document",
      doc_date_label: "Document Date *",
      doc_date_placeholder: "Day/Month/Year (DD/MM/YYYY)",
      doc_ref_label: "Reference Number *",
      doc_ref_placeholder: "e.g. 2026/IN/001",
      doc_seq_label: "Sequence Number",
      doc_seq_placeholder: "e.g. 142",
      doc_from_label: "From",
      doc_from_placeholder: "e.g. Administrative Affairs",
      doc_to_label: "To",
      doc_to_placeholder: "e.g. Libya Telecom Company",
      doc_title_label: "Subject *",
      doc_title_placeholder: "e.g. Request for computer equipment",
      doc_dept_label: "Assigned Department",
      doc_notes_label: "Notes",
      doc_notes_placeholder: "Any additional details or notes...",
      doc_attachments_label: "Attachments",
      doc_attachments_hint: "Add files (PDF, images, documents - max 50 MB per file)",
      choose_calendar_title: "Pick date from calendar",
      saving_with_files: "Saving document and uploading attachments…",
      invalid_date_error: "Invalid date. Please enter date as Day/Month/Year (e.g. 20/10/2026).",

      // Document Details modal
      detail_doc_title: "Document Details",
      field_ref: "Reference Number",
      field_seq: "Sequence Number",
      field_subject: "Subject",
      field_type: "Type",
      field_date: "Document Date",
      field_dept: "Department",
      field_sender: "From",
      field_recipient: "To",
      field_notes: "Notes",
      field_created_by: "Registered By",
      field_created_at: "Registration Date",
      field_updated_by: "Last Modified By",
      field_updated_at: "Last Modified Date",
      field_deleted_by: "Deleted By",
      field_deleted_at: "Deletion Date",
      attachments_section: "Attachments",
      no_attachments: "No attachments for this document.",
      no_saved_attachments: "No attachments saved yet.",
      pending_files_label: "Pending files to upload:",

      // Preview modal
      preview_title: "Attachment Preview",
      preview_failed: "Unable to preview this file directly.",

      // Departments page
      departments_title: "Departments Management",
      departments_desc: "Add, edit, and manage approved system departments.",
      add_department: "+ Add Department",
      show_inactive_depts: "Show Disabled",
      dept_form_create: "Add New Department",
      dept_form_edit: "Edit Department",
      dept_name_label: "Department Name *",
      dept_name_placeholder: "Department or section name (e.g. IT Department)",
      dept_desc_label: "Description",
      dept_desc_placeholder: "Brief description of department scope...",
      no_departments: "No departments created yet.",
      col_dept_name: "Department Name",
      col_dept_desc: "Description",
      col_dept_users: "Members",
      col_dept_created: "Created Date",

      // Reports page
      reports_title: "Reports & Statistics",
      reports_desc: "Overview of correspondence volume and distribution.",
      print_report: "🖨️ Print",
      report_total: "Total Documents",
      report_incoming: "Incoming Mail",
      report_outgoing: "Outgoing Mail",
      report_by_type: "By Type",
      report_by_dept: "By Department",
      report_by_month: "By Month (Last 12 Months)",
      no_report_data: "No data available.",

      // Users page
      users_title: "User Management",
      users_desc: "Add and update user accounts, roles, and assigned departments.",
      add_user: "+ Add User",
      users_search_placeholder: "Username, full name, or employee number...",
      all_roles: "All Roles",
      all_statuses: "All Statuses",
      col_user_name: "Name & Username",
      col_user_emp_num: "Employee ID",
      col_user_role: "Role",
      col_user_dept: "Department",
      col_user_status: "Status",
      col_user_created: "Created Date",
      col_user_last_login: "Last Login",
      no_users: "No matching users found.",
      user_modal_add: "Add User",
      user_modal_edit: "Edit User",
      user_username_label: "Username *",
      user_username_placeholder: "e.g. m.benyousef",
      user_fullname_label: "Full Name *",
      user_fullname_placeholder: "e.g. Mohand Benyousef",
      user_emp_num_label: "Employee Number (Optional)",
      user_emp_num_placeholder: "e.g. 1042",
      user_role_label: "Role *",
      user_dept_label: "Assigned Department",
      user_dept_hint: "An employee requires an active department to access records. Admins see all departments.",
      user_password_label: "Password *",
      user_password_edit_label: "New Password (leave empty to keep current)",
      user_password_placeholder: "At least 8 characters...",
      user_active_label: "Account active (can log in)",

      // Audit page
      audit_title: "Audit Log",
      audit_desc: "Track login sessions, document changes, and system operations.",
      audit_action_placeholder: "Operation type (e.g. document.created)",
      audit_entity_placeholder: "Entity type (e.g. document)",
      col_audit_time: "Timestamp",
      col_audit_user: "User",
      col_audit_action: "Action",
      col_audit_entity: "Entity",
      col_audit_details: "Details",
      col_audit_ip: "IP Address",
      no_audit: "No matching audit records.",
      action_login_success: "Login Successful",
      action_login_failed: "Login Failed",
      action_logout: "Logout",
      action_password_changed: "Password Changed",
      action_document_created: "Document Created",
      action_document_updated: "Document Updated",
      action_document_deleted: "Document Deleted",
      action_document_restored: "Document Restored",
      action_file_uploaded: "Attachment Uploaded",
      action_file_downloaded: "Attachment Downloaded",
      action_file_viewed: "Attachment Viewed",
      action_file_deleted: "Attachment Deleted",
      action_user_created: "User Created",
      action_user_updated: "User Updated",
      action_user_password_reset: "Password Reset",
      action_dept_created: "Department Created",
      action_dept_updated: "Department Updated",
      action_dept_deleted: "Department Deleted",
      action_import_legacy: "Browser Data Migrated",
      action_import_backup: "Backup Imported",

      // Settings page
      settings_my_account: "My Account",
      settings_dept_info: "Assigned Department: ",
      settings_password_desc: "Change your account password. This will terminate other active sessions.",
      current_password_label: "Current Password *",
      current_password_placeholder: "Enter current password",
      new_password_label: "New Password *",
      new_password_placeholder: "At least 8 characters",
      confirm_password_label: "Confirm New Password *",
      update_password_btn: "Update Password",
      theme_title: "Appearance",
      theme_desc: "Choose appearance: System, Dark, or Light.",
      backup_title: "Backup & Import",
      backup_desc: "Download a JSON backup of system data, or import a previous backup.",
      export_backup_btn: "Download JSON Backup",
      import_backup_title: "Import Backup",
      import_backup_btn: "Import Backup",
      legacy_import_title: "Import Browser Demo Data",
      legacy_import_desc: "If data from the previous demo version is still saved in this browser, it can be migrated to the server. Documents and departments are imported, duplicates are ignored, and attachment contents are not migrated.",
      legacy_import_btn: "Migrate Browser Data to Server",
      legacy_clear_btn: "Delete Browser Data After Success",
      about_system_title: "About System",
      about_system_desc: "Document Management & Electronic Archive System — Libya Telecom (v1.0).",
      about_system_hint: "You can view the feature guide, capabilities, access permissions, and complete technical overview.",
      open_about_btn: "Open About Page",

      // About page
      about_page_title: "About Libya Telecom Electronic Archive",
      about_page_subtitle: "A modern platform for managing, tracking, and archiving official correspondence of Libya Telecom with high security and department isolation.",
      about_system_overview: "System Overview",
      about_overview_text: "Engineered to provide a secure and integrated digital workspace for archiving official correspondence. Features include instant search, advanced filtering, department scoping, and tamper-evident audit logging.",
      about_feature_archive: "Correspondence & Document Management",
      about_feature_archive_desc: "Accurate registration of incoming and outgoing correspondence with references, sequence numbers, dates, parties, and status tracking (new, in progress, completed, archived).",
      about_feature_isolation: "Strict Department Isolation",
      about_feature_isolation_desc: "Department-scoped permissions ensure employees only access records belonging to their assigned department.",
      about_feature_search: "Electronic Archive & Search",
      about_feature_search_desc: "Centralized archive with instant search by reference, sequence, or subject, and advanced filtering by department, date range, and status.",
      about_feature_attachments: "Attachments & Instant Preview",
      about_feature_attachments_desc: "Attach official PDF documents and high-resolution images with seamless in-app preview before and after saving, plus easy downloading.",
      about_feature_reports: "Reports & Statistics",
      about_feature_reports_desc: "Track correspondence volume with visual breakdown cards and charts showing completion rates and department distribution, plus CSV export.",
      about_feature_backup: "Backup & Data Protection",
      about_feature_backup_desc: "Full support for exporting and importing unified JSON backups, with protected attachment storage, password hashing, and session hardening.",
      about_feature_audit: "Permissions & Security Audit",
      about_feature_audit_desc: "Clear separation of roles between system administrators and archive employees, with immutable timestamps for all admin actions and login events.",
      about_roles_title: "Roles & Access Permissions",
      about_role_admin_badge: "System Administrator (Administrator)",
      about_role_admin_1: "Manage and update company departments and sections.",
      about_role_admin_2: "Create user accounts, define roles, and assign departments.",
      about_role_admin_3: "Full access to security audit log and monitor system activities.",
      about_role_admin_4: "Export/import system backups and manage global settings.",
      about_role_admin_5: "Register, modify, and view all correspondence, archive, and reports.",
      about_role_emp_badge: "Archive Employee (Employee)",
      about_role_emp_1: "Register incoming and outgoing correspondence for authorized departments.",
      about_role_emp_2: "Attach files and documents, preview attachments, and download them.",
      about_role_emp_3: "Search archive, view transaction status, and update records.",
      about_role_emp_4: "Generate and export approved statistical reports.",
      about_role_emp_5: "Change personal password and customize theme (Light / Dark mode).",
      about_tech_title: "Technical Architecture & Security Standards",
      about_tech_desc1: "The platform operates with a responsive bilingual UI supporting both RTL and LTR standards, communicating securely with a Fastify REST API backend and PostgreSQL database.",
      about_tech_desc2: "Attachments are stored securely in an isolated filesystem with authenticated access only, adhering to strict CSP, CSRF, and XSS safeguards.",

      // Login screen
      login_title: "Sign In",
      login_subtitle: "Libya Telecom — Electronic Archive",
      login_username_label: "Username or Employee ID",
      login_username_placeholder: "Enter username or employee ID",
      login_password_label: "Password",
      login_password_placeholder: "Enter password",
      login_submit: "Sign In",

      // Pager
      pager_prev: "Previous",
      pager_next: "Next",
      pager_info: "Page {page} of {totalPages} — Total {total}",

      // Access Notice
      notice_blocked_title: "Document Access Currently Unavailable",

      // Prompts & Dialogs
      prompt_input_title: "Text Input",
      confirm_action_title: "Confirm Action",
      confirm_delete_doc: "Are you sure you want to delete this document?",
      confirm_restore_doc: "Are you sure you want to restore this document?",
      confirm_delete_dept: "Are you sure you want to delete this department?",
      confirm_delete_file: "Are you sure you want to delete this attachment?",
      confirm_toggle_user: "Are you sure you want to change this account's status?"
    }
  };

  var STORAGE_KEY = "archive_language";
  var currentLang = "ar";

  try {
    var saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "en" || saved === "ar") {
      currentLang = saved;
    }
  } catch (_) {}

  function t(key, params) {
    var dict = translations[currentLang] || translations.ar;
    var str = dict[key] !== undefined ? dict[key] : (translations.ar[key] !== undefined ? translations.ar[key] : key);
    if (params && typeof params === "object") {
      Object.keys(params).forEach(function (param) {
        str = str.replace(new RegExp("\\{" + param + "\\}", "g"), params[param]);
      });
    }
    return str;
  }

  function applyLanguage(lang) {
    if (lang !== "ar" && lang !== "en") lang = "ar";
    currentLang = lang;
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch (_) {}

    var html = document.documentElement;
    html.lang = lang;
    html.dir = lang === "en" ? "ltr" : "rtl";

    // Update document title
    document.title = t("app_title");

    // Update elements with data-i18n (textContent)
    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      var key = el.getAttribute("data-i18n");
      if (key) {
        el.textContent = t(key);
      }
    });

    // Update elements with data-i18n-placeholder
    document.querySelectorAll("[data-i18n-placeholder]").forEach(function (el) {
      var key = el.getAttribute("data-i18n-placeholder");
      if (key) {
        el.placeholder = t(key);
      }
    });

    // Update elements with data-i18n-title
    document.querySelectorAll("[data-i18n-title]").forEach(function (el) {
      var key = el.getAttribute("data-i18n-title");
      if (key) {
        el.title = t(key);
      }
    });

    // Update elements with data-i18n-aria
    document.querySelectorAll("[data-i18n-aria]").forEach(function (el) {
      var key = el.getAttribute("data-i18n-aria");
      if (key) {
        el.setAttribute("aria-label", t(key));
      }
    });

    // Update language toggle button text and aria
    var toggleBtn = document.getElementById("langToggle");
    if (toggleBtn) {
      toggleBtn.textContent = lang === "ar" ? "EN" : "عربي";
      toggleBtn.title = t("lang_switch_title");
      toggleBtn.setAttribute("aria-label", t("lang_switch_title"));
    }

    // Also update login screen language toggle if exists
    var loginToggleBtn = document.getElementById("loginLangToggle");
    if (loginToggleBtn) {
      loginToggleBtn.textContent = lang === "ar" ? "EN" : "عربي";
      loginToggleBtn.title = t("lang_switch_title");
      loginToggleBtn.setAttribute("aria-label", t("lang_switch_title"));
    }

    // Dispatch event so active view re-renders dynamic strings
    window.dispatchEvent(new CustomEvent("archive:languagechange", { detail: { lang: lang } }));
  }

  function setLanguage(lang) {
    applyLanguage(lang);
  }

  function toggleLanguage() {
    setLanguage(currentLang === "ar" ? "en" : "ar");
  }

  // Export to window
  window.I18N = {
    t: t,
    setLanguage: setLanguage,
    toggleLanguage: toggleLanguage,
    getLanguage: function () {
      return currentLang;
    },
    isRtl: function () {
      return currentLang === "ar";
    }
  };

  // Run on DOM ready to apply initial texts
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      applyLanguage(currentLang);
    });
  } else {
    applyLanguage(currentLang);
  }
})();
