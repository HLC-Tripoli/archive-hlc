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
      lock: "قفل",
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
      nav_dashboard: "الصفحة الرئيسية",
      page_title_dashboard: "الصفحة الرئيسية",
      nav_incoming: "المراسلات الواردة",
      nav_outgoing: "المراسلات الصادرة",
      nav_other: "مراسلات أخرى",
      nav_other_attachments: "تخزين مرفقات أخرى",
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
      stat_other_sub: "محاضر وتقارير ومراسلات مسجلة",
      stat_total: "إجمالي المعاملات",
      stat_total_sub: "معاملات نشطة في المنظومة",
      stat_month: "هذا الشهر",
      stat_month_sub: "معاملات مسجلة هذا الشهر",
      latest_transactions: "أحدث المعاملات",
      dashboard_search_placeholder: "ابحث بالرقم الإشاري أو الموضوع أو رقم التسلسل أو الجهة...",
      dashboard_search_aria: "بحث في أحدث المعاملات",

      // Incoming / Outgoing / Other
      incoming_title: "المراسلات الواردة",
      incoming_desc: "تسجيل ومتابعة المراسلات المستلمة.",
      add_incoming: "+ إضافة وارد",
      outgoing_title: "المراسلات الصادرة",
      outgoing_desc: "تسجيل ومتابعة المراسلات المرسلة.",
      add_outgoing: "+ إضافة صادر",
      other_title: "مراسلات أخرى",
      other_desc: "تسجيل ومتابعة المراسلات والوثائق الأخرى ومحاضر الاجتماعات والتقارير.",
      add_other: "+ إضافة مراسلة أخرى",
      other_attachments_title: "تخزين مرفقات أخرى",
      other_attachments_desc: "تخزين وإدارة المرفقات والصور والمستندات والمسح الضوئي المباشر من السكانر.",
      add_from_files: "من الملفات",
      add_from_scanner: "من طابعة السكانر فوراً",
      field_entry_date: "تاريخ الإدخال",
      share: "مشاركة",
      preview: "معاينة",
      share_modal_title: "مشاركة المعاملة والمرفق",
      share_link_label: "رابط المعاملة المباشر:",
      copy_link: "نسخ الرابط",
      link_copied: "تم نسخ الرابط إلى الحافظة بنجاح!",
      scanner_modal_title: "التقاط فوري من طابعة السكانر / الكاميرا",
      scanner_feed_desc: "المسح الضوئي المباشر من الماسح أو الكاميرا وتخزينه كمرفق فوراً.",
      scanner_capture_btn: "التقاط المستند",
      scanner_retake_btn: "إعادة الالتقاط",
      scanner_save_btn: "تخزين المرفق فوراً",
      scanner_or_choose_device: "أو استيراد ملف الماسح الضوئي مباشرة",
      scanner_camera_permission_denied: "تعذّر تشغيل الماسح الضوئي أو الكاميرا. يرجى التأكد من توصيل الجهاز والسماح بالوصول.",
      no_scanner_support: "المتصفح لا يدعم الوصول المباشر للماسح، يمكنك رفع ملفات السكانر أدناه.",
      scanner_doc_default_title: "مستند ماسح ضوئي",
      share_native_btn: "مشاركة عبر التطبيقات",
      create_other_attachments_title: "تخزين مرفقات ومستندات",
      add_archive_doc: "+ إضافة وثيقة / معاملة",
      search_transactions_placeholder: "ابحث بالرقم الإشاري أو الموضوع أو الملاحظات أو رقم التسلسل أو الجهة...",

      // Archive
      archive_title: "الأرشيف الإلكتروني",
      archive_desc: "جميع الوثائق المسجلة في المنظومة مع البحث والتصفية.",
      all_types: "جميع الأنواع",
      all_other_types: "جميع الأنواع في مراسلات أخرى",
      type_incoming: "وارد",
      type_outgoing: "صادر",
      type_other: "مراسلات أخرى",
      type_other_attachments: "تخزين مرفقات أخرى",
      type_minutes: "محاضر اجتماعات",
      type_proposal: "مقترحات",
      type_report: "تقارير",
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
      col_attachment_name: "اسم المرفق / المستند",
      col_added_by: "أُضيف بواسطة",
      col_modified_by: "آخر تعديل بواسطة",
      col_modified_date: "تاريخ آخر تعديل",
      col_type: "النوع",
      col_date: "التاريخ",
      col_party: "الإدارة / الجهة",
      no_documents: "لا توجد معاملات لعرضها.",

      // Edit attachment modal
      edit_attachment_modal_title: "✏️ تعديل المرفق",
      edit_attachment_name_label: "اسم المرفق أو المستند *",

      // Document modal
      create_incoming_title: "تسجيل رسالة واردة",
      create_outgoing_title: "تسجيل رسالة صادرة",
      create_other_title: "تسجيل مراسلة أخرى",
      create_minutes_title: "تسجيل محضر اجتماع",
      create_proposal_title: "تسجيل مقترح",
      create_report_title: "تسجيل تقرير",
      edit_doc_title: "تعديل رسالة",
      doc_type_label: "نوع المعاملة *",
      doc_date_label: "تاريخ الرسالة *",
      doc_date_label_optional: "تاريخ المراسلة",
      doc_date_placeholder: "يوم/شهر/سنة (DD/MM/YYYY)",
      doc_ref_label: "الرقم الإشاري *",
      doc_ref_label_optional: "الرقم الإشاري (اختياري)",
      doc_ref_placeholder: "مثال: 2026/و/001",
      doc_ref_placeholder_optional: "اختياري - يمكن تركه فارغاً",
      doc_seq_label: "رقم التسلسل",
      doc_seq_placeholder: "مثال: 142",
      doc_from_label: "من",
      doc_from_placeholder: "مثال: إدارة الشؤون الإدارية",
      doc_to_label: "إلى",
      doc_to_placeholder: "مثال: شركة هاتف ليبيا",
      doc_title_label: "موضوع الرسالة *",
      doc_title_label_optional: "موضوع المراسلة (اختياري)",
      doc_title_placeholder: "مثال: طلب تزويد بمعدات حاسوبية",
      doc_title_placeholder_optional: "اختياري - يمكن تركه فارغاً أو كتابة وصف مختصر",
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
      user_permissions_label: "الصلاحيات الممنوحة",
      user_permissions_hint: "مدير النظام يمتلك كافة الصلاحيات تلقائياً.",
      col_user_permissions: "الصلاحيات",
      perm_all: "كامل الصلاحيات",
      perm_view: "عرض",
      perm_create: "إضافة",
      perm_edit: "تعديل",
      perm_delete: "حذف",
      user_delete_confirm: "هل تريد بالتأكيد حذف حساب المستخدم «{username}» نهائياً؟ سيتم إنهاء كافة جلساته ولا يمكن التراجع عن هذا الإجراء.",
      user_deleted_success: "تم حذف المستخدم بنجاح.",
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
      file_types_title: "أنواع وصيغ الملفات المسموحة",
      file_types_desc: "التحكم في صيغ الملفات المقبولة للرفع في المنظومة، تفعيلها أو تعطيلها، أو إضافة صيغ جديدة وحذفها.",
      add_file_type: "إضافة صيغة جديدة",
      restore_default_types: "استعادة الافتراضيات",
      restore_default_types_confirm: "هل تريد بالتأكيد استعادة الصيغ الافتراضية الأصلية لكافة الملفات؟ سيتم إعادة ضبط القائمة.",
      file_types_restored: "تمت استعادة الصيغ الافتراضية بنجاح.",
      search_file_type_placeholder: "ابحث عن صيغة ملف...",
      all_categories: "جميع التصنيفات",
      cat_document: "مستندات",
      cat_image: "صور ورسومات",
      cat_spreadsheet: "جداول بيانات",
      cat_presentation: "عروض تقديمية",
      cat_archive: "أرشيف وملفات مضغوطة",
      cat_data: "بيانات",
      cat_other: "أخرى",
      col_extension: "الامتداد",
      col_category: "التصنيف",
      col_mime: "نوع المحتوى (MIME)",
      col_description: "الوصف",
      col_status: "الحالة",
      col_actions: "الإجراءات",
      file_extension_label: "الامتداد (بدون نقطة) *",
      file_mime_label: "نوع المحتوى (MIME Type) *",
      file_category_label: "التصنيف *",
      file_label_ar: "الاسم بالعربية",
      file_label_en: "الاسم بالإنجليزية",
      file_type_added: "تمت إضافة صيغة الملف بنجاح.",
      file_type_toggled: "تم تحديث حالة الصيغة.",
      file_type_deleted: "تم حذف صيغة الملف.",
      file_type_delete_confirm: "هل تريد حذف صيغة «.{ext}»؟ لن يتم قبول رفع أي ملفات بهذه الصيغة مستقبلاً.",
      file_type_disabled_alert: "صيغة الملف «.{ext}» معطلة حالياً في المنظومة ولا يمكن رفعها.",
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
      // About / Team page
      about_hero_badge: "أرشيف هاتف ليبيا · هندسة النظم وتطوير البرمجيات",
      about_hero_title_p1: "نبني حلول الأرشفة الرقمية المتكاملة",
      about_hero_title_highlight: "برؤية تقنية حديثة وموثوقة",
      about_hero_desc: "يقف خلف منظومة الأرشيف الإلكتروني فريق تطوير متكامل يسعى لتمكين الإدارات والموظفين بأحدث التقنيات وأعلى معايير الأمان وسرعة الإنجاز.",
      about_stat_members: "مطوّران (2)",
      about_stat_security: "أمان وعزل صارم",
      about_stat_version: "الإصدار 1.0",
      about_section_title: "فريق التطوير والبرمجة",
      about_section_desc: "المهندسون القائمون على تصميم وتطوير وصيانة المنظومة",
      about_role_dev1: "مهندس برمجيات وتطوير النظم",
      about_role_dev2: "مهندسة برمجيات وتطوير النظم",
      about_trust_title: "ثقة وريادة مستمرة",
      about_trust_desc: "نعمل باستمرار على تطوير منظومة الأرشيف الإلكتروني وتحسين تجربة العمل المؤسسي لهاتف ليبيا.",
      about_dev1_name: "مهند عبدالفتاح رجب بن يوسف",
      about_dev1_initials: "م",
      about_dev2_name: "شهد عبدالمنعم ابوالقاسم",
      about_dev2_initials: "ش",

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
      lock: "Lock",
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
      page_title_dashboard: "Home Page",
      nav_incoming: "Incoming Mail",
      nav_outgoing: "Outgoing Mail",
      nav_other: "Other Correspondence",
      nav_other_attachments: "Other Attachments Storage",
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
      stat_other_sub: "Registered minutes, reports & other docs",
      stat_total: "Total Documents",
      stat_total_sub: "Active documents in system",
      stat_month: "This Month",
      stat_month_sub: "Transactions recorded this month",
      latest_transactions: "Latest Transactions",
      dashboard_search_placeholder: "Search by reference, subject, sequence, or party...",
      dashboard_search_aria: "Search latest transactions",

      // Incoming / Outgoing / Other
      incoming_title: "Incoming Mail",
      incoming_desc: "Register and track received correspondence.",
      add_incoming: "+ New Incoming",
      outgoing_title: "Outgoing Mail",
      outgoing_desc: "Register and track dispatched correspondence.",
      add_outgoing: "+ New Outgoing",
      other_title: "Other Correspondence",
      other_desc: "Register and track other documents, meeting minutes, and reports.",
      add_other: "+ New Other Document",
      other_attachments_title: "Other Attachments Storage",
      other_attachments_desc: "Store and manage attachments, images, documents, and direct scanner scans.",
      add_from_files: "From Files",
      add_from_scanner: "Direct From Scanner",
      field_entry_date: "Entry Date",
      share: "Share",
      preview: "Preview",
      share_modal_title: "Share Transaction & Attachment",
      share_link_label: "Direct Transaction Link:",
      copy_link: "Copy Link",
      link_copied: "Link copied to clipboard successfully!",
      scanner_modal_title: "Direct Capture from Scanner / Camera",
      scanner_feed_desc: "Live scan from document scanner or camera and store directly as attachment.",
      scanner_capture_btn: "Capture Document",
      scanner_retake_btn: "Retake",
      scanner_save_btn: "Save Attachment Now",
      scanner_or_choose_device: "Or upload scanner file directly",
      scanner_camera_permission_denied: "Cannot access scanner or camera. Please verify connection and allow access.",
      no_scanner_support: "Browser does not support direct scanner feed. You can upload scanner files below.",
      scanner_doc_default_title: "Scanned Document",
      share_native_btn: "Share via Apps",
      create_other_attachments_title: "Store Attachments & Documents",
      add_archive_doc: "+ New Document",
      search_transactions_placeholder: "Search by reference, subject, notes, sequence, or party...",

      // Archive
      archive_title: "Electronic Archive",
      archive_desc: "All recorded documents with search and comprehensive filtering.",
      all_types: "All Types",
      all_other_types: "All types in other correspondence",
      type_incoming: "Incoming",
      type_outgoing: "Outgoing",
      type_other: "Other Correspondence",
      type_other_attachments: "Other Attachments",
      type_minutes: "Meeting Minutes",
      type_proposal: "Proposals",
      type_report: "Reports",
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
      col_attachment_name: "Attachment / Document Name",
      col_added_by: "Added By",
      col_modified_by: "Last Modified By",
      col_modified_date: "Last Modified Date",
      col_type: "Type",
      col_date: "Date",
      col_party: "Department / Party",
      no_documents: "No documents to display.",

      // Edit attachment modal
      edit_attachment_modal_title: "✏️ Edit Attachment",
      edit_attachment_name_label: "Attachment / Document Name *",

      // Document modal
      create_incoming_title: "Register Incoming Document",
      create_outgoing_title: "Register Outgoing Document",
      create_other_title: "Register Other Document",
      create_minutes_title: "Register Meeting Minutes",
      create_proposal_title: "Register Proposal",
      create_report_title: "Register Report",
      edit_doc_title: "Edit Document",
      doc_type_label: "Document Type *",
      doc_date_label: "Document Date *",
      doc_date_label_optional: "Document Date",
      doc_date_placeholder: "Day/Month/Year (DD/MM/YYYY)",
      doc_ref_label: "Reference Number *",
      doc_ref_label_optional: "Reference Number (Optional)",
      doc_ref_placeholder: "e.g. 2026/IN/001",
      doc_ref_placeholder_optional: "Optional - can be left empty",
      doc_seq_label: "Sequence Number",
      doc_seq_placeholder: "e.g. 142",
      doc_from_label: "From",
      doc_from_placeholder: "e.g. Administrative Affairs",
      doc_to_label: "To",
      doc_to_placeholder: "e.g. Libya Telecom Company",
      doc_title_label: "Subject *",
      doc_title_label_optional: "Subject (Optional)",
      doc_title_placeholder: "e.g. Request for computer equipment",
      doc_title_placeholder_optional: "Optional - can be left empty or short description",
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
      user_permissions_label: "Assigned Permissions",
      user_permissions_hint: "Administrators automatically retain all permissions.",
      col_user_permissions: "Permissions",
      perm_all: "All Permissions",
      perm_view: "Viewing",
      perm_create: "Adding",
      perm_edit: "Editing",
      perm_delete: "Deleting",
      user_delete_confirm: "Are you sure you want to permanently delete user \"{username}\"? All user sessions will be terminated and this action cannot be undone.",
      user_deleted_success: "User deleted successfully.",
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
      file_types_title: "Allowed File Types & Formats",
      file_types_desc: "Manage accepted file formats for uploads, enable or disable formats, or add and delete custom formats.",
      add_file_type: "Add File Format",
      restore_default_types: "Restore Defaults",
      restore_default_types_confirm: "Are you sure you want to restore the default file formats? The list will be reset.",
      file_types_restored: "Default file formats restored successfully.",
      search_file_type_placeholder: "Search file formats...",
      all_categories: "All Categories",
      cat_document: "Documents",
      cat_image: "Images & Graphics",
      cat_spreadsheet: "Spreadsheets",
      cat_presentation: "Presentations",
      cat_archive: "Archives",
      cat_data: "Data",
      cat_other: "Other",
      col_extension: "Extension",
      col_category: "Category",
      col_mime: "MIME Type",
      col_description: "Description",
      col_status: "Status",
      col_actions: "Actions",
      file_extension_label: "Extension (without dot) *",
      file_mime_label: "MIME Type *",
      file_category_label: "Category *",
      file_label_ar: "Name (Arabic)",
      file_label_en: "Name (English)",
      file_type_added: "File format added successfully.",
      file_type_toggled: "File format status updated.",
      file_type_deleted: "File format deleted.",
      file_type_delete_confirm: "Are you sure you want to delete «.{ext}»? Uploading files of this type will no longer be accepted.",
      file_type_disabled_alert: "The file format «.{ext}» is currently disabled in the system.",
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
      // About / Team page
      about_hero_badge: "Archive HLC · Systems Engineering & Software Development",
      about_hero_title_p1: "Engineering Integrated Digital Archiving Solutions",
      about_hero_title_highlight: "With Modern, Reliable Technology",
      about_hero_desc: "Behind the Electronic Archive platform is a dedicated engineering team empowering departments and employees with state-of-the-art security, efficiency, and speed.",
      about_stat_members: "2 Developers",
      about_stat_security: "Strict Department Isolation",
      about_stat_version: "Version 1.0",
      about_section_title: "Development & Engineering Team",
      about_section_desc: "Software engineers responsible for architecture, development, and system maintenance",
      about_role_dev1: "Software & Systems Engineer",
      about_role_dev2: "Software & Systems Engineer",
      about_trust_title: "Enduring Trust & Innovation",
      about_trust_desc: "Continuously advancing the Electronic Archive system to elevate institutional workflows at Libya Telecom.",
      about_dev1_name: "مهند عبدالفتاح رجب بن يوسف",
      about_dev1_initials: "M",
      about_dev2_name: "شهد عبدالمنعم ابوالقاسم",
      about_dev2_initials: "S",

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
