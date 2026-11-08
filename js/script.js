"use strict";
/*
  منطق واجهة الأرشيف الإلكتروني — هاتف ليبيا.
  - كل البيانات تُقرأ وتُكتب عبر واجهة الخادم /api/v1 (لا بيانات تجريبية محلية).
  - المصادقة بكوكي جلسة HttpOnly + رمز CSRF في الطلبات المتغيّرة.
  - الواجهة عربية RTL بالكامل، وتُظهر/تُخفي عناصر الإدارة حسب الدور،
    مع العلم أن الخادم يفرض الصلاحيات دائماً (إخفاء الواجهة ليس حماية).
*/
(function () {
  var api = window.HlcApi;

  /* ========================================================================
     ثوابت وتسميات
     ======================================================================== */
  function _t(key, params) {
    if (window.I18N && typeof window.I18N.t === "function") {
      return window.I18N.t(key, params);
    }
    return key;
  }

  var PAGE_TITLES = {
    dashboard: "الصفحة الرئيسية",
    incoming: "المراسلات الواردة",
    outgoing: "المراسلات الصادرة",
    other: "مراسلات أخرى",
    other_attachments: "مراسلات أخرى",
    archive: "الأرشيف الإلكتروني",
    departments: "الإدارات والأقسام",
    reports: "التقارير والإحصائيات",
    users: "إدارة المستخدمين",
    audit: "سجل التدقيق",
    settings: "إعدادات المنظومة",
    about: "حول المنظومة"
  };

  function getPageTitle(pageId) {
    if (pageId === "dashboard") {
      var dashTitle = _t("page_title_dashboard");
      if (dashTitle && dashTitle !== "page_title_dashboard") return dashTitle;
    }
    var key = "nav_" + pageId;
    var res = _t(key);
    return res !== key ? res : (PAGE_TITLES[pageId] || pageId);
  }

  function getTypeLabel(type) {
    if (type === "incoming") return _t("type_incoming");
    if (type === "outgoing") return _t("type_outgoing");
    if (type === "other") return _t("type_other");
    if (type === "other_attachments") return _t("type_other_attachments");
    if (type === "minutes") return _t("type_minutes");
    if (type === "proposal") return _t("type_proposal");
    if (type === "report") return _t("type_report");
    return type || _t("none");
  }

  function getRoleLabel(role) {
    if (role === "admin") return _t("role_admin");
    if (role === "employee") return _t("role_employee");
    return role || _t("none");
  }

  var PREVIEWABLE_MIME_TYPES = {
    "application/pdf": true,
    "image/jpeg": true,
    "image/png": true,
    "image/webp": true,
    "image/gif": true,
    "image/bmp": true
  };

  var ACTION_KEY_MAP = {
    "auth.login.success": "action_login_success",
    "auth.login.failed": "action_login_failed",
    "auth.logout": "action_logout",
    "auth.password.changed": "action_password_changed",
    "document.created": "action_document_created",
    "document.updated": "action_document_updated",
    "document.deleted": "action_document_deleted",
    "document.restored": "action_document_restored",
    "file.uploaded": "action_file_uploaded",
    "file.downloaded": "action_file_downloaded",
    "file.viewed": "action_file_viewed",
    "file.deleted": "action_file_deleted",
    "user.created": "action_user_created",
    "user.updated": "action_user_updated",
    "user.password_reset": "action_user_password_reset",
    "department.created": "action_dept_created",
    "department.updated": "action_dept_updated",
    "department.deleted": "action_dept_deleted",
    "import.legacy": "action_import_legacy",
    "import.backup": "action_import_backup"
  };

  var ACTION_LABELS = {
    "auth.login.success": "دخول ناجح",
    "auth.login.failed": "محاولة دخول فاشلة",
    "auth.logout": "تسجيل خروج",
    "auth.password.changed": "تغيير كلمة المرور",
    "document.created": "تسجيل معاملة",
    "document.updated": "تعديل معاملة",
    "document.deleted": "حذف معاملة",
    "document.restored": "استعادة معاملة",
    "file.uploaded": "رفع مرفق",
    "file.downloaded": "تنزيل مرفق",
    "file.viewed": "عرض مرفق",
    "file.deleted": "حذف مرفق",
    "user.created": "إنشاء مستخدم",
    "user.updated": "تعديل مستخدم",
    "user.password_reset": "إعادة تعيين كلمة مرور",
    "department.created": "إضافة إدارة أو قسم",
    "department.updated": "تعديل إدارة أو قسم",
    "department.deleted": "حذف إدارة أو قسم",
    "setting.updated": "تعديل إعدادات المنظومة",
    "ticket.created": "فتح تذكرة دعم فني",
    "ticket.status_updated": "تحديث حالة تذكرة دعم",
    "ticket.message_added": "رد على تذكرة دعم",
    "import.legacy": "ترحيل بيانات من المتصفح",
    "import.backup": "استيراد نسخة احتياطية"
  };

  function getActionLabel(action) {
    var key = ACTION_KEY_MAP[action];
    if (key) {
      var res = _t(key);
      if (res !== key) return res;
    }
    return ACTION_LABELS[action] || action;
  }
  var LEGACY_DOCUMENTS_KEY = "hl_archive_data_v1";
  var LEGACY_DEPARTMENTS_KEY = "hl_archive_departments_v1";

  var CURRENT_APP_VERSION = "1.0.46";

  /* ========================================================================
     الحالة العامة
     ======================================================================== */
  var state = {
    user: null,
    currentPage: "dashboard",
    uploadMaxMb: 25,
    activeTicketId: null,
    tickets: [],
    departments: [],
    userFormDepartments: [],
    fileTypes: [],
    activeExtensions: [],
    fileTypesFilter: { q: "", category: "" },
    views: {
      dashboard: { page: 1, pageSize: 8, q: "", sort: "createdAt", order: "desc", total: 0 },
      incoming: { page: 1, pageSize: 10, q: "", sort: "createdAt", order: "desc", total: 0 },
      outgoing: { page: 1, pageSize: 10, q: "", sort: "createdAt", order: "desc", total: 0 },
      other: { page: 1, pageSize: 10, q: "", type: "", sort: "createdAt", order: "desc", total: 0 },
      other_attachments: {
        page: 1,
        pageSize: 10,
        q: "",
        departmentId: "",
        dateFrom: "",
        dateTo: "",
        sort: "createdAt",
        order: "desc",
        total: 0
      },
      archive: {
        page: 1,
        pageSize: 10,
        q: "",
        type: "",
        departmentId: "",
        dateFrom: "",
        dateTo: "",
        sort: "createdAt",
        order: "desc",
        includeDeleted: false,
        total: 0
      },
      users: { page: 1, pageSize: 10, q: "", role: "", isActive: "", total: 0 },
      audit: { page: 1, pageSize: 20, action: "", entityType: "", dateFrom: "", dateTo: "", total: 0 }
    },
    editingDocumentId: null,
    editingUserId: null,
    detailDocumentId: null,
    // نية الإنشاء تُحدَّد من الزر الذي فتح النافذة، لا من حقل نموذج.
    documentType: "incoming",
    pendingFiles: [],
    pendingCounter: 0,
    uploadingAttachments: false
  };

  function el(id) {
    return document.getElementById(id);
  }

  function isAdmin() {
    return Boolean(state.user && state.user.role === "admin");
  }

  function hasPermission(perm) {
    if (!state.user) return false;
    if (state.user.role === "admin") return true;
    if (!Array.isArray(state.user.permissions)) return true;
    return state.user.permissions.includes(perm);
  }

  function isDepartmentBlocked() {
    return Boolean(
      state.user &&
        state.user.role === "employee" &&
        (!state.user.departmentId || state.user.departmentActive === false)
    );
  }

  function currentDepartmentName() {
    if (!state.user || !state.user.departmentId) return "";
    return state.user.departmentName || "الإدارة المعيّنة";
  }

  function departmentAccessMessage() {
    if (!state.user || state.user.role !== "employee") return "";
    if (!state.user.departmentId) {
      return "لم يتم تعيينك إلى أي إدارة بعد. يرجى مراجعة مدير النظام لتعيين إدارتك قبل الوصول إلى المعاملات أو التقارير أو المرفقات.";
    }
    if (state.user.departmentActive === false) {
      return (
        "الإدارة المرتبطة بحسابك («" +
        currentDepartmentName() +
        "») معطّلة. يرجى مراجعة مدير النظام لتفعيلها أو إعادة تعيينك إلى إدارة نشطة."
      );
    }
    return "";
  }

  /* ========================================================================
     أدوات عرض عامة
     ======================================================================== */
  function escapeHTML(value) {
    return String(value === undefined || value === null ? "" : value).replace(
      /[&<>"']/g,
      function (char) {
        return {
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;"
        }[char];
      }
    );
  }

  function toast(message, kind) {
    var element = el("toast");
    element.textContent = message;
    element.classList.toggle("toast-error", kind === "error");
    element.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () {
      element.classList.remove("show");
    }, kind === "error" ? 5200 : 3200);
  }

  function setBusy(button, busy, busyLabel) {
    if (!button) return;
    if (busy) {
      if (!button.dataset.originalLabel) {
        button.dataset.originalLabel = button.textContent;
      }
      button.disabled = true;
      button.textContent = busyLabel || "جارٍ التنفيذ…";
    } else {
      button.disabled = false;
      if (button.dataset.originalLabel) {
        button.textContent = button.dataset.originalLabel;
        delete button.dataset.originalLabel;
      }
    }
  }

  function renderLoading(container, label) {
    container.innerHTML =
      '<div class="table-loading"><div class="spinner"></div><span>' +
      escapeHTML(label || "جارٍ التحميل…") +
      "</span></div>";
  }

  function renderEmpty(container, message) {
    container.innerHTML = '<div class="empty">' + escapeHTML(message) + "</div>";
  }

  function renderError(container, message) {
    container.innerHTML =
      '<div class="empty empty-error">⚠️ ' + escapeHTML(message) + "</div>";
  }

  function todayString() {
    var date = new Date();
    var pad = function (value) {
      return String(value).padStart(2, "0");
    };
    return (
      date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate())
    );
  }

  function parseDateInput(text) {
    if (!text || !text.trim()) {
      return { valid: true, iso: "", display: "" };
    }
    var trimmed = text.trim();
    var match = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (!match) {
      return {
        valid: false,
        error: "صيغة التاريخ غير صالحة. يرجى إدخال التاريخ بالصيغة: يوم/شهر/سنة (مثال: 20/10/2026)."
      };
    }
    var day = parseInt(match[1], 10);
    var month = parseInt(match[2], 10);
    var year = parseInt(match[3], 10);

    if (year < 1900 || year > 2100) {
      return { valid: false, error: "السنة المدخلة خارج النطاق المقبول (1900 - 2100)." };
    }
    if (month < 1 || month > 12) {
      return { valid: false, error: "الشهر غير صالح (يجب أن يكون بين 1 و 12)." };
    }
    var testDate = new Date(year, month - 1, day);
    if (
      testDate.getFullYear() !== year ||
      testDate.getMonth() !== month - 1 ||
      testDate.getDate() !== day
    ) {
      return { valid: false, error: "اليوم المحدد غير موجود في هذا الشهر." };
    }
    var pad = function (n) {
      return String(n).padStart(2, "0");
    };
    return {
      valid: true,
      iso: year + "-" + pad(month) + "-" + pad(day),
      display: pad(day) + "/" + pad(month) + "/" + year
    };
  }

  function formatDate(value) {
    if (!value) return "—";
    if (typeof value === "string") {
      var match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (match) {
        return match[3] + "/" + match[2] + "/" + match[1];
      }
    }
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    var pad = function (part) {
      return String(part).padStart(2, "0");
    };
    return (
      pad(date.getDate()) +
      "/" +
      pad(date.getMonth() + 1) +
      "/" +
      date.getFullYear()
    );
  }

  function formatDateTime(value) {
    if (!value) return "—";
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    var pad = function (part) {
      return String(part).padStart(2, "0");
    };
    return (
      pad(date.getDate()) +
      "/" +
      pad(date.getMonth() + 1) +
      "/" +
      date.getFullYear() +
      " " +
      pad(date.getHours()) +
      ":" +
      pad(date.getMinutes())
    );
  }

  function formatBytes(bytes) {
    if (typeof bytes !== "number" || bytes <= 0) return "0";
    if (bytes < 1024) return bytes + " بايت";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " ك.ب";
    return (bytes / (1024 * 1024)).toFixed(1) + " م.ب";
  }

  function truncate(text, max) {
    var value = String(text === undefined || text === null ? "" : text);
    return value.length > max ? value.slice(0, max) + "…" : value;
  }

  function showModal(id) {
    el(id).classList.add("show");
  }

  function hideModal(id) {
    el(id).classList.remove("show");
  }

  function closeDocumentModal() {
    if (state.uploadingAttachments) {
      toast("انتظر انتهاء رفع المرفقات قبل إغلاق النافذة.", "error");
      return;
    }
    hideModal("documentModal");
  }

  function showFormError(id, message) {
    var node = el(id);
    if (!message) {
      node.hidden = true;
      node.textContent = "";
      return;
    }
    node.hidden = false;
    node.textContent = message;
  }

  function errorMessage(error) {
    if (error && error.issues && error.issues.length > 0) {
      var issues = error.issues
        .slice(0, 3)
        .map(function (issue) {
          return (issue.field ? issue.field + ": " : "") + issue.message;
        })
        .join(" — ");
      return (error.message || "البيانات المرسلة غير صالحة.") + " (" + issues + ")";
    }
    return (error && error.message) || "حدث خطأ غير متوقع. حاول مرة أخرى.";
  }

  function renderPager(container, view, onChange) {
    var totalPages = Math.max(1, Math.ceil(view.total / view.pageSize));
    if (view.total === 0) {
      container.innerHTML = "";
      return;
    }
    var infoText = _t("pager_info", { page: view.page, totalPages: totalPages, total: view.total });
    container.innerHTML =
      '<button type="button" class="small-button" data-pager="prev"' +
      (view.page <= 1 ? " disabled" : "") +
      ">" + escapeHTML(_t("pager_prev")) + "</button>" +
      '<span class="pager-info">' +
      escapeHTML(infoText) +
      "</span>" +
      '<button type="button" class="small-button" data-pager="next"' +
      (view.page >= totalPages ? " disabled" : "") +
      ">" + escapeHTML(_t("pager_next")) + "</button>";
    container.querySelectorAll("[data-pager]").forEach(function (button) {
      button.addEventListener("click", function () {
        onChange(button.dataset.pager === "next" ? 1 : -1);
      });
    });
  }

  /* ========================================================================
     نوافذ التأكيد والإدخال
     ======================================================================== */
  var promptResolver = null;
  var confirmResolver = null;

  function askText(options) {
    return new Promise(function (resolve) {
      promptResolver = resolve;
      el("promptTitle").textContent = options.title;
      el("promptLabel").textContent = options.label;
      var input = el("promptInput");
      input.type = options.type || "text";
      input.value = "";
      input.placeholder = options.placeholder || "";
      if (options.minLength) input.minLength = options.minLength;
      else input.removeAttribute("minlength");
      if (options.maxLength) input.maxLength = options.maxLength;
      else input.removeAttribute("maxlength");
      showFormError("promptError", "");
      showModal("promptModal");
      input.focus();
    });
  }

  function resolvePrompt(value, error) {
    if (!promptResolver) return;
    if (error) {
      showFormError("promptError", error);
      return;
    }
    hideModal("promptModal");
    var resolver = promptResolver;
    promptResolver = null;
    resolver(value);
  }

  function confirmDialog(message, confirmLabel) {
    return new Promise(function (resolve) {
      confirmResolver = resolve;
      el("confirmMessage").textContent = message;
      el("confirmOk").textContent = confirmLabel || _t("confirm");
      el("confirmCancel").textContent = _t("cancel");
      showModal("confirmModal");
    });
  }

  function resolveConfirm(value) {
    if (!confirmResolver) return;
    hideModal("confirmModal");
    var resolver = confirmResolver;
    confirmResolver = null;
    resolver(value);
  }

  /* ========================================================================
     المصادقة
     ======================================================================== */
  function showLogin() {
    el("loginScreen").classList.remove("is-hidden");
    el("app").hidden = true;
  }

  function showApp() {
    el("loginScreen").classList.add("is-hidden");
    el("app").hidden = false;
  }

  function applyRoleUI() {
    var admin = isAdmin();
    var blocked = isDepartmentBlocked();
    var canCreate = hasPermission("create");
    document.querySelectorAll(".admin-only").forEach(function (node) {
      node.classList.toggle("is-hidden", !admin);
    });
    document.querySelectorAll("[data-requires-department]").forEach(function (node) {
      node.disabled = blocked;
      node.title = blocked ? departmentAccessMessage() : "";
    });

    var createBtns = ["addIncomingButton", "addOutgoingButton", "addOtherButton"];
    createBtns.forEach(function (btnId) {
      var node = el(btnId);
      if (node) {
        node.style.display = canCreate ? "" : "none";
      }
    });

    el("userName").textContent = state.user.displayName;
    var roleLabel = getRoleLabel(state.user.role);
    if (state.user.role === "employee" && currentDepartmentName()) {
      roleLabel += " — " + currentDepartmentName();
    }
    el("userRoleLabel").textContent = roleLabel;
    var firstLetter = state.user.displayName.trim().charAt(0);
    el("userAvatar").textContent = firstLetter || _t("unknown");

    var dashboardGreeting = el("dashboardGreeting");
    if (dashboardGreeting) {
      var name = (state.user && (state.user.displayName || state.user.username))
        ? (state.user.displayName || state.user.username).trim()
        : "";
      dashboardGreeting.textContent = name
        ? (window.I18N && window.I18N.getLanguage() === "en"
            ? 'Welcome "' + name + '" to the Electronic Archive'
            : 'مرحبا بك "' + name + '" في الأرشيف الإلكتروني')
        : _t("dashboard_greeting");
    }

    var notice = el("departmentAccessNotice");
    var message = departmentAccessMessage();
    notice.hidden = !message;
    el("departmentAccessNoticeText").textContent = message;
  }

  async function loadSession() {
    var session = await api.get("/auth/session");
    api.setCsrfToken(session.csrfToken);
    state.user = session.user;
    showApp();
    applyRoleUI();
    showPage("dashboard");
    loadActiveFileTypes();
    loadSystemSettings();
    checkForUpdates();
  }

  /**
   * يعيد قراءة حالة الموظف (الدور/التفعيل/الإدارة) من الخادم قبل تحميل أي
   * بيانات تشغيلية. قد يغيّر المدير إدارة الموظف أو حالتها أثناء جلسته،
   * فلا يجوز الاعتماد على نسخة تسجيل الدخول القديمة في الواجهة.
   */
  async function refreshSession() {
    try {
      var session = await api.get("/auth/session");
      api.setCsrfToken(session.csrfToken);
      state.user = session.user;
      applyRoleUI();
      return true;
    } catch (error) {
      return false;
    }
  }

  async function doLogin(event) {
    event.preventDefault();
    var button = el("loginSubmit");
    var message = el("loginMessage");
    message.textContent = "";
    setBusy(button, true, "جارٍ تسجيل الدخول…");
    try {
      var result = await api.post("/auth/login", {
        identifier: el("loginUsername").value.trim(),
        password: el("loginPassword").value
      });
      api.setCsrfToken(result.csrfToken);
      state.user = result.user;
      el("loginPassword").value = "";
      showApp();
      applyRoleUI();
      showPage("dashboard");
      loadActiveFileTypes();
      loadSystemSettings();
      checkForUpdates();
      toast("مرحباً " + result.user.displayName + "، تم تسجيل الدخول.");
    } catch (error) {
      message.textContent = errorMessage(error);
    } finally {
      setBusy(button, false);
    }
  }

  async function doLogout() {
    try {
      await api.post("/auth/logout");
    } catch (error) {
      /* حتى لو فشل الخروج، نعيد الواجهة إلى شاشة الدخول. */
    }
    state.user = null;
    api.setCsrfToken(null);
    el("loginPassword").value = "";
    el("loginUsername").value = "";
    var dashboardGreeting = el("dashboardGreeting");
    if (dashboardGreeting) {
      dashboardGreeting.textContent = "مرحباً بك في الأرشيف الإلكتروني";
    }
    showLogin();
    toast("تم تسجيل الخروج.");
  }

  /* ========================================================================
     الإدارات (تحميل مشترك + صفحة الإدارة)
     ======================================================================== */
  async function loadDepartmentsForSelects() {
    try {
      // المدير يحتاج الإدارات المعطّلة أيضاً عند تعديل ارتباط قديم، أما
      // الموظف فلا يعيد الخادم له إلا إدارته النشطة.
      var data = await api.get("/departments", {
        includeInactive: isAdmin() ? true : undefined
      });
      state.departments = data.items;
      fillDepartmentSelects();
    } catch (error) {
      /* الفلاتر تبقى فارغة عند تعذّر التحميل؛ لا نُفزع المستخدم برسالة. */
    }
  }

  function fillDepartmentSelects() {
    var archiveSelect = el("departmentFilter");
    var formSelect = el("department");
    if (!archiveSelect || !formSelect) return;

    if (!isAdmin()) {
      var own = null;
      if (state.user && state.user.departmentId) {
        own = {
          id: state.user.departmentId,
          name: state.user.departmentName || "إدارتي"
        };
      }
      archiveSelect.innerHTML = "";
      formSelect.innerHTML = "";
      if (own) {
        var ownFilter = document.createElement("option");
        ownFilter.value = own.id;
        ownFilter.textContent = own.name;
        archiveSelect.appendChild(ownFilter);
        var ownForm = document.createElement("option");
        ownForm.value = own.id;
        ownForm.textContent = own.name;
        formSelect.appendChild(ownForm);
        archiveSelect.value = own.id;
        formSelect.value = own.id;
      } else {
        archiveSelect.innerHTML = '<option value="">' + escapeHTML(_t("unspecified")) + '</option>';
        formSelect.innerHTML = '<option value="">' + escapeHTML(_t("unspecified")) + '</option>';
      }
      archiveSelect.disabled = true;
      formSelect.disabled = true;
      return;
    }

    var currentArchive = archiveSelect.value;
    var currentForm = formSelect.value;
    archiveSelect.disabled = false;
    formSelect.disabled = false;
    archiveSelect.innerHTML = '<option value="">' + escapeHTML(_t("all_departments")) + '</option>';
    formSelect.innerHTML = '<option value="">' + escapeHTML(_t("unspecified")) + '</option>';
    state.departments.forEach(function (department) {
      var filterOption = document.createElement("option");
      filterOption.value = department.id;
      filterOption.textContent =
        department.name + (department.isActive ? "" : " (" + _t("disabled") + ")");
      archiveSelect.appendChild(filterOption);
      formSelect.appendChild(filterOption.cloneNode(true));
    });
    archiveSelect.value = currentArchive;
    formSelect.value = currentForm;
    var otherAttSelect = el("other_attachmentsDeptFilter") || el("otherAttachmentsDeptFilter");
    if (otherAttSelect) {
      var curVal = otherAttSelect.value;
      otherAttSelect.innerHTML = '<option value="">' + escapeHTML(_t("all_departments")) + '</option>';
      state.departments.forEach(function (department) {
        var opt = document.createElement("option");
        opt.value = department.id;
        opt.textContent = department.name + (department.isActive ? "" : " (" + _t("disabled") + ")");
        otherAttSelect.appendChild(opt);
      });
      otherAttSelect.value = curVal;
    }
  }

  async function loadDepartmentListPage() {
    var container = el("departmentList");
    var includeInactive = isAdmin() && el("includeInactiveDepartments").checked;
    renderLoading(container, _t("loading"));
    try {
      var data = await api.get("/departments", {
        includeInactive: includeInactive || undefined
      });
      state.departments = data.items;
      fillDepartmentSelects();
      renderDepartmentList(data.items);
    } catch (error) {
      renderError(container, errorMessage(error));
    }
  }

  function renderDepartmentList(items) {
    var container = el("departmentList");
    if (!items.length) {
      renderEmpty(container, _t("no_departments"));
      return;
    }
    container.innerHTML = items
      .map(function (department) {
        var actions = "";
        if (isAdmin()) {
          var toggleText = department.isActive
            ? (window.I18N && window.I18N.getLanguage() === "en" ? "Disable" : "تعطيل")
            : (window.I18N && window.I18N.getLanguage() === "en" ? "Enable" : "تفعيل");
          actions =
            '<button type="button" class="small-button" data-dept-action="rename" data-id="' +
            escapeHTML(department.id) +
            '">' + escapeHTML(_t("edit")) + '</button>' +
            '<button type="button" class="small-button" data-dept-action="toggle" data-id="' +
            escapeHTML(department.id) +
            '">' +
            escapeHTML(toggleText) +
            "</button>" +
            '<button type="button" class="small-button delete-button" data-dept-action="delete" data-id="' +
            escapeHTML(department.id) +
            '">' + escapeHTML(_t("delete")) + '</button>';
        }
        var countLabel = window.I18N && window.I18N.getLanguage() === "en" ? "Documents: " : "عدد المعاملات: ";
        return (
          '<div class="department-item">' +
          '<div class="department-meta">' +
          "<strong>" +
          escapeHTML(department.name) +
          "</strong>" +
          "<small>" + countLabel +
          escapeHTML(department.documentCount) +
          "</small>" +
          (department.isActive
            ? ""
            : ' <span class="badge badge-inactive">' + escapeHTML(_t("disabled")) + '</span>') +
          "</div>" +
          '<div class="action-buttons">' +
          actions +
          "</div>" +
          "</div>"
        );
      })
      .join("");
  }

  async function handleDepartmentAction(button) {
    var id = button.dataset.id;
    var action = button.dataset.deptAction;
    var department = state.departments.find(function (item) {
      return item.id === id;
    });
    if (!department) return;

    if (action === "rename") {
      var name = await askText({
        title: "تعديل اسم الإدارة",
        label: "الاسم الجديد",
        placeholder: department.name,
        maxLength: 100
      });
      if (!name) return;
      try {
        await api.patch("/departments/" + id, { name: name });
        toast("تم تعديل اسم الإدارة.");
        loadDepartmentListPage();
      } catch (error) {
        toast(errorMessage(error), "error");
      }
      return;
    }

    if (action === "toggle") {
      try {
        await api.patch("/departments/" + id, { isActive: !department.isActive });
        toast(department.isActive ? "تم تعطيل الإدارة." : "تم تفعيل الإدارة.");
        loadDepartmentListPage();
      } catch (error) {
        toast(errorMessage(error), "error");
      }
      return;
    }

    if (action === "delete") {
      var confirmed = await confirmDialog(
        "هل تريد حذف الإدارة «" + department.name + "»؟ لا يمكن الحذف إذا كانت مرتبطة بمعاملات."
      );
      if (!confirmed) return;
      try {
        await api.del("/departments/" + id);
        toast("تم حذف الإدارة.");
        loadDepartmentListPage();
      } catch (error) {
        toast(errorMessage(error), "error");
      }
    }
  }

  /* ========================================================================
     الجداول والتقارير
     ======================================================================== */
  function getDocColumns(isOtherAttachments) {
    if (isOtherAttachments) {
      return [
        _t("col_attachment_name") || "اسم المرفق / المستند",
        _t("field_created_at") || "تاريخ الإضافة",
        _t("col_added_by") || "أُضيف بواسطة",
        _t("col_modified_date") || "تاريخ آخر تعديل",
        _t("col_modified_by") || "آخر تعديل بواسطة",
        _t("doc_attachments_label") || "الملف",
        _t("actions") || "الإجراءات"
      ];
    }
    return [
      _t("col_ref"),
      _t("col_seq"),
      _t("col_title"),
      _t("col_type"),
      _t("col_date"),
      _t("col_party"),
      _t("actions")
    ];
  }

  function renderDocuments(container, items, viewName) {
    if (!items.length) {
      renderEmpty(container, _t("no_documents"));
      return;
    }
    var admin = isAdmin();
    var isOtherAttachments = viewName === "other_attachments" || (container && container.id === "otherAttachmentsTable");
    var rows = items
      .map(function (document) {
        var deleted = Boolean(document.deletedAt);
        var actions = [];
        if (isOtherAttachments) {
          actions.push(
            '<button type="button" class="small-button" data-doc-action="view" data-id="' +
              escapeHTML(document.id) +
              '">' + escapeHTML(_t("view")) + '</button>'
          );
          if (admin || hasPermission("attach_view")) {
            actions.push(
              '<button type="button" class="small-button action-preview-btn" data-doc-action="preview" data-id="' +
                escapeHTML(document.id) +
                '">' + escapeHTML(_t("preview")) + '</button>'
            );
            actions.push(
              '<button type="button" class="small-button" data-doc-action="download" data-id="' +
                escapeHTML(document.id) +
                '">' + escapeHTML(_t("download")) + '</button>'
            );
          }
          if (!deleted && (admin || hasPermission("share"))) {
            actions.push(
              '<button type="button" class="small-button action-share-btn" data-doc-action="share" data-id="' +
                escapeHTML(document.id) +
                '">' + escapeHTML(_t("share")) + '</button>'
            );
          }
          if (!deleted && hasPermission("edit")) {
            actions.push(
              '<button type="button" class="small-button" data-doc-action="edit-attachment" data-id="' +
                escapeHTML(document.id) +
                '">' + escapeHTML(_t("edit")) + '</button>'
            );
          }
          if (admin && deleted) {
            actions.push(
              '<button type="button" class="small-button" data-doc-action="restore" data-id="' +
                escapeHTML(document.id) +
                '">' + escapeHTML(_t("restore")) + '</button>'
            );
          } else if (!deleted && (admin || hasPermission("delete"))) {
            actions.push(
              '<button type="button" class="small-button delete-button" data-doc-action="delete" data-id="' +
                escapeHTML(document.id) +
                '">' + escapeHTML(_t("delete")) + '</button>'
            );
          }
          return (
            "<tr" +
            (deleted ? ' class="row-deleted"' : "") +
            "><td><strong>" +
            escapeHTML(document.title || "—") +
            "</strong>" +
            (deleted ? ' <span class="badge badge-deleted">' + escapeHTML(_t("deleted_badge")) + '</span>' : "") +
            "</td><td>" +
            escapeHTML(formatDateTime(document.createdAt)) +
            "</td><td>" +
            escapeHTML(document.createdByName || "—") +
            "</td><td>" +
            escapeHTML(formatDateTime(document.updatedAt || document.createdAt)) +
            "</td><td>" +
            escapeHTML(document.updatedByName || document.createdByName || "—") +
            "</td><td>" +
            '<span class="badge">' + (document.filesCount || 0) + '</span>' +
            '</td><td><div class="action-buttons">' +
            actions.join("") +
            "</div></td></tr>"
          );
        }
        actions.push(
          '<button type="button" class="small-button" data-doc-action="view" data-id="' +
            escapeHTML(document.id) +
            '">' + escapeHTML(_t("view")) + '</button>'
        );
        if (!deleted && (admin || hasPermission("share"))) {
          actions.push(
            '<button type="button" class="small-button action-share-btn" data-doc-action="share" data-id="' +
              escapeHTML(document.id) +
              '">' + escapeHTML(_t("share")) + '</button>'
          );
        }
        if (!deleted && hasPermission("edit")) {
          var editAction = document.type === "other_attachments" ? "edit-attachment" : "edit";
          actions.push(
            '<button type="button" class="small-button" data-doc-action="' + editAction + '" data-id="' +
              escapeHTML(document.id) +
              '">' + escapeHTML(_t("edit")) + '</button>'
          );
        }
        if (admin && deleted) {
          actions.push(
            '<button type="button" class="small-button" data-doc-action="restore" data-id="' +
              escapeHTML(document.id) +
              '">' + escapeHTML(_t("restore")) + '</button>'
          );
        } else if (!deleted && (admin || hasPermission("delete"))) {
          actions.push(
            '<button type="button" class="small-button delete-button" data-doc-action="delete" data-id="' +
              escapeHTML(document.id) +
              '">' + escapeHTML(_t("delete")) + '</button>'
          );
        }
        return (
          "<tr" +
          (deleted ? ' class="row-deleted"' : "") +
          "><td>" +
          escapeHTML(document.reference || "—") +
          "</td><td>" +
          escapeHTML(document.sequenceNumber || "—") +
          "</td><td>" +
          escapeHTML(document.title || "—") +
          (deleted ? ' <span class="badge badge-deleted">' + escapeHTML(_t("deleted_badge")) + '</span>' : "") +
          "</td><td>" +
          escapeHTML(getTypeLabel(document.type)) +
          "</td><td>" +
          escapeHTML(formatDate(document.date)) +
          "</td><td>" +
          escapeHTML(document.department ? document.department.name : _t("unspecified")) +
          '</td><td><div class="action-buttons">' +
          actions.join("") +
          "</div></td></tr>"
        );
      })
      .join("");
    container.innerHTML =
      '<div class="table-wrap"><table><thead><tr>' +
      getDocColumns(isOtherAttachments).map(function (column) {
        return "<th>" + column + "</th>";
      }).join("") +
      "</tr></thead><tbody>" +
      rows +
      "</tbody></table></div>";
  }

  function documentQuery(viewName) {
    var view = state.views[viewName];
    if (viewName === "incoming" || viewName === "outgoing") {
      return {
        q: view.q,
        type: viewName,
        sort: "date",
        order: "desc",
        page: view.page,
        pageSize: view.pageSize
      };
    }
    if (viewName === "other") {
      var otherQuery = {
        q: view.q,
        sort: "date",
        order: "desc",
        page: view.page,
        pageSize: view.pageSize
      };
      if (view.type) {
        otherQuery.type = view.type;
      } else {
        otherQuery.types = "other,minutes,proposal,report,other_attachments";
      }
      return otherQuery;
    }
    if (viewName === "other_attachments") {
      return {
        q: view.q,
        type: "other_attachments",
        departmentId: isAdmin() ? view.departmentId : undefined,
        dateFrom: view.dateFrom,
        dateTo: view.dateTo,
        sort: view.sort || "createdAt",
        order: view.order || "desc",
        page: view.page,
        pageSize: view.pageSize
      };
    }
    if (viewName === "dashboard") {
      return {
        q: view.q,
        sort: "createdAt",
        order: "desc",
        page: view.page,
        pageSize: view.pageSize
      };
    }
    return {
      q: view.q,
      type: view.type,
      // الموظف لا يرسل departmentId إطلاقاً: الخادم يشتق النطاق من
      // department_id الحالي في قاعدة البيانات، فلا تؤثر أي حالة قديمة
      // في المتصفح ولا يمكن فرض إدارة أخرى عبر المرشِّح.
      departmentId: isAdmin() ? view.departmentId : undefined,
      dateFrom: view.dateFrom,
      dateTo: view.dateTo,
      sort: view.sort,
      order: view.order,
      includeDeleted: isAdmin() && view.includeDeleted ? true : undefined,
      page: view.page,
      pageSize: view.pageSize
    };
  }

  async function loadDocumentsView(viewName) {
    var view = state.views[viewName];
    var table = el(viewName + "Table") || el("otherAttachmentsTable");
    if (!table) return;
    renderLoading(table, "جارٍ تحميل المعاملات…");
    try {
      var data = await api.get("/documents", documentQuery(viewName));
      view.total = data.total;
      view.page = data.page;
      renderDocuments(table, data.items, viewName);
      var pager = el(viewName + "Pager") || el("otherAttachmentsPager");
      if (pager) {
        renderPager(pager, view, function (delta) {
          view.page = Math.max(1, view.page + delta);
          loadDocumentsView(viewName);
        });
      }
    } catch (error) {
      renderError(table, errorMessage(error));
    }
  }

  async function loadDashboardStats() {
    try {
      var stats = await api.get("/stats/dashboard");
      el("incomingCount").textContent = stats.incoming;
      el("outgoingCount").textContent = stats.outgoing;
      if (el("otherCount")) el("otherCount").textContent = stats.other || 0;
      el("totalCount").textContent = stats.activeDocuments;
      el("monthCount").textContent = stats.thisMonth || 0;
    } catch (error) {
      if (isDepartmentBlocked()) {
        el("incomingCount").textContent = "0";
        el("outgoingCount").textContent = "0";
        if (el("otherCount")) el("otherCount").textContent = "0";
        el("totalCount").textContent = "0";
        el("monthCount").textContent = "0";
      }
    }
  }

  /* ========================================================================
     المعاملات: النموذج والتفاصيل والحذف والاستعادة
     ======================================================================== */
  function canDeleteAttachments() {
    return Boolean(isAdmin() || (hasPermission("attach_delete") && !isDepartmentBlocked()));
  }

  function attachmentActions(file) {
    var actions = [];
    var canView = isAdmin() || hasPermission("attach_view");
    if (canView) {
      if (PREVIEWABLE_MIME_TYPES[file.mimeType]) {
        actions.push(
          '<button type="button" class="small-button" data-file-action="view" data-id="' +
            escapeHTML(file.id) +
            '" data-name="' +
            escapeHTML(file.originalName || file.filename || '') +
            '" data-mime="' +
            escapeHTML(file.mimeType || '') +
            '">' + escapeHTML(_t("view")) + '</button>'
        );
      }
      actions.push(
        '<button type="button" class="small-button" data-file-action="download" data-id="' +
          escapeHTML(file.id) +
          '">' + escapeHTML(_t("download")) + '</button>'
      );
    }
    if (canDeleteAttachments()) {
      actions.push(
        '<button type="button" class="small-button delete-button" data-file-action="delete" data-id="' +
          escapeHTML(file.id) +
          '"' +
          (state.uploadingAttachments ? " disabled" : "") +
          '>' + escapeHTML(_t("delete")) + '</button>'
      );
    }
    return actions.join("");
  }

  function populateDocumentTypeOptions(type, allowAll) {
    var select = el("documentType");
    if (!select) return;
    select.innerHTML = "";
    if (allowAll) {
      select.innerHTML =
        '<option value="incoming">' + escapeHTML(_t("type_incoming")) + '</option>' +
        '<option value="outgoing">' + escapeHTML(_t("type_outgoing")) + '</option>' +
        '<option value="other">' + escapeHTML(_t("type_other")) + '</option>' +
        '<option value="other_attachments">' + escapeHTML(_t("type_other_attachments")) + '</option>' +
        '<option value="minutes">' + escapeHTML(_t("type_minutes")) + '</option>' +
        '<option value="proposal">' + escapeHTML(_t("type_proposal")) + '</option>' +
        '<option value="report">' + escapeHTML(_t("type_report")) + '</option>';
    } else if (type === "incoming") {
      select.innerHTML = '<option value="incoming">' + escapeHTML(_t("type_incoming")) + '</option>';
    } else if (type === "outgoing") {
      select.innerHTML = '<option value="outgoing">' + escapeHTML(_t("type_outgoing")) + '</option>';
    } else if (type === "other_attachments") {
      select.innerHTML = '<option value="other_attachments">' + escapeHTML(_t("type_other_attachments")) + '</option>';
    } else {
      select.innerHTML =
        '<option value="other">' + escapeHTML(_t("type_other")) + '</option>' +
        '<option value="other_attachments">' + escapeHTML(_t("type_other_attachments")) + '</option>' +
        '<option value="minutes">' + escapeHTML(_t("type_minutes")) + '</option>' +
        '<option value="proposal">' + escapeHTML(_t("type_proposal")) + '</option>' +
        '<option value="report">' + escapeHTML(_t("type_report")) + '</option>';
    }
    select.value = type;
  }

  function updateDocumentFormLabels(type, isEdit) {
    var isOutgoing = type === "outgoing";
    var isIncoming = type === "incoming";
    var isOther = type === "other";
    var isOtherAttachments = type === "other_attachments";
    var isMinutes = type === "minutes";
    var isProposal = type === "proposal";
    var isReport = type === "report";
    var isOtherGroup = isOther || isOtherAttachments || isMinutes || isProposal || isReport;

    if (isEdit) {
      el("formTitle").textContent = _t("edit_doc_title");
    } else if (isOutgoing) {
      el("formTitle").textContent = _t("create_outgoing_title");
    } else if (isIncoming) {
      el("formTitle").textContent = _t("create_incoming_title");
    } else if (isOtherAttachments) {
      el("formTitle").textContent = _t("create_other_attachments_title");
    } else if (isMinutes) {
      el("formTitle").textContent = _t("create_minutes_title");
    } else if (isProposal) {
      el("formTitle").textContent = _t("create_proposal_title");
    } else if (isReport) {
      el("formTitle").textContent = _t("create_report_title");
    } else {
      el("formTitle").textContent = _t("create_other_title");
    }

    var dateLabel = document.querySelector('label[for="date"]');
    var refLabel = document.querySelector('label[for="reference"]');
    var titleLabel = document.querySelector('label[for="title"]');

    if (isOtherGroup) {
      // نزع النجمات وجعل الحقول اختيارية في معاملات مراسلات أخرى وما يتبعها
      if (dateLabel) dateLabel.textContent = _t("doc_date_label_optional");
      el("date").removeAttribute("required");

      if (refLabel) refLabel.textContent = _t("doc_ref_label_optional");
      el("reference").removeAttribute("required");
      el("reference").placeholder = _t("doc_ref_placeholder_optional");

      if (titleLabel) titleLabel.textContent = _t("doc_title_label_optional");
      el("title").removeAttribute("required");
      el("title").placeholder = _t("doc_title_placeholder_optional");
    } else {
      if (dateLabel) dateLabel.textContent = _t("doc_date_label");
      el("date").setAttribute("required", "required");

      if (refLabel) refLabel.textContent = _t("doc_ref_label");
      el("reference").setAttribute("required", "required");
      el("reference").placeholder = isOutgoing
        ? (window.I18N && window.I18N.getLanguage() === "en" ? "e.g. 2026/OUT/001" : "مثال: 2026/ص/001")
        : (window.I18N && window.I18N.getLanguage() === "en" ? "e.g. 2026/IN/001" : "مثال: 2026/و/001");

      if (titleLabel) titleLabel.textContent = _t("doc_title_label");
      el("title").setAttribute("required", "required");
      el("title").placeholder = _t("doc_title_placeholder");
    }

    el("sender").placeholder = isOutgoing
      ? (window.I18N && window.I18N.getLanguage() === "en" ? "e.g. Libya Telecom Company" : "مثال: شركة هاتف ليبيا")
      : (window.I18N && window.I18N.getLanguage() === "en" ? "e.g. Administrative Affairs" : "مثال: إدارة الشؤون الإدارية");
    el("recipient").placeholder = isOutgoing
      ? (window.I18N && window.I18N.getLanguage() === "en" ? "e.g. Ministry of Communications" : "مثال: وزارة الاتصالات")
      : (window.I18N && window.I18N.getLanguage() === "en" ? "e.g. Libya Telecom Company" : "مثال: شركة هاتف ليبيا");
  }

  function updateSenderFieldState(docType, isEdit, existingSender) {
    var senderInput = el("sender");
    var editBtn = el("senderEditButton");
    if (!senderInput || !editBtn) return;

    var isOutgoing = docType === "outgoing";
    if (isOutgoing) {
      editBtn.classList.remove("is-hidden");
      editBtn.textContent = _t("edit");
      editBtn.title = _t("edit");

      if (!isEdit) {
        if (state.user && state.user.departmentName) {
          senderInput.value = state.user.departmentName;
        }
      } else if (existingSender !== undefined) {
        senderInput.value = existingSender || "";
      }
      senderInput.readOnly = true;
      senderInput.classList.add("input-locked");
    } else {
      editBtn.classList.add("is-hidden");
      senderInput.readOnly = false;
      senderInput.classList.remove("input-locked");
    }
  }

  function handleSenderUnlock() {
    var senderInput = el("sender");
    var editBtn = el("senderEditButton");
    if (!senderInput || !editBtn) return;

    senderInput.readOnly = false;
    senderInput.classList.remove("input-locked");
    editBtn.classList.add("is-hidden");
    senderInput.focus();
  }

  async function openDocumentForm(mode, documentId, defaultType, allowAll) {
    if (state.uploadingAttachments) {
      toast("انتظر انتهاء رفع المرفقات قبل فتح نافذة أخرى.", "error");
      return;
    }
    if (isDepartmentBlocked()) {
      toast(departmentAccessMessage(), "error");
      return;
    }
    var doc = null;
    if (mode === "edit" && documentId) {
      try {
        var data = await api.get("/documents/" + documentId);
        doc = data.document;
      } catch (error) {
        toast(errorMessage(error), "error");
        return;
      }
    }
    state.editingDocumentId = doc ? doc.id : null;
    state.documentType = doc ? doc.type : (defaultType || "incoming");
    state.pendingFiles = [];
    state.pendingCounter = 0;
    state.uploadingAttachments = false;
    var form = el("documentForm");
    form.reset();
    populateDocumentTypeOptions(state.documentType, Boolean(allowAll));
    showFormError("documentFormError", "");
    await loadDepartmentsForSelects();

    updateDocumentFormLabels(state.documentType, Boolean(doc));
    el("reference").value = doc ? (doc.reference || "") : "";
    el("sequenceNumber").value = doc && doc.sequenceNumber ? doc.sequenceNumber : "";
    el("title").value = doc ? (doc.title || "") : "";
    el("date").value = doc ? (doc.date || "") : todayString();
    el("sender").value = doc ? (doc.sender || "") : "";
    updateSenderFieldState(state.documentType, Boolean(doc), doc ? doc.sender : undefined);
    el("recipient").value = doc ? doc.recipient : "";
    el("department").value = doc && doc.department
      ? doc.department.id
      : isAdmin()
        ? ""
        : state.user && state.user.departmentId
          ? state.user.departmentId
          : "";
    el("notes").value = doc ? doc.notes : "";

    var attachmentsSection = el("attachmentsSection");
    var attachmentInput = el("attachmentInput");
    var attachmentHint = el("attachmentHint");
    var canAttachUpload = isAdmin() || hasPermission("attach_upload");
    var canAttachView = isAdmin() || hasPermission("attach_view");
    var uploadBox = attachmentsSection ? attachmentsSection.querySelector(".attachment-upload") : null;
    if (uploadBox) uploadBox.style.display = canAttachUpload ? "" : "none";
    if (attachmentHint) attachmentHint.style.display = canAttachUpload ? "" : "none";
    attachmentInput.value = "";
    attachmentInput.disabled = !canAttachUpload;
    attachmentsSection.hidden = false;
    if (doc) {
      updateUploadHints();
      if (canAttachView) {
        await refreshAttachmentList(doc.id);
      } else {
        renderEmpty(el("attachmentList"), window.I18N && window.I18N.getLanguage() === "en" ? "You do not have permission to view attachments." : "ليس لديك صلاحية عرض المرفقات.");
      }
    } else {
      // وضع الإنشاء: يختار المستخدم الملفات الآن وتُرفع تلقائياً بعد حفظ المراسلة.
      updateUploadHints();
      renderEmpty(el("attachmentList"), _t("no_saved_attachments"));
    }
    renderPendingAttachments();
    showModal("documentModal");
    el("reference").focus();
  }

  async function refreshAttachmentList(documentId) {
    var container = el("attachmentList");
    renderLoading(container, "جارٍ تحميل المرفقات…");
    try {
      var data = await api.get("/documents/" + documentId);
      renderAttachmentList(data.document.files || []);
    } catch (error) {
      renderError(container, errorMessage(error));
    }
  }

  function renderAttachmentList(files) {
    var container = el("attachmentList");
    if (!files.length) {
      renderEmpty(container, _t("no_attachments"));
      return;
    }
    container.innerHTML = files
      .map(function (file) {
        return (
          '<div class="attachment-item">' +
          '<div class="attachment-meta"><strong>' +
          escapeHTML(file.originalName) +
          "</strong><small>" +
          escapeHTML(formatBytes(file.sizeBytes)) +
          " — " +
          escapeHTML(formatDateTime(file.createdAt)) +
          (file.uploadedByName
            ? " — بواسطة " + escapeHTML(file.uploadedByName)
            : "") +
          "</small></div>" +
          '<div class="action-buttons">' +
          attachmentActions(file) +
          "</div></div>"
        );
      })
      .join("");
  }

  function isPreviewableFile(file) {
    if (!file) return false;
    if (file.type && PREVIEWABLE_MIME_TYPES[file.type]) return true;
    var name = (file.name || "").toLowerCase();
    return (
      name.endsWith(".pdf") ||
      name.endsWith(".png") ||
      name.endsWith(".jpg") ||
      name.endsWith(".jpeg") ||
      name.endsWith(".webp") ||
      name.endsWith(".gif") ||
      name.endsWith(".bmp")
    );
  }

  function isImageAttachment(mime, name) {
    if (mime && mime.toLowerCase().startsWith("image/")) return true;
    var n = (name || "").toLowerCase();
    return (
      n.endsWith(".png") ||
      n.endsWith(".jpg") ||
      n.endsWith(".jpeg") ||
      n.endsWith(".webp") ||
      n.endsWith(".gif") ||
      n.endsWith(".bmp") ||
      n.endsWith(".svg")
    );
  }

  var currentPreviewObjectUrl = null;

  function closePreviewModal() {
    hideModal("previewModal");
    var body = el("previewModalBody");
    if (body) body.innerHTML = "";
    var modalBox = document.querySelector("#previewModal .preview-modal-box");
    if (modalBox) modalBox.classList.remove("is-maximized");
    var maxBtn = el("previewMaximizeBtn");
    if (maxBtn) maxBtn.textContent = "⛶ تكبير النافذة";
    var zoomBtn = el("previewZoomToggleBtn");
    if (zoomBtn) {
      zoomBtn.style.display = "none";
      zoomBtn.textContent = "🔍 الحجم الأصلي";
    }
    var dlBtn = el("previewDownloadBtn");
    if (dlBtn) dlBtn.style.display = "none";
    if (currentPreviewObjectUrl) {
      try {
        URL.revokeObjectURL(currentPreviewObjectUrl);
      } catch (_) {}
      currentPreviewObjectUrl = null;
    }
  }

  function openPreviewModal(title, url, isImage) {
    el("previewModalTitle").textContent = title ? ("معاينة: " + title) : "معاينة المرفق";
    var body = el("previewModalBody");
    body.innerHTML = "";

    var modalBox = document.querySelector("#previewModal .preview-modal-box");
    if (modalBox) modalBox.classList.remove("is-maximized");
    var maxBtn = el("previewMaximizeBtn");
    if (maxBtn) maxBtn.textContent = "⛶ تكبير النافذة";

    var zoomBtn = el("previewZoomToggleBtn");
    var dlBtn = el("previewDownloadBtn");
    if (dlBtn) {
      dlBtn.href = url;
      dlBtn.download = title || "attachment";
      dlBtn.style.display = "inline-flex";
    }

    if (isImage) {
      if (zoomBtn) {
        zoomBtn.style.display = "inline-flex";
        zoomBtn.textContent = "🔍 الحجم الأصلي";
      }
      var img = document.createElement("img");
      img.className = "preview-img";
      img.alt = title || "معاينة المرفق";
      img.src = url;
      img.title = "انقر للتكبير أو استعادة الحجم";

      var toggleZoom = function () {
        var zoomed = img.classList.toggle("is-zoomed");
        if (zoomBtn) {
          zoomBtn.textContent = zoomed ? "🔍 ملاءمة الشاشة" : "🔍 الحجم الأصلي";
        }
      };

      img.addEventListener("click", toggleZoom);
      if (zoomBtn) {
        zoomBtn.onclick = toggleZoom;
      }
      body.appendChild(img);
    } else {
      if (zoomBtn) zoomBtn.style.display = "none";
      var iframe = document.createElement("iframe");
      iframe.className = "preview-frame";
      iframe.title = title || "معاينة المستند";
      iframe.src = url;
      body.appendChild(iframe);
    }
    showModal("previewModal");
  }

  function previewPendingFile(key) {
    var entry = state.pendingFiles.find(function (item) {
      return item.key === key;
    });
    if (!entry || !entry.file) return;

    var file = entry.file;
    var mime = (file.type || "").toLowerCase();
    var name = (file.name || "").toLowerCase();
    var isImage = (mime.indexOf("image/") === 0) ||
      name.endsWith(".png") ||
      name.endsWith(".jpg") ||
      name.endsWith(".jpeg") ||
      name.endsWith(".webp") ||
      name.endsWith(".gif") ||
      name.endsWith(".bmp");

    if (currentPreviewObjectUrl) {
      try { URL.revokeObjectURL(currentPreviewObjectUrl); } catch (_) {}
      currentPreviewObjectUrl = null;
    }

    if (isImage) {
      var reader = new FileReader();
      reader.onload = function () {
        openPreviewModal(file.name, reader.result, true);
      };
      reader.readAsDataURL(file);
    } else {
      currentPreviewObjectUrl = URL.createObjectURL(file);
      openPreviewModal(file.name, currentPreviewObjectUrl, false);
    }
  }

  function pendingStatusText(entry) {
    if (entry.status === "uploading") return "جارٍ الرفع…";
    if (entry.status === "failed") return "تعذّر الرفع: " + (entry.error || "خطأ غير معروف");
    return state.editingDocumentId
      ? "بانتظار الرفع أو الحفظ"
      : "بانتظار حفظ المراسلة ثم الرفع تلقائياً";
  }

  /** يعرض الملفات المختارة غير المحفوظة بعد (إنشاء) أو الفاشلة (تعديل). */
  function renderPendingAttachments() {
    var section = el("pendingAttachmentsSection");
    var container = el("pendingAttachmentList");
    if (!state.pendingFiles.length) {
      section.hidden = true;
      container.innerHTML = "";
      return;
    }
    section.hidden = false;
    container.innerHTML = state.pendingFiles
      .map(function (entry) {
        var actions = "";
        if (entry.status !== "uploading") {
          if (isPreviewableFile(entry.file)) {
            actions +=
              '<button type="button" class="small-button" data-pending-action="view" data-key="' +
              entry.key +
              '">عرض</button>';
          }
          if (state.editingDocumentId && entry.status === "queued") {
            actions +=
              '<button type="button" class="small-button accent-button" data-pending-action="upload" data-key="' +
              entry.key +
              '">رفع</button>';
          }
          if (entry.status === "failed") {
            actions +=
              '<button type="button" class="small-button" data-pending-action="retry" data-key="' +
              entry.key +
              '">إعادة المحاولة</button>';
          }
          actions +=
            '<button type="button" class="small-button secondary-button" data-pending-action="remove" data-key="' +
            entry.key +
            '">إلغاء</button>';
        }
        var classes =
          "attachment-item" +
          (entry.status === "failed" ? " is-failed" : "") +
          (entry.status === "uploading" ? " is-uploading" : "");
        return (
          '<div class="' +
          classes +
          '">' +
          '<div class="attachment-meta"><strong>' +
          escapeHTML(entry.file.name) +
          "</strong><small>" +
          escapeHTML(formatBytes(entry.file.size)) +
          ' — <span class="attachment-status' +
          (entry.status === "failed" ? " is-error" : "") +
          '">' +
          escapeHTML(pendingStatusText(entry)) +
          "</span>" +
          (entry.status === "uploading"
            ? '<span class="attachment-progress" aria-hidden="true"><span></span></span>'
            : "") +
          "</small></div>" +
          '<div class="action-buttons">' +
          actions +
          "</div></div>"
        );
      })
      .join("");
  }

  function addPendingFiles(fileList) {
    var disabledTypesFound = [];
    var oversizedFound = [];
    var maxBytes = (state.uploadMaxMb || 25) * 1024 * 1024;
    Array.prototype.slice.call(fileList || []).forEach(function (file) {
      var ext = (file.name.split(".").pop() || "").toLowerCase();
      if (state.activeExtensions && state.activeExtensions.length && !state.activeExtensions.includes(ext)) {
        disabledTypesFound.push(ext);
        return;
      }
      if (file.size > maxBytes) {
        oversizedFound.push(file.name);
        return;
      }
      state.pendingCounter += 1;
      state.pendingFiles.push({
        key: state.pendingCounter,
        file: file,
        status: "queued",
        error: null
      });
    });
    if (disabledTypesFound.length) {
      toast(_t("file_type_disabled_alert", { ext: disabledTypesFound.join(", .") }), "error");
    }
    if (oversizedFound.length) {
      toast("تجاوزت بعض الملفات الحد الأقصى المسموح به (" + (state.uploadMaxMb || 25) + " م.ب): " + oversizedFound.join(", "), "error");
    }
    // تصفير الحقل يسمح باختيار الملف نفسه مرة أخرى دون استبدال القائمة.
    el("attachmentInput").value = "";
    renderPendingAttachments();
  }

  function removePendingFile(key) {
    state.pendingFiles = state.pendingFiles.filter(function (entry) {
      return entry.key !== key;
    });
    renderPendingAttachments();
  }

  async function uploadPendingEntries(documentId, onlyKey) {
    if (!documentId || state.uploadingAttachments) return;
    var entries = state.pendingFiles.filter(function (entry) {
      if (onlyKey !== undefined) return entry.key === onlyKey;
      return entry.status === "queued" || entry.status === "failed";
    });
    if (!entries.length) return;

    state.uploadingAttachments = true;
    el("attachmentInput").disabled = true;
    el("saveDocumentButton").disabled = true;
    var uploadedNames = [];
    var failedNames = [];
    try {
      for (var index = 0; index < entries.length; index += 1) {
        var entry = entries[index];
        entry.status = "uploading";
        entry.error = null;
        renderPendingAttachments();
        var formData = new FormData();
        formData.append("file", entry.file);
        try {
          await api.postForm("/documents/" + documentId + "/files", formData);
          state.pendingFiles = state.pendingFiles.filter(function (item) {
            return item.key !== entry.key;
          });
          uploadedNames.push(entry.file.name);
        } catch (uploadError) {
          entry.status = "failed";
          entry.error = errorMessage(uploadError);
          failedNames.push(entry.file.name);
        }
        renderPendingAttachments();
      }
    } finally {
      state.uploadingAttachments = false;
      el("attachmentInput").disabled = false;
      el("saveDocumentButton").disabled = false;
      renderPendingAttachments();
    }

    await refreshAttachmentList(documentId);
    refreshDocumentsAndStats();
    if (failedNames.length) {
      toast(
        (uploadedNames.length ? "تم رفع " + uploadedNames.length + " ملفاً، " : "") +
          "وتعذّر رفع: " +
          failedNames.join("، ") +
          ". يمكنك إعادة المحاولة من قائمة الملفات.",
        "error"
      );
    } else if (uploadedNames.length) {
      toast(
        uploadedNames.length === 1
          ? "تم رفع المرفق."
          : "تم رفع " + uploadedNames.length + " مرفقات."
      );
    }
  }

  function handleAttachmentSelection() {
    var input = el("attachmentInput");
    var files = Array.prototype.slice.call(input.files || []);
    if (!files.length) return;
    addPendingFiles(files);
  }

  async function submitDocumentForm(event) {
    event.preventDefault();
    var button = el("saveDocumentButton");
    showFormError("documentFormError", "");
    var docType = el("documentType") ? el("documentType").value : state.documentType;
    var isOtherGroup =
      docType === "other" ||
      docType === "other_attachments" ||
      docType === "minutes" ||
      docType === "proposal" ||
      docType === "report";
    var dateVal = el("date").value.trim();
    if (!dateVal) {
      if (isOtherGroup) {
        dateVal = formatDate(todayString());
      } else {
        showFormError(
          "documentFormError",
          "تاريخ الرسالة غير صالح. يرجى إدخال التاريخ بالصيغة: يوم/شهر/سنة (مثال: 20/10/2026)."
        );
        el("date").focus();
        return;
      }
    }
    var refVal = el("reference").value.trim();
    var titleVal = el("title").value.trim();
    if (!isOtherGroup && (!refVal || !titleVal)) {
      showFormError(
        "documentFormError",
        "الرقم الإشاري وموضوع الرسالة حقول مطلوبة."
      );
      if (!refVal) el("reference").focus();
      else el("title").focus();
      return;
    }
    var createMode = !state.editingDocumentId;
    var payload = {
      reference: refVal || null,
      sequenceNumber: el("sequenceNumber").value.trim() || null,
      title: titleVal || null,
      date: dateVal,
      sender: el("sender").value.trim(),
      recipient: el("recipient").value.trim(),
      notes: el("notes").value.trim()
    };
    // نوع المراسلة نية إنشاء صريحة من القسم الذي فتح النافذة. في التعديل
    // لا نرسله إطلاقاً كي يبقى النوع المخزَّن دون تغيير.
    if (createMode) payload.type = docType;
    // المدير وحده يختار الإدارة؛ أما الموظف فيفرض الخادم إدارته الحالية
    // من قاعدة البيانات، ولا نرسل قيمة محلية قد تكون قديمة.
    if (isAdmin()) payload.departmentId = el("department").value || null;
    // إغلاق النموذج مباشرة وفوراً عند الضغط على الحفظ واجتياز التحقق
    hideModal("documentModal");

    var queued = state.pendingFiles.length > 0;
    toast(createMode && queued ? "جارٍ الحفظ ورفع المرفقات…" : "جارٍ الحفظ…");
    setBusy(button, true, createMode && queued ? "جارٍ الحفظ ورفع المرفقات…" : "جارٍ الحفظ…");
    try {
      if (!createMode) {
        await api.patch("/documents/" + state.editingDocumentId, payload);
        if (state.pendingFiles.length) {
          await uploadPendingEntries(state.editingDocumentId);
        } else {
          toast("تم تحديث المراسلة.");
        }
        refreshDocumentsAndStats();
      } else {
        var created = await api.post("/documents", payload);
        var newDocumentId =
          created && created.document && created.document.id ? created.document.id : null;
        if (!newDocumentId) throw new Error("تعذّر تحديد المراسلة المنشأة.");
        state.editingDocumentId = newDocumentId;
        refreshDocumentsAndStats();
        if (state.pendingFiles.length) {
          toast("تم تسجيل المراسلة بنجاح. جارٍ رفع المرفقات…");
          await uploadPendingEntries(newDocumentId);
        } else {
          toast("تم تسجيل المراسلة بنجاح.");
        }
      }
    } catch (error) {
      // في حال حدوث خطأ، إعادة إظهار النموذج لتمكين المستخدم من المتابعة دون فقدان البيانات
      showModal("documentModal");
      showFormError("documentFormError", errorMessage(error));
      toast(errorMessage(error), "error");
    } finally {
      setBusy(button, false);
    }
  }

  async function downloadFile(fileId) {
    try {
      var result = await api.download("/files/" + fileId + "/download");
      api.saveBlob(result.blob, result.filename);
    } catch (error) {
      toast(errorMessage(error), "error");
    }
  }

  function previewFile(fileId, name, mime) {
    var url = api.url("/files/" + encodeURIComponent(fileId) + "/view");
    var isImage = isImageAttachment(mime, name);
    openPreviewModal(name || "مستند مرفق", url, isImage);
  }

  async function deleteFile(fileId) {
    if (state.uploadingAttachments) {
      toast("انتظر انتهاء رفع الملفات قبل حذف مرفق محفوظ.", "error");
      return;
    }
    var confirmed = await confirmDialog("هل تريد حذف هذا المرفق نهائياً؟");
    if (!confirmed) return;
    try {
      await api.del("/files/" + fileId);
      toast("تم حذف المرفق.");
      if (state.editingDocumentId) await refreshAttachmentList(state.editingDocumentId);
      if (state.detailDocumentId && el("detailModal").classList.contains("show")) {
        await openDocumentDetail(state.detailDocumentId);
      }
      refreshDocumentsAndStats();
    } catch (error) {
      toast(errorMessage(error), "error");
    }
  }

  async function openDirectDocumentPreview(docId) {
    if (!isAdmin() && !hasPermission("attach_view")) {
      toast(window.I18N && window.I18N.getLanguage() === "en" ? "You do not have permission to view attachments." : "ليس لديك صلاحية عرض المرفقات.", "error");
      return;
    }
    try {
      var data = await api.get("/documents/" + docId);
      var doc = data.document;
      if (!doc || !doc.files || !doc.files.length) {
        toast("لا توجد مرفقات مخزنة في هذه المعاملة لمعاينتها.", "info");
        return;
      }
      var first = doc.files[0];
      previewFile(first.id, first.originalName, first.mimeType);
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  async function directDownloadDocumentFiles(docId) {
    if (!isAdmin() && !hasPermission("attach_view")) {
      toast(window.I18N && window.I18N.getLanguage() === "en" ? "You do not have permission to view attachments." : "ليس لديك صلاحية تحميل المرفقات.", "error");
      return;
    }
    try {
      var data = await api.get("/documents/" + docId);
      var doc = data.document;
      if (!doc || !doc.files || !doc.files.length) {
        toast("لا توجد مرفقات مخزنة في هذه المعاملة لتنزيلها.", "info");
        return;
      }
      for (var i = 0; i < doc.files.length; i++) {
        await downloadFile(doc.files[i].id);
      }
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  async function openShareModal(docId) {
    if (!isAdmin() && !hasPermission("share")) {
      toast(window.I18N && window.I18N.getLanguage() === "en" ? "You do not have permission to share." : "ليس لديك صلاحية مشاركة المعاملات.", "error");
      return;
    }
    try {
      var data = await api.get("/documents/" + docId);
      var doc = data.document;
      if (!doc) return;
      var title = doc.title || doc.reference || ("معاملة #" + doc.id);
      el("shareDocTitle").textContent = title;
      var metaParts = [];
      if (doc.reference) metaParts.push("الرقم الإشاري: " + doc.reference);
      if (doc.createdAt) metaParts.push("تاريخ الإدخال: " + formatDateTime(doc.createdAt));
      if (doc.files && doc.files.length) {
        metaParts.push("المرفقات: " + doc.files.length);
      }
      el("shareDocMeta").textContent = metaParts.join(" | ");

      var origin = window.location.origin;
      var path = window.location.pathname;
      var url = origin + path + "#doc-" + encodeURIComponent(doc.id);
      el("shareLinkInput").value = url;

      var nativeRow = el("shareNativeRow");
      if (navigator.share) {
        nativeRow.style.display = "block";
        el("shareNativeBtn").onclick = function () {
          navigator.share({
            title: title,
            text: "معاملة ومرفق: " + title,
            url: url
          }).catch(function () {});
        };
      } else {
        nativeRow.style.display = "none";
      }
      showModal("shareModal");
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  function closeShareModal() {
    hideModal("shareModal");
  }

  async function openEditAttachmentModal(documentId) {
    try {
      var data = await api.get("/documents/" + documentId);
      var doc = data.document;
      if (!doc) return;
      el("editAttachmentId").value = doc.id;
      el("editAttachmentName").value = doc.title || "";
      var errorEl = el("editAttachmentFormError");
      if (errorEl) {
        errorEl.textContent = "";
        errorEl.style.display = "none";
      }
      var auditInfo = el("editAttachmentAuditInfo");
      if (auditInfo) {
        var addedBy = doc.createdByName || "—";
        var addedAt = formatDateTime(doc.createdAt);
        var modifiedBy = doc.updatedByName || doc.createdByName || "—";
        var modifiedAt = formatDateTime(doc.updatedAt || doc.createdAt);
        auditInfo.innerHTML =
          "<div><strong>" + escapeHTML(_t("col_added_by") || "أُضيف بواسطة") + ": </strong>" +
          escapeHTML(addedBy) +
          " <span style='opacity:0.75;'>(" + escapeHTML(addedAt) + ")</span></div>" +
          "<div style='margin-top: 6px;'><strong>" + escapeHTML(_t("col_modified_by") || "آخر تعديل بواسطة") + ": </strong>" +
          escapeHTML(modifiedBy) +
          " <span style='opacity:0.75;'>(" + escapeHTML(modifiedAt) + ")</span></div>";
      }
      showModal("editAttachmentModal");
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  async function openDocumentDetail(documentId) {
    var container = el("detailContent");
    state.detailDocumentId = documentId;
    renderLoading(container, _t("loading"));
    el("detailActions").innerHTML = "";
    showModal("detailModal");
    try {
      var data = await api.get("/documents/" + documentId);
      var doc = data.document;
      var deleted = Boolean(doc.deletedAt);
      var isOtherAtt = doc.type === "other_attachments";
      var detailTitlePrefix = window.I18N && window.I18N.getLanguage() === "en"
        ? (isOtherAtt ? "Attachment Details: " : "Document Details ")
        : (isOtherAtt ? "تفاصيل المرفق: " : "تفاصيل المراسلة ");
      var docIdentifier = doc.reference || doc.sequenceNumber || doc.title || "—";
      el("detailTitle").textContent = detailTitlePrefix + (isOtherAtt ? (doc.title || "—") : (doc.reference ? doc.reference : "(" + docIdentifier + ")"));

      var fields;
      if (isOtherAtt) {
        fields = [
          [_t("col_attachment_name") || "اسم المرفق / المستند", doc.title || "—"],
          [_t("field_dept"), doc.department ? doc.department.name : _t("unspecified")],
          [_t("field_created_at"), formatDateTime(doc.createdAt)],
          [_t("col_added_by") || "أُضيف بواسطة", doc.createdByName || "—"],
          [_t("col_modified_date") || "تاريخ آخر تعديل", formatDateTime(doc.updatedAt || doc.createdAt)],
          [_t("col_modified_by") || "آخر تعديل بواسطة", doc.updatedByName || doc.createdByName || "—"]
        ];
      } else {
        fields = [
          [_t("field_ref"), doc.reference || "—"],
          [_t("field_seq"), doc.sequenceNumber || "—"],
          [_t("field_subject"), doc.title || "—"],
          [_t("field_type"), getTypeLabel(doc.type)],
          [_t("field_date"), doc.date ? formatDate(doc.date) : "—"],
          [_t("field_dept"), doc.department ? doc.department.name : _t("unspecified")],
          [_t("field_sender"), doc.sender || "—"],
          [_t("field_recipient"), doc.recipient || "—"],
          [_t("field_notes"), doc.notes || "—"],
          [_t("field_created_by"), doc.createdByName || "—"],
          [_t("field_created_at"), formatDateTime(doc.createdAt)],
          [_t("field_updated_by"), doc.updatedByName || "—"],
          [_t("field_updated_at"), formatDateTime(doc.updatedAt)]
        ];
      }
      if (deleted) {
        fields.push([_t("field_deleted_by"), doc.deletedByName || "—"]);
        fields.push([_t("field_deleted_at"), formatDateTime(doc.deletedAt)]);
      }
      var details = fields
        .map(function (field) {
          return (
            '<div class="detail-item"><span>' +
            escapeHTML(field[0]) +
            "</span><strong>" +
            escapeHTML(field[1]) +
            "</strong></div>"
          );
        })
        .join("");
      var files = doc.files || [];
      var attachments = files.length
        ? files
            .map(function (file) {
              return (
                '<div class="attachment-item"><div class="attachment-meta"><strong>' +
                escapeHTML(file.originalName) +
                "</strong><small>" +
                escapeHTML(formatBytes(file.sizeBytes)) +
                " — " +
                escapeHTML(formatDateTime(file.createdAt)) +
                '</small></div><div class="action-buttons">' +
                attachmentActions(file) +
                "</div></div>"
              );
            })
            .join("")
        : '<div class="empty">' + escapeHTML(_t("no_attachments")) + '</div>';
      container.innerHTML =
        '<div class="detail-grid">' +
        details +
        '</div><h3 class="detail-subtitle">' + escapeHTML(_t("attachments_section")) + '</h3><div class="attachment-list">' +
        attachments +
        "</div>";

      var actions = [];
      if (!deleted && (isAdmin() || hasPermission("share"))) {
        actions.push(
          '<button type="button" class="button secondary-button" id="detailShareButton">' + escapeHTML(_t("share")) + '</button>'
        );
      }
      if (!deleted && hasPermission("edit")) {
        actions.push(
          '<button type="button" class="button" id="detailEditButton">' + escapeHTML(_t("edit")) + '</button>'
        );
      }
      if (isAdmin() && deleted) {
        actions.push(
          '<button type="button" class="button" id="detailRestoreButton">' + escapeHTML(_t("restore")) + '</button>'
        );
      } else if (!deleted && (isAdmin() || hasPermission("delete"))) {
        actions.push(
          '<button type="button" class="button danger-button" id="detailDeleteButton">' + escapeHTML(_t("delete")) + '</button>'
        );
      }
      actions.push(
        '<button type="button" class="button secondary-button" id="detailCloseButton">' + escapeHTML(_t("close")) + '</button>'
      );
      el("detailActions").innerHTML = actions.join("");

      var shareButton = el("detailShareButton");
      if (shareButton) {
        shareButton.addEventListener("click", function () {
          openShareModal(documentId);
        });
      }
      var editButton = el("detailEditButton");
      if (editButton) {
        editButton.addEventListener("click", function () {
          hideModal("detailModal");
          if (doc.type === "other_attachments") {
            openEditAttachmentModal(documentId);
          } else {
            openDocumentForm("edit", documentId);
          }
        });
      }
      var deleteButton = el("detailDeleteButton");
      if (deleteButton) {
        deleteButton.addEventListener("click", async function () {
          var performed = await performDocumentAction("delete", documentId);
          if (performed) hideModal("detailModal");
        });
      }
      var restoreButton = el("detailRestoreButton");
      if (restoreButton) {
        restoreButton.addEventListener("click", async function () {
          await performDocumentAction("restore", documentId);
          hideModal("detailModal");
        });
      }
      el("detailCloseButton").addEventListener("click", function () {
        hideModal("detailModal");
      });
    } catch (error) {
      renderError(container, errorMessage(error));
    }
  }

  async function performDocumentAction(action, documentId) {
    try {
      if (action === "delete") {
        var isAttachmentView = state.currentPage === "other_attachments";
        var confirmMsg = isAttachmentView
          ? "هل تريد بالتأكيد حذف هذا المرفق؟ تُنقل المعاملة إلى المحذوفات ويمكن للمدير استعادتها لاحقاً."
          : "هل تريد حذف هذه المعاملة؟ تُنقل إلى المحذوفات ويمكن للمدير استعادتها لاحقاً.";
        var confirmed = await confirmDialog(confirmMsg);
        if (!confirmed) return false;
        await api.del("/documents/" + documentId);
        toast(isAttachmentView ? "تم حذف المرفق بنجاح." : "تم نقل المعاملة إلى المحذوفات.");
      }
      if (action === "restore") {
        await api.post("/documents/" + documentId + "/restore");
        toast("تمت استعادة المعاملة.");
      }
      refreshDocumentsAndStats();
      return true;
    } catch (error) {
      toast(errorMessage(error), "error");
      return false;
    }
  }

  function refreshDocumentsAndStats() {
    loadDashboardStats();
    var page = state.currentPage;
    if (page === "dashboard" || page === "incoming" || page === "outgoing" || page === "other" || page === "other_attachments" || page === "archive") {
      loadDocumentsView(page);
    }
  }

  /* ========================================================================
     المستخدمون (للمدير)
     ======================================================================== */
  async function loadUsers() {
    var view = state.views.users;
    var table = el("usersTable");
    renderLoading(table, "جارٍ تحميل المستخدمين…");
    try {
      var data = await api.get("/users", {
        q: view.q,
        role: view.role,
        isActive: view.isActive === "" ? undefined : view.isActive,
        page: view.page,
        pageSize: view.pageSize
      });
      view.total = data.total;
      view.page = data.page;
      renderUsersTable(table, data.items);
      renderPager(el("usersPager"), view, function (delta) {
        view.page = Math.max(1, view.page + delta);
        loadUsers();
      });
    } catch (error) {
      renderError(table, errorMessage(error));
    }
  }

  function renderUsersTable(container, items) {
    if (!items.length) {
      renderEmpty(container, _t("no_users"));
      return;
    }
    var rows = items
      .map(function (user) {
        var isSelf = state.user && user.id === state.user.id;
        var deleteText = window.I18N && window.I18N.getLanguage() === "en" ? "Delete" : "حذف";
        var toggleText = user.isActive
          ? (window.I18N && window.I18N.getLanguage() === "en" ? "Disable" : "تعطيل")
          : (window.I18N && window.I18N.getLanguage() === "en" ? "Enable" : "تفعيل");
        var resetPwText = window.I18N && window.I18N.getLanguage() === "en" ? "Reset Password" : "إعادة تعيين كلمة المرور";
        var actions = [
          '<button type="button" class="small-button" data-user-action="edit" data-id="' +
            escapeHTML(user.id) +
            '">' + escapeHTML(_t("edit")) + '</button>',
          '<button type="button" class="small-button" data-user-action="password" data-id="' +
            escapeHTML(user.id) +
            '">' + escapeHTML(resetPwText) + '</button>',
          '<button type="button" class="small-button" data-user-action="toggle" data-id="' +
            escapeHTML(user.id) +
            '"' +
            (isSelf ? " disabled" : "") +
            ">" +
            escapeHTML(toggleText) +
            "</button>",
          '<button type="button" class="small-button delete-button" data-user-action="delete" data-id="' +
            escapeHTML(user.id) +
            '"' +
            (isSelf ? " disabled" : "") +
            ">" +
            escapeHTML(deleteText) +
            "</button>"
        ];
        var employeeNumber = user.employeeNumber
          ? escapeHTML(user.employeeNumber)
          : '<span class="muted">' + escapeHTML(_t("unspecified")) + '</span>';
        var department = user.departmentId
          ? escapeHTML(user.departmentName || (window.I18N && window.I18N.getLanguage() === "en" ? "Deleted Department" : "إدارة محذوفة")) +
            (user.departmentActive === false
              ? ' <span class="badge badge-inactive">' + escapeHTML(_t("disabled")) + '</span>'
              : "")
          : '<span class="muted">' + escapeHTML(_t("unspecified")) + '</span>';
        var permsHtml = "";
        if (user.role === "admin") {
          permsHtml = '<span class="permission-badge badge-view" style="font-weight:700;">' + escapeHTML(_t("perm_all")) + '</span>';
        } else {
          var userPerms = Array.isArray(user.permissions) ? user.permissions : ["view", "create", "edit"];
          var badges = [];
          if (userPerms.includes("view")) badges.push('<span class="permission-badge badge-view">' + escapeHTML(_t("perm_view")) + '</span>');
          if (userPerms.includes("create")) badges.push('<span class="permission-badge badge-create">' + escapeHTML(_t("perm_create")) + '</span>');
          if (userPerms.includes("edit")) badges.push('<span class="permission-badge badge-edit">' + escapeHTML(_t("perm_edit")) + '</span>');
          if (userPerms.includes("delete")) badges.push('<span class="permission-badge badge-delete">' + escapeHTML(_t("perm_delete")) + '</span>');
          if (userPerms.includes("share")) badges.push('<span class="permission-badge badge-share">' + escapeHTML(_t("perm_share")) + '</span>');
          if (userPerms.includes("attach_view")) badges.push('<span class="permission-badge badge-attach_view">' + escapeHTML(_t("perm_attach_view")) + '</span>');
          if (userPerms.includes("attach_upload")) badges.push('<span class="permission-badge badge-attach_upload">' + escapeHTML(_t("perm_attach_upload")) + '</span>');
          if (userPerms.includes("attach_delete")) badges.push('<span class="permission-badge badge-attach_delete">' + escapeHTML(_t("perm_attach_delete")) + '</span>');
          permsHtml = badges.length ? badges.join(" ") : '<span class="muted">—</span>';
        }
        return (
          "<tr><td>" +
          escapeHTML(user.username) +
          "</td><td>" +
          employeeNumber +
          "</td><td>" +
          escapeHTML(user.displayName) +
          "</td><td>" +
          department +
          '</td><td><span class="badge badge-' +
          (user.role === "admin" ? "admin" : "employee") +
          '">' +
          escapeHTML(getRoleLabel(user.role)) +
          "</span></td><td>" +
          permsHtml +
          "</td><td>" +
          '<span class="badge badge-' +
          (user.isActive ? "active" : "inactive") +
          '">' +
          escapeHTML(user.isActive ? _t("active") : _t("disabled")) +
          "</span></td><td>" +
          escapeHTML(formatDateTime(user.createdAt)) +
          "</td><td>" +
          escapeHTML(user.lastLoginAt ? formatDateTime(user.lastLoginAt) : "—") +
          '</td><td><div class="action-buttons">' +
          actions.join("") +
          "</div></td></tr>"
        );
      })
      .join("");
    var userColumns = [
      _t("login_username_label"),
      _t("col_user_emp_num"),
      _t("user_fullname_label"),
      _t("doc_dept_label"),
      _t("col_user_role"),
      _t("col_user_permissions"),
      _t("status"),
      _t("col_dept_created"),
      _t("col_user_last_login"),
      _t("actions")
    ];
    container.innerHTML =
      '<div class="table-wrap"><table><thead><tr>' +
      userColumns.map(function (c) { return "<th>" + escapeHTML(c) + "</th>"; }).join("") +
      "</tr></thead><tbody>" +
      rows +
      "</tbody></table></div>";
  }

  function fillUserDepartmentOptions(user) {
    var select = el("userDepartment");
    select.innerHTML = '<option value="">' + escapeHTML(_t("unspecified")) + '</option>';
    var departments = state.userFormDepartments || [];
    departments.forEach(function (department) {
      var option = document.createElement("option");
      option.value = department.id;
      option.textContent =
        department.name + (department.isActive ? "" : " (" + _t("disabled") + ")");
      select.appendChild(option);
    });
    if (user && user.departmentId && !departments.some(function (department) {
      return department.id === user.departmentId;
    })) {
      var stale = document.createElement("option");
      stale.value = user.departmentId;
      stale.textContent = user.departmentName || (window.I18N && window.I18N.getLanguage() === "en" ? "Unavailable Department" : "إدارة غير متاحة");
      select.appendChild(stale);
    }
    select.value = user && user.departmentId ? user.departmentId : "";
    updateUserDepartmentField();
  }

  function updateUserDepartmentField() {
    var roleEl = el("userRole");
    var deptEl = el("userDepartment");
    if (!roleEl || !deptEl) return;
    var employee = roleEl.value === "employee";
    deptEl.required = employee;
    var reqSpan = el("userDepartmentRequired");
    if (reqSpan) reqSpan.hidden = !employee;
    var hint = el("userDepartmentHint");
    if (hint) {
      hint.textContent = employee
        ? (window.I18N && window.I18N.getLanguage() === "en"
            ? "An employee requires an active department to access records."
            : "إدارة نشطة إلزامية للموظف. لا يمكن حفظ الحساب كموظف دون تعيين إدارة.")
        : (window.I18N && window.I18N.getLanguage() === "en"
            ? "Admins see all departments and can be left without an assigned department."
            : "المدير يرى جميع الإدارات، ويمكن تركه بلا إدارة.");
    }
    var blank = deptEl.querySelector('option[value=""]');
    if (blank) blank.disabled = employee;
    updateUserPermissionsCheckboxes();
  }

  function updateUserPermissionsCheckboxes() {
    var roleEl = el("userRole");
    if (!roleEl) return;
    var isAdminRole = roleEl.value === "admin";
    var checkboxes = [
      el("permView"),
      el("permCreate"),
      el("permEdit"),
      el("permDelete"),
      el("permAttachView"),
      el("permAttachUpload"),
      el("permAttachDelete")
    ];
    checkboxes.forEach(function (cb) {
      if (cb) {
        if (isAdminRole) {
          cb.checked = true;
          cb.disabled = true;
        } else {
          cb.disabled = false;
        }
      }
    });
    var hint = el("userPermissionsHint");
    if (hint) {
      hint.textContent = isAdminRole
        ? _t("user_permissions_hint")
        : (window.I18N && window.I18N.getLanguage() === "en"
            ? "Check permissions granted to this employee."
            : "حدد الصلاحيات الممنوحة لهذا الموظف.");
    }
  }

  async function openUserModal(mode, user) {
    state.editingUserId = mode === "edit" ? user.id : null;
    el("userModalTitle").textContent =
      mode === "edit" ? (window.I18N && window.I18N.getLanguage() === "en" ? "Edit User \"" + user.username + "\"" : "تعديل المستخدم «" + user.username + "»") : _t("user_modal_add");
    el("userUsernameField").style.display = mode === "edit" ? "none" : "";
    el("userPasswordField").style.display = mode === "edit" ? "none" : "";
    el("userUsername").required = mode !== "edit";
    el("userPassword").required = mode !== "edit";
    el("userUsername").value = mode === "edit" ? user.username : "";
    el("userEmployeeNumber").value =
      mode === "edit" && user.employeeNumber ? user.employeeNumber : "";
    el("userDisplayName").value = mode === "edit" ? user.displayName : "";
    el("userRole").value = mode === "edit" ? user.role : "employee";
    el("userPassword").value = "";
    showFormError("userFormError", "");

    var userPerms = user && Array.isArray(user.permissions)
      ? user.permissions
      : ["view", "create", "edit", "share", "attach_view", "attach_upload"];
    if (el("permView")) el("permView").checked = userPerms.includes("view");
    if (el("permCreate")) el("permCreate").checked = userPerms.includes("create");
    if (el("permEdit")) el("permEdit").checked = userPerms.includes("edit");
    if (el("permDelete")) el("permDelete").checked = userPerms.includes("delete");
    if (el("permShare")) el("permShare").checked = userPerms.includes("share");
    if (el("permAttachView")) el("permAttachView").checked = userPerms.includes("attach_view");
    if (el("permAttachUpload")) el("permAttachUpload").checked = userPerms.includes("attach_upload");
    if (el("permAttachDelete")) el("permAttachDelete").checked = userPerms.includes("attach_delete");

    try {
      var data = await api.get("/departments", { includeInactive: true });
      state.userFormDepartments = data.items;
    } catch (error) {
      state.userFormDepartments = state.departments.slice();
    }
    fillUserDepartmentOptions(mode === "edit" ? user : null);
    showModal("userModal");
    el("userDisplayName").focus();
  }

  async function submitUserForm(event) {
    event.preventDefault();
    var button = el("saveUserButton");
    showFormError("userFormError", "");
    setBusy(button, true, "جارٍ الحفظ…");
    try {
      var employeeNumber = el("userEmployeeNumber").value.trim();
      var role = el("userRole").value;
      var departmentId = el("userDepartment").value || null;
      if (role === "employee" && !departmentId) {
        showFormError("userFormError", window.I18N && window.I18N.getLanguage() === "en" ? "Active department is required for employee." : "يجب اختيار إدارة نشطة للموظف.");
        return;
      }
      var permissions = [];
      if (role === "admin") {
        permissions = ["view", "create", "edit", "delete", "share", "attach_view", "attach_upload", "attach_delete"];
      } else {
        if (el("permView") && el("permView").checked) permissions.push("view");
        if (el("permCreate") && el("permCreate").checked) permissions.push("create");
        if (el("permEdit") && el("permEdit").checked) permissions.push("edit");
        if (el("permDelete") && el("permDelete").checked) permissions.push("delete");
        if (el("permShare") && el("permShare").checked) permissions.push("share");
        if (el("permAttachView") && el("permAttachView").checked) permissions.push("attach_view");
        if (el("permAttachUpload") && el("permAttachUpload").checked) permissions.push("attach_upload");
        if (el("permAttachDelete") && el("permAttachDelete").checked) permissions.push("attach_delete");
        if (permissions.length === 0) {
          showFormError(
            "userFormError",
            window.I18N && window.I18N.getLanguage() === "en"
              ? "Select at least one permission for the employee."
              : "يجب اختيار صلاحية واحدة على الأقل للموظف."
          );
          return;
        }
      }
      if (state.editingUserId) {
        await api.patch("/users/" + state.editingUserId, {
          displayName: el("userDisplayName").value.trim(),
          employeeNumber: employeeNumber,
          departmentId: departmentId,
          role: role,
          permissions: permissions
        });
        toast(window.I18N && window.I18N.getLanguage() === "en" ? "User updated successfully." : "تم تحديث بيانات المستخدم.");
      } else {
        await api.post("/users", {
          username: el("userUsername").value.trim(),
          displayName: el("userDisplayName").value.trim(),
          employeeNumber: employeeNumber,
          departmentId: departmentId,
          role: role,
          permissions: permissions,
          password: el("userPassword").value
        });
        toast(window.I18N && window.I18N.getLanguage() === "en" ? "User created successfully." : "تم إنشاء المستخدم.");
      }
      hideModal("userModal");
      loadUsers();
    } catch (error) {
      showFormError("userFormError", errorMessage(error));
    } finally {
      setBusy(button, false);
    }
  }

  async function handleUserAction(button) {
    var id = button.dataset.id;
    var action = button.dataset.userAction;
    var user = null;
    try {
      var data = await api.get("/users", { page: 1, pageSize: 100 });
      user = (data.items || []).find(function (item) {
        return item.id === id;
      });
    } catch (error) {
      toast(errorMessage(error), "error");
      return;
    }
    if (!user) return;

    if (action === "edit") {
      openUserModal("edit", user);
      return;
    }

    if (action === "password") {
      var password = await askText({
        title: "إعادة تعيين كلمة المرور",
        label: "كلمة المرور الجديدة للمستخدم «" + user.username + "»",
        type: "password",
        minLength: 8,
        maxLength: 200
      });
      if (!password) return;
      if (password.length < 8) {
        toast("كلمة المرور يجب ألا تقل عن 8 محارف.", "error");
        return;
      }
      try {
        await api.post("/users/" + id + "/password", { password: password });
        toast("تم إعادة تعيين كلمة المرور وإنهاء جلسات المستخدم.");
      } catch (error) {
        toast(errorMessage(error), "error");
      }
      return;
    }

    if (action === "delete") {
      var confirmMsg = _t("user_delete_confirm", { username: user.username });
      var confirmed = await confirmDialog(confirmMsg);
      if (!confirmed) return;
      try {
        await api.del("/users/" + id);
        toast(_t("user_deleted_success"));
        loadUsers();
      } catch (error) {
        toast(errorMessage(error), "error");
      }
      return;
    }

    if (action === "toggle") {
      var confirmed = await confirmDialog(
        user.isActive
          ? "هل تريد تعطيل حساب «" + user.username + "»؟ ستنتهي جميع جلساته."
          : "هل تريد تفعيل حساب «" + user.username + "»؟"
      );
      if (!confirmed) return;
      try {
        await api.patch("/users/" + id, { isActive: !user.isActive });
        toast(user.isActive ? "تم تعطيل الحساب." : "تم تفعيل الحساب.");
        loadUsers();
      } catch (error) {
        toast(errorMessage(error), "error");
      }
    }
  }

  /* ========================================================================
     سجل التدقيق (للمدير)
     ======================================================================== */
  async function loadAudit() {
    var view = state.views.audit;
    var table = el("auditTable");
    renderLoading(table, "جارٍ تحميل السجل…");
    try {
      var data = await api.get("/audit", {
        action: view.action,
        entityType: view.entityType,
        dateFrom: view.dateFrom,
        dateTo: view.dateTo,
        page: view.page,
        pageSize: view.pageSize
      });
      view.total = data.total;
      view.page = data.page;
      renderAuditTable(table, data.items);
      renderPager(el("auditPager"), view, function (delta) {
        view.page = Math.max(1, view.page + delta);
        loadAudit();
      });
    } catch (error) {
      renderError(table, errorMessage(error));
    }
  }

  function formatAuditDescription(entry) {
    var act = entry.action || "";
    var d = entry.details || {};

    if (act === "auth.login.success") return "تسجيل دخول ناجح إلى النظام";
    if (act === "auth.login.failed") return "محاولة تسجيل دخول فاشلة" + (d.identifier ? " باسم (" + d.identifier + ")" : "");
    if (act === "auth.logout") return "تسجيل الخروج من النظام";
    if (act === "auth.password.changed") return "تغيير كلمة المرور الخاصة بالحساب";

    if (act === "document.created") {
      var ref = d.reference ? "بالرقم الإشاري: " + d.reference : "";
      var title = d.title ? " — " + d.title : "";
      return "تسجيل معاملة جديدة " + ref + title;
    }
    if (act === "document.updated") {
      var ref = d.reference ? " للرقم الإشاري: " + d.reference : "";
      return "تعديل بيانات المعاملة" + ref;
    }
    if (act === "document.deleted") {
      var ref = d.reference ? " للرقم الإشاري: " + d.reference : "";
      return "حذف المعاملة" + ref;
    }
    if (act === "document.restored") {
      var ref = d.reference ? " للرقم الإشاري: " + d.reference : "";
      return "استعادة المعاملة المحذوفة" + ref;
    }

    if (act === "file.uploaded") {
      return "رفع ملف مرفق جديد: " + (d.filename || d.originalName || "ملف");
    }
    if (act === "file.downloaded") {
      return "تنزيل ملف مرفق: " + (d.filename || "ملف");
    }
    if (act === "file.viewed") {
      return "عرض أو معاينة ملف مرفق: " + (d.filename || "ملف");
    }
    if (act === "file.deleted") {
      return "حذف ملف مرفق: " + (d.filename || "ملف");
    }

    if (act === "user.created") {
      return "إنشاء حساب مستخدم جديد: " + (d.username || d.name || "");
    }
    if (act === "user.updated") {
      return "تعديل بيانات المستخدم: " + (d.username || d.name || "");
    }
    if (act === "user.password_reset") {
      return "إعادة تعيين كلمة مرور المستخدم: " + (d.username || "");
    }
    if (act === "user.deleted") {
      return "حذف حساب المستخدم: " + (d.username || "");
    }

    if (act === "department.created") {
      return "إضافة إدارة أو قسم جديد: " + (d.name || "");
    }
    if (act === "department.updated") {
      return "تعديل إدارة أو قسم: " + (d.name || "");
    }
    if (act === "department.deleted") {
      return "حذف إدارة أو قسم: " + (d.name || "");
    }

    if (act === "setting.updated") {
      if (d.uploadMaxMb) {
        return "تعديل الحد الأقصى لحجم رفع الملفات إلى " + d.uploadMaxMb + " ميجابايت";
      }
      return "تعديل إعدادات النظام";
    }

    if (act === "ticket.created") {
      return "فتح تذكرة دعم فني جديدة: " + (d.title || "");
    }
    if (act === "ticket.status_updated") {
      return "تحديث حالة تذكرة الدعم إلى: " + (d.status || "");
    }
    if (act === "ticket.message_added") {
      return "إضافة رد ومحادثة على تذكرة الدعم";
    }

    var fallback = getActionLabel(act);
    var extra = [];
    if (d.title) extra.push(d.title);
    else if (d.name) extra.push(d.name);
    else if (d.reference) extra.push(d.reference);
    else if (d.filename) extra.push(d.filename);
    if (extra.length) fallback += " (" + extra.join(" - ") + ")";
    return fallback;
  }

  function renderAuditTable(container, items) {
    if (!items.length) {
      renderEmpty(container, _t("no_audit"));
      return;
    }
    var rows = items
      .map(function (entry) {
        var actionText = formatAuditDescription(entry);
        return (
          "<tr>" +
          "<td><strong style='color: var(--text-primary); font-size: 0.95rem;'>" + escapeHTML(actionText) + "</strong></td>" +
          "<td><span style='font-weight: 600;'>" + escapeHTML(entry.actorUsername || "—") + "</span></td>" +
          "<td>" + escapeHTML(formatDateTime(entry.createdAt)) + "</td>" +
          "<td><small dir='ltr' style='color: var(--text-secondary);'>" + escapeHTML(entry.ip || "—") + "</small></td>" +
          "</tr>"
        );
      })
      .join("");
    var auditColumns = [
      _t("col_audit_action"),
      _t("col_audit_user"),
      _t("col_audit_time"),
      _t("col_audit_ip")
    ];
    container.innerHTML =
      '<div class="table-wrap"><table><thead><tr>' +
      auditColumns.map(function (c) { return "<th>" + escapeHTML(c) + "</th>"; }).join("") +
      "</tr></thead><tbody>" +
      rows +
      "</tbody></table></div>";
  }

  /* ========================================================================
     الإعدادات: كلمة المرور وإعدادات رفع الملفات
     ======================================================================== */
  async function submitChangePassword(event) {
    event.preventDefault();
    showFormError("changePasswordError", "");
    var button = event.submitter || event.target.querySelector("button[type=submit]");
    setBusy(button, true, "جارٍ التغيير…");
    try {
      await api.post("/auth/password", {
        currentPassword: el("currentPassword").value,
        newPassword: el("newPassword").value
      });
      el("currentPassword").value = "";
      el("newPassword").value = "";
      toast("تم تغيير كلمة المرور وإنهاء الجلسات الأخرى.");
    } catch (error) {
      showFormError("changePasswordError", errorMessage(error));
    } finally {
      setBusy(button, false);
    }
  }

  async function loadSystemSettings() {
    try {
      var data = await api.get("/settings");
      state.uploadMaxMb = data.uploadMaxMb || 25;
      var sel = el("maxUploadSizeSelect");
      if (sel) sel.value = String(state.uploadMaxMb);
      updateUploadHints();
    } catch (e) {
      /* ignore */
    }
  }

  async function saveSystemSettings() {
    var btn = el("saveUploadSettingsBtn");
    var val = parseInt(el("maxUploadSizeSelect").value, 10);
    setBusy(btn, true, "جارٍ الحفظ…");
    try {
      var res = await api.patch("/settings", { uploadMaxMb: val });
      state.uploadMaxMb = res.uploadMaxMb;
      updateUploadHints();
      toast(_t("upload_size_saved"));
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(btn, false);
    }
  }

  function updateUploadHints() {
    var maxMb = state.uploadMaxMb || 25;
    var hint = el("attachmentHint");
    if (hint) {
      hint.textContent = "اختر ملفاً أو أكثر (الحد الأقصى: " + maxMb + " ميجابايت للملف الواحد).";
    }
  }

  /* ========================================================================
     نظام تذاكر الدعم الفني والمحادثة
     ======================================================================== */
  function getTicketStatusBadge(status) {
    var label = _t("ticket_status_" + status) || status;
    return '<span class="ticket-status-badge status-' + escapeHTML(status) + '">' + escapeHTML(label) + '</span>';
  }

  async function loadSupportTickets() {
    var container = el("ticketsListContainer");
    if (!container) return;
    renderLoading(container, "جارٍ تحميل تذاكر الدعم الفني…");
    try {
      var data = await api.get("/tickets");
      state.tickets = data.items || [];
      renderSupportTicketsTable(container, state.tickets);
    } catch (err) {
      renderError(container, errorMessage(err));
    }
  }

  function renderSupportTicketsTable(container, items) {
    if (!items.length) {
      renderEmpty(container, _t("no_tickets"));
      return;
    }
    var admin = isAdmin();
    var rows = items
      .map(function (t, idx) {
        var actions = [];
        actions.push(
          '<button type="button" class="button small-button view-ticket-btn" data-id="' + escapeHTML(t.id) + '">' +
          escapeHTML(_t("view_chat")) +
          '</button>'
        );
        if (admin) {
          actions.push(
            '<button type="button" class="button small-button edit-ticket-btn" data-id="' + escapeHTML(t.id) + '" title="' + escapeHTML(_t("edit")) + '">' +
            '✏️ ' + escapeHTML(_t("edit")) +
            '</button>'
          );
          actions.push(
            '<button type="button" class="button small-button delete-button delete-ticket-btn" data-id="' + escapeHTML(t.id) + '" title="' + escapeHTML(_t("delete")) + '">' +
            '🗑️ ' + escapeHTML(_t("delete")) +
            '</button>'
          );
        }
        return (
          "<tr>" +
          "<td>#" + (idx + 1) + "</td>" +
          "<td><strong>" + escapeHTML(t.title) + "</strong></td>" +
          "<td>" + escapeHTML(t.creatorName || t.username || "—") + "</td>" +
          "<td>" + escapeHTML(t.departmentName || "—") + "</td>" +
          "<td>" + getTicketStatusBadge(t.status) + "</td>" +
          "<td>" + escapeHTML(formatDateTime(t.createdAt)) + "</td>" +
          "<td>" +
          '<div class="table-actions">' + actions.join(" ") + '</div>' +
          "</td>" +
          "</tr>"
        );
      })
      .join("");

    var cols = [
      _t("col_ticket_id"),
      _t("col_ticket_title"),
      _t("col_ticket_user"),
      _t("col_ticket_dept"),
      _t("col_ticket_status"),
      _t("col_ticket_date"),
      _t("col_ticket_actions")
    ];

    container.innerHTML =
      '<div class="table-wrap"><table><thead><tr>' +
      cols.map(function (c) { return "<th>" + escapeHTML(c) + "</th>"; }).join("") +
      "</tr></thead><tbody>" +
      rows +
      "</tbody></table></div>";

    container.querySelectorAll(".view-ticket-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.dataset.id;
        if (id) openTicketChat(id);
      });
    });

    container.querySelectorAll(".edit-ticket-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.dataset.id;
        var ticket = items.find(function (it) { return it.id === id; });
        if (ticket) openEditTicketModal(ticket);
      });
    });

    container.querySelectorAll(".delete-ticket-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.dataset.id;
        if (id) promptDeleteTicket(id);
      });
    });
  }

  function openEditTicketModal(ticket) {
    if (!isAdmin()) return;
    el("editTicketId").value = ticket.id;
    el("editTicketTitle").value = ticket.title || "";
    el("editTicketStatus").value = ticket.status || "open";
    showFormError("editTicketError", "");
    showModal("editTicketModal");
  }

  async function submitEditTicket(event) {
    event.preventDefault();
    if (!isAdmin()) return;
    showFormError("editTicketError", "");
    var id = el("editTicketId").value;
    var title = el("editTicketTitle").value.trim();
    var status = el("editTicketStatus").value;
    if (!id || !title) return;
    var btn = el("saveEditTicketBtn");
    setBusy(btn, true, "جارٍ الحفظ…");
    try {
      await api.patch("/tickets/" + id, { title: title, status: status });
      hideModal("editTicketModal");
      toast(_t("ticket_updated_success"));
      loadSupportTickets();
      if (state.activeTicketId === id) {
        openTicketChat(id);
      }
    } catch (err) {
      showFormError("editTicketError", errorMessage(err));
    } finally {
      setBusy(btn, false);
    }
  }

  function promptDeleteTicket(ticketId, closeChatOnSuccess) {
    if (!isAdmin()) return;
    showConfirm(_t("delete_ticket_confirm"), async function () {
      try {
        await api.delete("/tickets/" + ticketId);
        toast(_t("ticket_deleted_success"));
        if (closeChatOnSuccess || state.activeTicketId === ticketId) {
          hideModal("ticketChatModal");
          state.activeTicketId = null;
        }
        loadSupportTickets();
      } catch (err) {
        toast(errorMessage(err), "error");
      }
    });
  }

  async function openTicketChat(ticketId) {
    try {
      var data = await api.get("/tickets/" + ticketId);
      var ticket = data.ticket || data;
      var messages = data.messages || [];
      state.activeTicketId = ticketId;
      el("ticketChatTitle").textContent = "🎫 " + (ticket.title || "");
      el("ticketChatStatusBadge").className = "ticket-status-badge status-" + ticket.status;
      el("ticketChatStatusBadge").textContent = _t("ticket_status_" + ticket.status) || ticket.status;

      var adminControl = el("ticketAdminStatusControl");
      if (adminControl) {
        adminControl.classList.toggle("is-hidden", !isAdmin());
        if (isAdmin()) {
          el("ticketStatusSelect").value = ticket.status;
        }
      }

      var chatEditBtn = el("chatEditTicketBtn");
      if (chatEditBtn) {
        chatEditBtn.classList.toggle("is-hidden", !isAdmin());
        chatEditBtn.onclick = function () {
          openEditTicketModal(ticket);
        };
      }

      var chatDeleteBtn = el("chatDeleteTicketBtn");
      if (chatDeleteBtn) {
        chatDeleteBtn.classList.toggle("is-hidden", !isAdmin());
        chatDeleteBtn.onclick = function () {
          promptDeleteTicket(ticket.id, true);
        };
      }

      var meta = el("ticketMetaInfo");
      if (meta) {
        meta.innerHTML =
          "<span>بواسطة: <strong>" + escapeHTML(ticket.creatorName || ticket.username || "—") + "</strong> (" + escapeHTML(ticket.departmentName || "غير محدد") + ")</span>" +
          " &nbsp;|&nbsp; <span>تاريخ الفتح: " + escapeHTML(formatDateTime(ticket.createdAt)) + "</span>";
      }

      renderTicketMessages(messages);
      showModal("ticketChatModal");
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  function renderTicketMessages(messages) {
    var box = el("ticketMessagesContainer");
    if (!box) return;
    if (!messages.length) {
      box.innerHTML = '<div style="text-align: center; color: var(--text-secondary); margin: auto;">لا توجد رسائل بعد.</div>';
      return;
    }
    var currentUserId = state.user ? state.user.id : "";
    box.innerHTML = messages
      .map(function (m) {
        var isMine = m.senderId === currentUserId;
        var senderType = m.senderRole === "admin" ? "🛡️ الدعم الفني" : "👤 " + (m.senderUsername || "المستخدم");
        return (
          '<div class="chat-bubble-row ' + (isMine ? "mine" : "theirs") + '">' +
          '<div class="chat-bubble-meta">' +
          '<span class="chat-sender-badge">' + escapeHTML(senderType) + '</span>' +
          '<span>' + escapeHTML(formatDateTime(m.createdAt)) + '</span>' +
          '</div>' +
          '<div class="chat-bubble">' + escapeHTML(m.message) + '</div>' +
          '</div>'
        );
      })
      .join("");
    box.scrollTop = box.scrollHeight;
  }

  async function submitTicketReply(event) {
    event.preventDefault();
    if (!state.activeTicketId) return;
    var textarea = el("ticketReplyMessage");
    var msg = (textarea.value || "").trim();
    if (!msg) return;
    var btn = el("sendTicketReplyBtn");
    setBusy(btn, true, "جارٍ الإرسال…");
    try {
      await api.post("/tickets/" + state.activeTicketId + "/messages", { message: msg });
      textarea.value = "";
      toast(_t("ticket_reply_success"));
      var updated = await api.get("/tickets/" + state.activeTicketId);
      renderTicketMessages(updated.messages || []);
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(btn, false);
    }
  }

  async function updateTicketStatus(newStatus) {
    if (!state.activeTicketId || !isAdmin()) return;
    try {
      await api.patch("/tickets/" + state.activeTicketId + "/status", { status: newStatus });
      el("ticketChatStatusBadge").className = "ticket-status-badge status-" + newStatus;
      el("ticketChatStatusBadge").textContent = _t("ticket_status_" + newStatus) || newStatus;
      toast(_t("ticket_status_changed"));
      loadSupportTickets();
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  async function submitCreateTicket(event) {
    event.preventDefault();
    showFormError("createTicketError", "");
    var title = el("newTicketTitle").value.trim();
    var message = el("newTicketMessage").value.trim();
    if (!title || !message) return;
    var btn = el("submitCreateTicketBtn");
    setBusy(btn, true, "جارٍ الإرسال…");
    try {
      await api.post("/tickets", { title: title, message: message });
      el("newTicketTitle").value = "";
      el("newTicketMessage").value = "";
      hideModal("createTicketModal");
      toast(_t("ticket_created_success"));
      loadSupportTickets();
    } catch (err) {
      showFormError("createTicketError", errorMessage(err));
    } finally {
      setBusy(btn, false);
    }
  }

  /* ========================================================================
     التحديث التلقائي للنظام عند نشر إصدار جديد
     ======================================================================== */
  async function checkForUpdates() {
    try {
      var res = await api.get("/version");
      if (res && res.version && res.version !== CURRENT_APP_VERSION) {
        notifyUpdateAvailable(res.version);
      }
    } catch (e) {
      /* ignore */
    }
  }

  function notifyUpdateAvailable(newVer) {
    if (el("versionUpdateBanner")) return;
    var banner = document.createElement("div");
    banner.id = "versionUpdateBanner";
    banner.className = "version-banner";
    banner.innerHTML =
      '<span>⚡ ' + escapeHTML(_t("new_version_available")) + ' (' + escapeHTML(newVer) + ')</span>' +
      '<button type="button" class="button small-button" id="versionReloadBtn" style="padding: 4px 12px; font-size: 0.85rem;">' +
      escapeHTML(_t("reload_now")) +
      '</button>';
    document.body.appendChild(banner);
    var reloadBtn = el("versionReloadBtn");
    if (reloadBtn) {
      reloadBtn.addEventListener("click", function () {
        window.location.reload(true);
      });
    }
    var activeEl = document.activeElement;
    var isTyping = activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA" || activeEl.isContentEditable);
    var openModal = document.querySelector(".modal.active, .modal.is-open, .modal[style*='display: flex']");
    if (!isTyping && !openModal) {
      setTimeout(function () {
        window.location.reload(true);
      }, 4000);
    }
  }

  function loadSettingsPage() {
    var departmentInfo = el("settingsDepartmentInfo");
    if (state.user && state.user.role === "employee") {
      departmentInfo.textContent = state.user.departmentId
        ? _t("settings_dept_info") +
          currentDepartmentName() +
          (state.user.departmentActive === false ? " (" + _t("disabled") + ")" : " (" + _t("active") + ")")
        : _t("settings_dept_info") + _t("unspecified");
    } else {
      departmentInfo.textContent = _t("settings_dept_info") + _t("role_admin");
    }
    if (isAdmin()) {
      loadSystemSettings();
      loadSettingsFileTypes();
    }
  }

  /* ========================================================================
     إدارة أنواع وصيغ الملفات المسموحة (للمدير)
     ======================================================================== */
  var COMMON_MIMES = {
    zip: { mime: "application/zip", cat: "archive", ar: "أرشيف مضغوط ZIP", en: "ZIP Archive" },
    rar: { mime: "application/vnd.rar", cat: "archive", ar: "أرشيف مضغوط RAR", en: "RAR Archive" },
    "7z": { mime: "application/x-7z-compressed", cat: "archive", ar: "أرشيف مضغوط 7-Zip", en: "7-Zip Archive" },
    tar: { mime: "application/x-tar", cat: "archive", ar: "أرشيف TAR", en: "TAR Archive" },
    gz: { mime: "application/gzip", cat: "archive", ar: "أرشيف مضغوط GZip", en: "GZip Archive" },
    mp4: { mime: "video/mp4", cat: "other", ar: "فيديو MP4", en: "MP4 Video" },
    mp3: { mime: "audio/mpeg", cat: "other", ar: "صوت MP3", en: "MP3 Audio" },
    wav: { mime: "audio/wav", cat: "other", ar: "صوت WAV", en: "WAV Audio" },
    dwg: { mime: "image/vnd.dwg", cat: "image", ar: "رسم هندسي DWG", en: "AutoCAD Drawing" },
    dxf: { mime: "image/vnd.dxf", cat: "image", ar: "رسم هندسي DXF", en: "DXF Drawing" },
    heic: { mime: "image/heic", cat: "image", ar: "صورة عالية الكفاءة HEIC", en: "HEIC Image" },
    psd: { mime: "image/vnd.adobe.photoshop", cat: "image", ar: "ملف فوتوشوب PSD", en: "Photoshop Document" },
    ai: { mime: "application/postscript", cat: "image", ar: "ملف إليستريتور AI", en: "Adobe Illustrator" },
    epub: { mime: "application/epub+zip", cat: "document", ar: "كتاب إلكتروني EPUB", en: "EPUB eBook" },
    json: { mime: "application/json", cat: "data", ar: "ملف بيانات JSON", en: "JSON Data File" },
    xml: { mime: "application/xml", cat: "data", ar: "ملف بيانات XML", en: "XML Data File" }
  };

  async function loadActiveFileTypes() {
    try {
      var data = await api.get("/file-types");
      state.activeExtensions = data.extensions || [];
      var acceptStr = data.acceptString || "";
      var attInput = el("attachmentInput");
      if (attInput) attInput.accept = acceptStr;
    } catch (e) {
      /* لا يعيق العمل إن لم يكن المستخدم مسجلاً بعد */
    }
  }

  async function loadSettingsFileTypes() {
    if (!isAdmin()) return;
    var container = el("fileTypesTable");
    if (!container) return;
    try {
      var data = await api.get("/settings/file-types");
      state.fileTypes = data.items || [];
      renderFileTypesTable();
    } catch (error) {
      renderError(container, errorMessage(error));
    }
  }

  function getCategoryLabel(category) {
    var key = "cat_" + category;
    return _t(key) !== key ? _t(key) : category;
  }

  function getCategoryIcon(category) {
    switch (category) {
      case "document": return "📄";
      case "image": return "🖼️";
      case "spreadsheet": return "📊";
      case "presentation": return "📽️";
      case "archive": return "🗜️";
      case "data": return "💾";
      default: return "📁";
    }
  }

  function renderFileTypesTable() {
    var container = el("fileTypesTable");
    if (!container) return;
    var items = state.fileTypes || [];
    var q = (state.fileTypesFilter.q || "").toLowerCase().trim();
    var cat = state.fileTypesFilter.category || "";

    var filtered = items.filter(function (item) {
      if (cat && item.category !== cat) return false;
      if (q) {
        var matchExt = item.extension.toLowerCase().includes(q);
        var matchMime = item.mimeType.toLowerCase().includes(q);
        var matchAr = (item.labelAr || "").toLowerCase().includes(q);
        var matchEn = (item.labelEn || "").toLowerCase().includes(q);
        return matchExt || matchMime || matchAr || matchEn;
      }
      return true;
    });

    if (!filtered.length) {
      renderEmpty(container, _t("no_results_found"));
      return;
    }

    var isEn = window.I18N && window.I18N.getLanguage() === "en";
    var headers = [
      _t("col_extension"),
      _t("col_description"),
      _t("col_category"),
      _t("col_mime"),
      _t("col_status"),
      _t("col_actions")
    ];

    var rows = filtered
      .map(function (item) {
        var desc = isEn ? (item.labelEn || item.labelAr) : (item.labelAr || item.labelEn);
        var toggleLabel = item.isEnabled
          ? (isEn ? "Disable" : "تعطيل")
          : (isEn ? "Enable" : "تفعيل");
        var deleteLabel = isEn ? "Delete" : "حذف";
        var statusLabel = item.isEnabled ? _t("active") : _t("disabled");
        var statusBadgeClass = item.isEnabled ? "badge-active" : "badge-inactive";

        var actions = [
          '<button type="button" class="small-button" data-file-type-action="toggle" data-ext="' +
            escapeHTML(item.extension) +
            '">' +
            escapeHTML(toggleLabel) +
            "</button>",
          '<button type="button" class="small-button delete-button" data-file-type-action="delete" data-ext="' +
            escapeHTML(item.extension) +
            '">' +
            escapeHTML(deleteLabel) +
            "</button>"
        ];

        return (
          "<tr>" +
          '<td><span class="ext-badge">.' + escapeHTML(item.extension) + "</span></td>" +
          "<td>" + escapeHTML(desc) + "</td>" +
          '<td><span class="cat-badge">' + getCategoryIcon(item.category) + " " + escapeHTML(getCategoryLabel(item.category)) + "</span></td>" +
          "<td><code>" + escapeHTML(item.mimeType) + "</code></td>" +
          '<td><span class="badge ' + statusBadgeClass + '">' + escapeHTML(statusLabel) + "</span></td>" +
          '<td><div class="action-buttons">' + actions.join("") + "</div></td>" +
          "</tr>"
        );
      })
      .join("");

    container.innerHTML =
      '<div class="table-wrap"><table><thead><tr>' +
      headers.map(function (h) { return "<th>" + escapeHTML(h) + "</th>"; }).join("") +
      "</tr></thead><tbody>" +
      rows +
      "</tbody></table></div>";
  }

  async function handleFileTypeAction(button) {
    var ext = button.dataset.ext;
    var action = button.dataset.fileTypeAction;
    if (!ext || !action) return;
    var item = (state.fileTypes || []).find(function (f) { return f.extension === ext; });
    if (!item) return;

    if (action === "toggle") {
      try {
        await api.patch("/settings/file-types/" + encodeURIComponent(ext), {
          isEnabled: !item.isEnabled
        });
        toast(_t("file_type_toggled"));
        await loadSettingsFileTypes();
        await loadActiveFileTypes();
      } catch (err) {
        toast(errorMessage(err), "error");
      }
      return;
    }

    if (action === "delete") {
      var confirmMsg = _t("file_type_delete_confirm", { ext: ext });
      var confirmed = await confirmDialog(confirmMsg);
      if (!confirmed) return;
      try {
        await api.del("/settings/file-types/" + encodeURIComponent(ext));
        toast(_t("file_type_deleted"));
        await loadSettingsFileTypes();
        await loadActiveFileTypes();
      } catch (err) {
        toast(errorMessage(err), "error");
      }
    }
  }

  async function handleResetFileTypes() {
    var confirmed = await confirmDialog(_t("restore_default_types_confirm"));
    if (!confirmed) return;
    try {
      await api.post("/settings/file-types/reset");
      toast(_t("file_types_restored"));
      await loadSettingsFileTypes();
      await loadActiveFileTypes();
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  function openFileTypeModal() {
    el("newFileExtension").value = "";
    el("newFileMimeType").value = "";
    el("newFileCategory").value = "document";
    el("newFileLabelAr").value = "";
    el("newFileLabelEn").value = "";
    showFormError("fileTypeFormError", "");
    showModal("fileTypeModal");
    el("newFileExtension").focus();
  }

  async function submitFileTypeForm(event) {
    event.preventDefault();
    var button = el("saveFileTypeButton");
    showFormError("fileTypeFormError", "");
    setBusy(button, true, "جارٍ الحفظ…");
    try {
      var ext = el("newFileExtension").value.trim().toLowerCase().replace(/^\.+/, "");
      var mime = el("newFileMimeType").value.trim().toLowerCase();
      var category = el("newFileCategory").value;
      var labelAr = el("newFileLabelAr").value.trim();
      var labelEn = el("newFileLabelEn").value.trim();

      await api.post("/settings/file-types", {
        extension: ext,
        mimeType: mime,
        category: category,
        labelAr: labelAr || undefined,
        labelEn: labelEn || undefined,
        isEnabled: true
      });
      toast(_t("file_type_added"));
      hideModal("fileTypeModal");
      await loadSettingsFileTypes();
      await loadActiveFileTypes();
    } catch (err) {
      showFormError("fileTypeFormError", errorMessage(err));
    } finally {
      setBusy(button, false);
    }
  }

  /* ========================================================================
     التنقل بين الصفحات
     ======================================================================== */
  async function showPage(pageId) {
    // حالة الدور/الإدارة تُقرأ من الخادم عند كل تنقّل، فلا تُبقي جلسة قائمة
    // واجهة إدارية قديمة بعد تغيير الدور أو تعطيل الحساب أو نقل الإدارة.
    if (state.user) await refreshSession();
    if (!PAGE_TITLES[pageId]) pageId = "dashboard";
    if (pageId === "other_attachments") pageId = "other";
    if (!isAdmin() && (pageId === "departments" || pageId === "users" || pageId === "audit")) {
      pageId = "dashboard";
    }
    state.currentPage = pageId;
    document.querySelectorAll(".page").forEach(function (page) {
      page.classList.toggle("active", page.id === pageId);
    });
    document.querySelectorAll(".menu").forEach(function (button) {
      button.classList.toggle("active", button.dataset.page === pageId);
    });
    el("pageTitle").textContent = getPageTitle(pageId);
    var backBtn = el("backToDashboardButton");
    if (backBtn) {
      backBtn.hidden = (pageId === "dashboard");
    }
    if (pageId === "dashboard") {
      loadDashboardStats();
      loadDocumentsView("dashboard");
    } else if (pageId === "incoming" || pageId === "outgoing" || pageId === "other") {
      loadDocumentsView(pageId);
    } else if (pageId === "archive") {
      loadDepartmentsForSelects();
      loadDocumentsView("archive");
    } else if (pageId === "departments") {
      loadDepartmentListPage();
    } else if (pageId === "users") {
      if (isAdmin()) loadUsers();
    } else if (pageId === "audit") {
      if (isAdmin()) loadAudit();
    } else if (pageId === "settings") {
      loadSettingsPage();
    } else if (pageId === "about") {
      loadSupportTickets();
    }
  }

  function debounce(callback, delay) {
    var timer = null;
    return function () {
      var args = arguments;
      var context = this;
      clearTimeout(timer);
      timer = setTimeout(function () {
        callback.apply(context, args);
      }, delay);
    };
  }

  function setupDateControl(input) {
    if (!input || input.dataset.dateControlInitialized) return;
    input.dataset.dateControlInitialized = "true";

    var wrapper = input.closest(".date-field");
    var picker = wrapper ? wrapper.querySelector(".date-native-picker") : null;
    var pickerBtn = wrapper ? wrapper.querySelector(".date-picker-btn") : null;

    var _isoValue = "";
    var protoDesc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");

    Object.defineProperty(input, "value", {
      get: function () {
        return _isoValue;
      },
      set: function (val) {
        if (!val) {
          _isoValue = "";
          if (protoDesc) protoDesc.set.call(input, "");
          if (picker) picker.value = "";
          input.setCustomValidity("");
          return;
        }
        var isoMatch = String(val).match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (isoMatch) {
          _isoValue = isoMatch[1] + "-" + isoMatch[2] + "-" + isoMatch[3];
          var disp = isoMatch[3] + "/" + isoMatch[2] + "/" + isoMatch[1];
          if (protoDesc) protoDesc.set.call(input, disp);
          if (picker) picker.value = _isoValue;
          input.setCustomValidity("");
          return;
        }
        var parsed = parseDateInput(String(val));
        if (parsed.valid) {
          _isoValue = parsed.iso;
          if (protoDesc) protoDesc.set.call(input, parsed.display || val);
          if (picker) picker.value = parsed.iso;
          input.setCustomValidity("");
          return;
        }
        _isoValue = "";
        if (protoDesc) protoDesc.set.call(input, val);
        input.setCustomValidity(parsed.error || "تاريخ غير صالح");
      },
      configurable: true
    });

    var handleInputOrChange = function () {
      var raw = protoDesc ? protoDesc.get.call(input).trim() : input.value.trim();
      if (!raw) {
        _isoValue = "";
        if (picker) picker.value = "";
        input.setCustomValidity("");
        return;
      }
      var parsed = parseDateInput(raw);
      if (parsed.valid) {
        _isoValue = parsed.iso;
        if (picker) picker.value = parsed.iso;
        input.setCustomValidity("");
      } else {
        _isoValue = "";
        input.setCustomValidity(parsed.error || "تاريخ غير صالح");
      }
    };

    input.addEventListener("input", handleInputOrChange);
    input.addEventListener("change", function () {
      handleInputOrChange();
      var raw = protoDesc ? protoDesc.get.call(input).trim() : input.value.trim();
      if (raw) {
        var parsed = parseDateInput(raw);
        if (parsed.valid && protoDesc && parsed.display) {
          protoDesc.set.call(input, parsed.display);
        }
      }
    });

    if (pickerBtn && picker) {
      pickerBtn.addEventListener("click", function () {
        if (typeof picker.showPicker === "function") {
          try {
            picker.showPicker();
          } catch (e) {
            picker.click();
          }
        } else {
          picker.click();
        }
      });

      picker.addEventListener("change", function () {
        if (picker.value) {
          input.value = picker.value;
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
        }
      });
    }
  }

  function initDateControls() {
    ["date", "dateFromFilter", "dateToFilter", "auditDateFrom", "auditDateTo"].forEach(function (id) {
      var input = el(id);
      if (input) setupDateControl(input);
    });
  }

  /* ========================================================================
     الربط بالأحداث
     ======================================================================== */
  function bindEvents() {
    initDateControls();
    el("loginForm").addEventListener("submit", doLogin);
    el("logoutButton").addEventListener("click", doLogout);

    var langToggleBtn = el("langToggle");
    if (langToggleBtn && window.I18N) {
      langToggleBtn.addEventListener("click", function () {
        window.I18N.toggleLanguage();
      });
    }
    var loginLangToggleBtn = el("loginLangToggle");
    if (loginLangToggleBtn && window.I18N) {
      loginLangToggleBtn.addEventListener("click", function () {
        window.I18N.toggleLanguage();
      });
    }

    window.addEventListener("archive:languagechange", function () {
      el("today").textContent = _t("today_prefix") + formatDate(todayString());
      el("pageTitle").textContent = getPageTitle(state.currentPage);
      fillDepartmentSelects();
      if (state.user) {
        applyRoleUI();
        if (state.currentPage === "dashboard") {
          loadDashboardStats();
          loadDocumentsView("dashboard");
        } else if (state.currentPage === "incoming" || state.currentPage === "outgoing" || state.currentPage === "other" || state.currentPage === "other_attachments" || state.currentPage === "archive") {
          loadDocumentsView(state.currentPage);
        } else if (state.currentPage === "departments") {
          loadDepartmentListPage();
        } else if (state.currentPage === "users") {
          loadUsers();
        } else if (state.currentPage === "audit") {
          loadAudit();
        } else if (state.currentPage === "settings") {
          loadSettingsPage();
        }
      }
    });

    var sidebarToggleBtn = el("sidebarToggle");
    var appContainer = el("app");
    if (sidebarToggleBtn && appContainer) {
      function setSidebarCollapsed(collapsed) {
        appContainer.classList.toggle("sidebar-collapsed", collapsed);
        sidebarToggleBtn.setAttribute("aria-expanded", String(!collapsed));
        sidebarToggleBtn.title = collapsed ? _t("sidebar_toggle_show") : _t("sidebar_toggle_hide");
        sidebarToggleBtn.setAttribute("aria-label", collapsed ? _t("sidebar_toggle_show") : _t("sidebar_toggle_hide"));
        try {
          localStorage.setItem("archive_sidebar_collapsed", String(collapsed));
        } catch (_) {}
      }

      sidebarToggleBtn.addEventListener("click", function () {
        var isCollapsed = appContainer.classList.contains("sidebar-collapsed");
        setSidebarCollapsed(!isCollapsed);
      });

      try {
        var savedPreference = localStorage.getItem("archive_sidebar_collapsed");
        if (savedPreference === "true") {
          setSidebarCollapsed(true);
        }
      } catch (_) {}
    }

    document.querySelectorAll(".menu").forEach(function (button) {
      button.addEventListener("click", function () {
        showPage(button.dataset.page);
        if (window.innerWidth <= 760 && appContainer) {
          appContainer.classList.add("sidebar-collapsed");
          if (sidebarToggleBtn) {
            sidebarToggleBtn.setAttribute("aria-expanded", "false");
            sidebarToggleBtn.title = _t("sidebar_toggle_show");
            sidebarToggleBtn.setAttribute("aria-label", _t("sidebar_toggle_show"));
          }
        }
      });
    });

    document.querySelectorAll(".stat-card[data-page]").forEach(function (card) {
      function navigate() {
        var page = card.dataset.page;
        if (page) showPage(page);
      }
      card.addEventListener("click", navigate);
      card.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          navigate();
        }
      });
    });

    var backToDashboardBtn = el("backToDashboardButton");
    if (backToDashboardBtn) {
      backToDashboardBtn.addEventListener("click", function () {
        showPage("dashboard");
      });
    }

    el("addIncomingButton").addEventListener("click", function () {
      openDocumentForm("create", null, "incoming");
    });
    el("addOutgoingButton").addEventListener("click", function () {
      openDocumentForm("create", null, "outgoing");
    });
    if (el("addOtherButton")) {
      el("addOtherButton").addEventListener("click", function () {
        openDocumentForm("create", null, "other");
      });
    }
    if (el("editAttachmentForm")) {
      el("editAttachmentForm").addEventListener("submit", async function (event) {
        event.preventDefault();
        var id = el("editAttachmentId").value;
        var newTitle = el("editAttachmentName").value.trim();
        var errorEl = el("editAttachmentFormError");
        if (!newTitle) {
          if (errorEl) {
            errorEl.textContent = "يرجى إدخال اسم المرفق أو المستند.";
            errorEl.style.display = "block";
          }
          return;
        }
        var saveBtn = el("saveEditAttachmentBtn");
        if (saveBtn) saveBtn.disabled = true;
        try {
          await api.patch("/documents/" + id, { title: newTitle });
          hideModal("editAttachmentModal");
          toast("تم تعديل المرفق بنجاح.");
          loadDocumentsView(state.currentPage === "other" ? "other" : (state.currentPage || "other"));
          refreshDocumentsAndStats();
        } catch (err) {
          if (errorEl) {
            errorEl.textContent = errorMessage(err);
            errorEl.style.display = "block";
          }
        } finally {
          if (saveBtn) saveBtn.disabled = false;
        }
      });
    }
    if (el("closeEditAttachmentModal")) {
      el("closeEditAttachmentModal").addEventListener("click", function () {
        hideModal("editAttachmentModal");
      });
    }
    if (el("closeEditAttachmentModalBtn")) {
      el("closeEditAttachmentModalBtn").addEventListener("click", function () {
        hideModal("editAttachmentModal");
      });
    }

    if (el("closeShareModal")) {
      el("closeShareModal").addEventListener("click", closeShareModal);
    }
    if (el("closeShareModalBtn")) {
      el("closeShareModalBtn").addEventListener("click", closeShareModal);
    }
    if (el("copyShareLinkBtn")) {
      el("copyShareLinkBtn").addEventListener("click", function () {
        var input = el("shareLinkInput");
        input.select();
        input.setSelectionRange(0, 99999);
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(input.value).then(function () {
            toast(_t("link_copied"));
          }).catch(function () {
            document.execCommand("copy");
            toast(_t("link_copied"));
          });
        } else {
          document.execCommand("copy");
          toast(_t("link_copied"));
        }
      });
    }
    var shModal = el("shareModal");
    if (shModal) {
      shModal.addEventListener("click", function (event) {
        if (event.target === shModal) closeShareModal();
      });
    }
    if (el("documentType")) {
      el("documentType").addEventListener("change", function () {
        state.documentType = el("documentType").value;
        updateDocumentFormLabels(state.documentType, Boolean(state.editingDocumentId));
        updateSenderFieldState(state.documentType, Boolean(state.editingDocumentId), el("sender").value);
      });
    }

    if (el("senderEditButton")) {
      el("senderEditButton").addEventListener("click", handleSenderUnlock);
    }

    el("documentForm").addEventListener("submit", submitDocumentForm);
    el("closeDocumentModal").addEventListener("click", closeDocumentModal);
    el("cancelDocumentButton").addEventListener("click", closeDocumentModal);
    el("attachmentInput").addEventListener("change", handleAttachmentSelection);
    el("documentModal").addEventListener("click", function (event) {
      if (event.target === el("documentModal")) closeDocumentModal();
    });

    el("closeDetailModal").addEventListener("click", function () {
      hideModal("detailModal");
    });
    el("detailModal").addEventListener("click", function (event) {
      if (event.target === el("detailModal")) hideModal("detailModal");
    });

    var closePrevX = el("closePreviewModal");
    if (closePrevX) closePrevX.addEventListener("click", closePreviewModal);
    var closePrevBtn = el("closePreviewModalBtn");
    if (closePrevBtn) closePrevBtn.addEventListener("click", closePreviewModal);
    var maxBtn = el("previewMaximizeBtn");
    if (maxBtn) {
      maxBtn.addEventListener("click", function () {
        var modalBox = document.querySelector("#previewModal .preview-modal-box");
        if (modalBox) {
          var isMax = modalBox.classList.toggle("is-maximized");
          maxBtn.textContent = isMax ? "❐ استعادة الحجم" : "⛶ تكبير النافذة";
        }
      });
    }
    var prevModal = el("previewModal");
    if (prevModal) {
      prevModal.addEventListener("click", function (event) {
        if (event.target === prevModal) closePreviewModal();
      });
    }

    el("userForm").addEventListener("submit", submitUserForm);
    el("userRole").addEventListener("change", updateUserDepartmentField);
    el("closeUserModal").addEventListener("click", function () {
      hideModal("userModal");
    });
    el("cancelUserButton").addEventListener("click", function () {
      hideModal("userModal");
    });
    el("userModal").addEventListener("click", function (event) {
      if (event.target === el("userModal")) hideModal("userModal");
    });
    el("addUserButton").addEventListener("click", function () {
      openUserModal("create", null);
    });

    if (el("addFileTypeButton")) {
      el("addFileTypeButton").addEventListener("click", openFileTypeModal);
    }
    if (el("resetFileTypesButton")) {
      el("resetFileTypesButton").addEventListener("click", handleResetFileTypes);
    }
    if (el("closeFileTypeModal")) {
      el("closeFileTypeModal").addEventListener("click", function () {
        hideModal("fileTypeModal");
      });
    }
    if (el("cancelFileTypeButton")) {
      el("cancelFileTypeButton").addEventListener("click", function () {
        hideModal("fileTypeModal");
      });
    }
    if (el("fileTypeModal")) {
      el("fileTypeModal").addEventListener("click", function (event) {
        if (event.target === el("fileTypeModal")) hideModal("fileTypeModal");
      });
    }
    if (el("fileTypeForm")) {
      el("fileTypeForm").addEventListener("submit", submitFileTypeForm);
    }
    if (el("newFileExtension")) {
      el("newFileExtension").addEventListener("input", function () {
        var val = el("newFileExtension").value.trim().toLowerCase().replace(/^\.+/, "");
        var found = COMMON_MIMES[val];
        if (found) {
          if (!el("newFileMimeType").value) el("newFileMimeType").value = found.mime;
          if (found.cat) el("newFileCategory").value = found.cat;
          if (!el("newFileLabelAr").value) el("newFileLabelAr").value = found.ar;
          if (!el("newFileLabelEn").value) el("newFileLabelEn").value = found.en;
        }
      });
    }
    if (el("fileTypesSearch")) {
      el("fileTypesSearch").addEventListener("input", function () {
        state.fileTypesFilter.q = el("fileTypesSearch").value;
        renderFileTypesTable();
      });
    }
    if (el("fileTypesCategoryFilter")) {
      el("fileTypesCategoryFilter").addEventListener("change", function () {
        state.fileTypesFilter.category = el("fileTypesCategoryFilter").value;
        renderFileTypesTable();
      });
    }
    if (el("fileTypesTable")) {
      el("fileTypesTable").addEventListener("click", function (event) {
        var btn = event.target.closest("[data-file-type-action]");
        if (btn) handleFileTypeAction(btn);
      });
    }

    el("promptForm").addEventListener("submit", function (event) {
      event.preventDefault();
      var input = el("promptInput");
      var value = input.type === "password" ? input.value : input.value.trim();
      if (!value) {
        resolvePrompt(null, "القيمة مطلوبة.");
        return;
      }
      if (input.minLength > 0 && value.length < input.minLength) {
        resolvePrompt(null, "القيمة أقصر من الحد الأدنى (" + input.minLength + ").");
        return;
      }
      resolvePrompt(value);
    });
    el("promptCancel").addEventListener("click", function () {
      resolvePrompt(null);
    });
    el("promptCancelX").addEventListener("click", function () {
      resolvePrompt(null);
    });

    el("confirmOk").addEventListener("click", function () {
      resolveConfirm(true);
    });
    el("confirmCancel").addEventListener("click", function () {
      resolveConfirm(false);
    });
    el("confirmCancelX").addEventListener("click", function () {
      resolveConfirm(false);
    });

    document.addEventListener("keydown", function (event) {
      if (event.key !== "Escape") return;
      var prevModal = el("previewModal");
      if (prevModal && prevModal.classList.contains("show")) {
        closePreviewModal();
        return;
      }
      var shareM = el("shareModal");
      if (shareM && shareM.classList.contains("show")) {
        closeShareModal();
        return;
      }
      if (state.uploadingAttachments) {
        toast("انتظر انتهاء رفع المرفقات قبل إغلاق النافذة.", "error");
        return;
      }
      hideModal("documentModal");
      hideModal("detailModal");
      hideModal("editAttachmentModal");
      hideModal("userModal");
      if (promptResolver) resolvePrompt(null);
      if (confirmResolver) resolveConfirm(false);
    });

    document.addEventListener("click", function (event) {
      var documentButton = event.target.closest("[data-doc-action]");
      if (documentButton) {
        var action = documentButton.dataset.docAction;
        var id = documentButton.dataset.id;
        if (action === "view") openDocumentDetail(id);
        if (action === "preview") openDirectDocumentPreview(id);
        if (action === "download") directDownloadDocumentFiles(id);
        if (action === "share") openShareModal(id);
        if (action === "edit") openDocumentForm("edit", id);
        if (action === "edit-attachment") openEditAttachmentModal(id);
        if (action === "delete") performDocumentAction("delete", id);
        if (action === "restore") performDocumentAction("restore", id);
        return;
      }
      var pendingButton = event.target.closest("[data-pending-action]");
      if (pendingButton) {
        var pendingKey = Number(pendingButton.dataset.key);
        var pendingAction = pendingButton.dataset.pendingAction;
        if (pendingAction === "view") previewPendingFile(pendingKey);
        if (pendingAction === "upload" && state.editingDocumentId) {
          uploadPendingEntries(state.editingDocumentId, pendingKey);
        }
        if (pendingAction === "remove") removePendingFile(pendingKey);
        if (pendingAction === "retry" && state.editingDocumentId) {
          uploadPendingEntries(state.editingDocumentId, pendingKey);
        }
        return;
      }
      var fileButton = event.target.closest("[data-file-action]");
      if (fileButton) {
        if (fileButton.dataset.fileAction === "view") {
          previewFile(fileButton.dataset.id, fileButton.dataset.name, fileButton.dataset.mime);
        }
        if (fileButton.dataset.fileAction === "download") downloadFile(fileButton.dataset.id);
        if (fileButton.dataset.fileAction === "delete") deleteFile(fileButton.dataset.id);
        return;
      }
      var departmentButton = event.target.closest("[data-dept-action]");
      if (departmentButton) {
        handleDepartmentAction(departmentButton);
        return;
      }
      var userButton = event.target.closest("[data-user-action]");
      if (userButton) {
        handleUserAction(userButton);
      }
    });

    var searchBindings = [
      ["dashboardSearch", "dashboard"],
      ["incomingSearch", "incoming"],
      ["outgoingSearch", "outgoing"],
      ["otherSearch", "other"],
      ["other_attachmentsSearch", "other_attachments"],
      ["otherAttachmentsSearch", "other_attachments"],
      ["archiveSearch", "archive"],
      ["usersSearch", "users"]
    ];
    searchBindings.forEach(function (binding) {
      var elem = el(binding[0]);
      if (!elem) return;
      var view = state.views[binding[1]];
      elem.addEventListener(
        "input",
        debounce(function () {
          view.q = elem.value.trim();
          view.page = 1;
          if (binding[1] === "users") loadUsers();
          else loadDocumentsView(binding[1]);
        }, 300)
      );
    });

    var archiveSelects = [
      ["typeFilter", "type"],
      ["departmentFilter", "departmentId"],
      ["dateFromFilter", "dateFrom"],
      ["dateToFilter", "dateTo"],
      ["sortFilter", "sort"]
    ];
    archiveSelects.forEach(function (binding) {
      el(binding[0]).addEventListener("change", function () {
        var view = state.views.archive;
        var value = el(binding[0]).value;
        if (binding[1] === "sort") {
          var parts = value.split(":");
          view.sort = parts[0];
          view.order = parts[1] || "desc";
        } else {
          view[binding[1]] = value;
        }
        view.page = 1;
        loadDocumentsView("archive");
      });
    });
    if (el("otherTypeFilter")) {
      el("otherTypeFilter").addEventListener("change", function () {
        state.views.other.type = el("otherTypeFilter").value;
        state.views.other.page = 1;
        loadDocumentsView("other");
      });
    }
    el("includeDeletedFilter").addEventListener("change", function () {
      state.views.archive.includeDeleted = el("includeDeletedFilter").checked;
      state.views.archive.page = 1;
      loadDocumentsView("archive");
    });

    var otherAttDept = el("other_attachmentsDeptFilter") || el("otherAttachmentsDeptFilter");
    if (otherAttDept) {
      otherAttDept.addEventListener("change", function () {
        state.views.other_attachments.departmentId = otherAttDept.value;
        state.views.other_attachments.page = 1;
        loadDocumentsView("other_attachments");
      });
    }
    el("clearArchiveFilters").addEventListener("click", function () {
      el("archiveSearch").value = "";
      el("typeFilter").value = "";
      el("departmentFilter").value = "";
      el("dateFromFilter").value = "";
      el("dateToFilter").value = "";
      el("sortFilter").value = "date:desc";
      el("includeDeletedFilter").checked = false;
      state.views.archive = {
        page: 1,
        pageSize: 10,
        q: "",
        type: "",
        departmentId: "",
        dateFrom: "",
        dateTo: "",
        sort: "date",
        order: "desc",
        includeDeleted: false,
        total: 0
      };
      loadDocumentsView("archive");
    });

    el("exportArchiveCsvButton").addEventListener("click", function () {
      exportDocumentsCsv(false);
    });

    el("departmentForm").addEventListener("submit", async function (event) {
      event.preventDefault();
      var name = el("departmentName").value.trim();
      if (!name) return;
      try {
        await api.post("/departments", { name: name });
        el("departmentName").value = "";
        toast("تمت إضافة الإدارة.");
        loadDepartmentListPage();
      } catch (error) {
        toast(errorMessage(error), "error");
      }
    });
    el("includeInactiveDepartments").addEventListener("change", function () {
      loadDepartmentListPage();
    });

    el("usersRoleFilter").addEventListener("change", function () {
      state.views.users.role = el("usersRoleFilter").value;
      state.views.users.page = 1;
      loadUsers();
    });
    el("usersStatusFilter").addEventListener("change", function () {
      state.views.users.isActive = el("usersStatusFilter").value;
      state.views.users.page = 1;
      loadUsers();
    });

    var auditInputs = [
      ["auditActionFilter", "action"],
      ["auditEntityFilter", "entityType"],
      ["auditDateFrom", "dateFrom"],
      ["auditDateTo", "dateTo"]
    ];
    auditInputs.forEach(function (binding) {
      var handler = function () {
        state.views.audit[binding[1]] = el(binding[0]).value.trim();
        state.views.audit.page = 1;
        loadAudit();
      };
      if (binding[1] === "action" || binding[1] === "entityType") {
        el(binding[0]).addEventListener("input", debounce(handler, 300));
      } else {
        el(binding[0]).addEventListener("change", handler);
      }
    });
    el("auditRefreshButton").addEventListener("click", loadAudit);

    el("changePasswordForm").addEventListener("submit", submitChangePassword);

    var saveUploadBtn = el("saveUploadSettingsBtn");
    if (saveUploadBtn) {
      saveUploadBtn.addEventListener("click", saveSystemSettings);
    }

    var openTicketBtn = el("openCreateTicketBtn");
    if (openTicketBtn) {
      openTicketBtn.addEventListener("click", function () {
        showModal("createTicketModal");
      });
    }
    var closeTicketBtn = el("closeCreateTicketModal");
    if (closeTicketBtn) {
      closeTicketBtn.addEventListener("click", function () {
        hideModal("createTicketModal");
      });
    }
    var closeTicketBtn2 = el("closeCreateTicketModalBtn");
    if (closeTicketBtn2) {
      closeTicketBtn2.addEventListener("click", function () {
        hideModal("createTicketModal");
      });
    }
    var createTicketForm = el("createTicketForm");
    if (createTicketForm) {
      createTicketForm.addEventListener("submit", submitCreateTicket);
    }

    var closeEditTicketBtn = el("closeEditTicketModal");
    if (closeEditTicketBtn) {
      closeEditTicketBtn.addEventListener("click", function () {
        hideModal("editTicketModal");
      });
    }
    var closeEditTicketBtn2 = el("closeEditTicketModalBtn");
    if (closeEditTicketBtn2) {
      closeEditTicketBtn2.addEventListener("click", function () {
        hideModal("editTicketModal");
      });
    }
    var editTicketForm = el("editTicketForm");
    if (editTicketForm) {
      editTicketForm.addEventListener("submit", submitEditTicket);
    }

    var closeChatBtn = el("closeTicketChatModal");
    if (closeChatBtn) {
      closeChatBtn.addEventListener("click", function () {
        hideModal("ticketChatModal");
      });
    }
    var ticketReplyForm = el("ticketReplyForm");
    if (ticketReplyForm) {
      ticketReplyForm.addEventListener("submit", submitTicketReply);
    }
    var ticketStatusSelect = el("ticketStatusSelect");
    if (ticketStatusSelect) {
      ticketStatusSelect.addEventListener("change", function () {
        updateTicketStatus(ticketStatusSelect.value);
      });
    }

    setInterval(checkForUpdates, 60000);
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) checkForUpdates();
    });
    window.addEventListener("focus", function () {
      checkForUpdates();
    });
  }

  async function exportDocumentsCsv(fromReports) {
    try {
      var result = await api.download("/reports/documents.csv");
      api.saveBlob(result.blob, result.filename);
      toast("تم تجهيز ملف CSV.");
    } catch (error) {
      toast(errorMessage(error), "error");
    }
  }

  function checkUrlHash() {
    var hash = window.location.hash || "";
    if (hash.indexOf("#doc-") === 0) {
      var id = decodeURIComponent(hash.replace("#doc-", ""));
      if (id && state.user) {
        openDocumentDetail(id);
      }
    }
  }

  /* ========================================================================
     الإقلاع
     ======================================================================== */
  async function boot() {
    el("today").textContent = _t("today_prefix") + formatDate(todayString());
    api.setUnauthorizedHandler(function () {
      if (state.user) {
        toast(_t("session_expired"), "error");
      }
      state.user = null;
      api.setCsrfToken(null);
      showLogin();
    });
    bindEvents();
    window.addEventListener("hashchange", checkUrlHash);
    try {
      await loadSession();
      checkUrlHash();
    } catch (error) {
      showLogin();
    } finally {
      el("bootScreen").classList.add("is-hidden");
    }
  }

  boot();
})();
