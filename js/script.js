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
    dashboard: "لوحة التحكم",
    incoming: "المراسلات الواردة",
    outgoing: "المراسلات الصادرة",
    other: "مراسلات أخرى",
    archive: "الأرشيف الإلكتروني",
    departments: "الإدارات والأقسام",
    reports: "التقارير والإحصائيات",
    users: "إدارة المستخدمين",
    audit: "سجل التدقيق",
    settings: "إعدادات المنظومة",
    about: "حول المنظومة"
  };

  function getPageTitle(pageId) {
    var key = "nav_" + pageId;
    var res = _t(key);
    return res !== key ? res : (PAGE_TITLES[pageId] || pageId);
  }

  function getTypeLabel(type) {
    if (type === "incoming") return _t("type_incoming");
    if (type === "outgoing") return _t("type_outgoing");
    if (type === "other") return _t("type_other");
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
    "department.created": "إضافة إدارة",
    "department.updated": "تعديل إدارة",
    "department.deleted": "حذف إدارة",
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

  /* ========================================================================
     الحالة العامة
     ======================================================================== */
  var state = {
    user: null,
    currentPage: "dashboard",
    departments: [],
    userFormDepartments: [],
    views: {
      dashboard: { page: 1, pageSize: 8, q: "", total: 0 },
      incoming: { page: 1, pageSize: 10, q: "", total: 0 },
      outgoing: { page: 1, pageSize: 10, q: "", total: 0 },
      other: { page: 1, pageSize: 10, q: "", type: "", total: 0 },
      archive: {
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
    document.querySelectorAll(".admin-only").forEach(function (node) {
      node.classList.toggle("is-hidden", !admin);
    });
    document.querySelectorAll("[data-requires-department]").forEach(function (node) {
      node.disabled = blocked;
      node.title = blocked ? departmentAccessMessage() : "";
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
  function getDocColumns() {
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

  function renderDocuments(container, items) {
    if (!items.length) {
      renderEmpty(container, _t("no_documents"));
      return;
    }
    var admin = isAdmin();
    var rows = items
      .map(function (document) {
        var deleted = Boolean(document.deletedAt);
        var actions = [
          '<button type="button" class="small-button" data-doc-action="view" data-id="' +
            escapeHTML(document.id) +
            '">' + escapeHTML(_t("view")) + '</button>'
        ];
        if (!deleted) {
          actions.push(
            '<button type="button" class="small-button" data-doc-action="edit" data-id="' +
              escapeHTML(document.id) +
              '">' + escapeHTML(_t("edit")) + '</button>'
          );
        }
        if (admin) {
          if (deleted) {
            actions.push(
              '<button type="button" class="small-button" data-doc-action="restore" data-id="' +
                escapeHTML(document.id) +
                '">' + escapeHTML(_t("restore")) + '</button>'
            );
          } else {
            actions.push(
              '<button type="button" class="small-button delete-button" data-doc-action="delete" data-id="' +
                escapeHTML(document.id) +
                '">' + escapeHTML(_t("delete")) + '</button>'
            );
          }
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
      getDocColumns().map(function (column) {
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
        otherQuery.types = "other,minutes,proposal,report";
      }
      return otherQuery;
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
    var table = el(viewName + "Table");
    renderLoading(table, "جارٍ تحميل المعاملات…");
    try {
      var data = await api.get("/documents", documentQuery(viewName));
      view.total = data.total;
      view.page = data.page;
      renderDocuments(table, data.items);
      renderPager(el(viewName + "Pager"), view, function (delta) {
        view.page = Math.max(1, view.page + delta);
        loadDocumentsView(viewName);
      });
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

  async function loadReports() {
    try {
      var summary = await api.get("/reports/summary", {});
      var typeCount = function (type) {
        var entry = (summary.byType || []).find(function (row) {
          return row.type === type;
        });
        return entry ? entry.count : 0;
      };
      el("reportTotal").textContent = summary.total;
      el("reportIncoming").textContent = typeCount("incoming");
      el("reportOutgoing").textContent = typeCount("outgoing");
      if (el("reportOther")) {
        el("reportOther").textContent =
          typeCount("other") + typeCount("minutes") + typeCount("proposal") + typeCount("report");
      }
      renderReportList(
        "reportByType",
        (summary.byType || []).map(function (row) {
          return { label: getTypeLabel(row.type), count: row.count };
        })
      );
      renderReportList(
        "reportByDepartment",
        (summary.byDepartment || []).map(function (row) {
          return { label: row.department, count: row.count };
        })
      );
      renderReportList(
        "reportByMonth",
        (summary.byMonth || []).map(function (row) {
          return { label: row.month, count: row.count };
        })
      );
    } catch (error) {
      toast(errorMessage(error), "error");
    }
  }

  function renderReportList(containerId, rows) {
    var container = el(containerId);
    if (!rows.length) {
      container.innerHTML = '<div class="empty">' + escapeHTML(_t("no_report_data")) + '</div>';
      return;
    }
    container.innerHTML = rows
      .map(function (row) {
        return (
          '<div class="report-row"><span>' +
          escapeHTML(row.label) +
          "</span><strong>" +
          escapeHTML(row.count) +
          "</strong></div>"
        );
      })
      .join("");
  }

  /* ========================================================================
     المعاملات: النموذج والتفاصيل والحذف والاستعادة
     ======================================================================== */
  function canDeleteAttachments() {
    return Boolean(isAdmin() || (state.user && state.user.role === "employee" && !isDepartmentBlocked()));
  }

  function attachmentActions(file) {
    var actions = [];
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
        '<option value="minutes">' + escapeHTML(_t("type_minutes")) + '</option>' +
        '<option value="proposal">' + escapeHTML(_t("type_proposal")) + '</option>' +
        '<option value="report">' + escapeHTML(_t("type_report")) + '</option>';
    } else if (type === "incoming") {
      select.innerHTML = '<option value="incoming">' + escapeHTML(_t("type_incoming")) + '</option>';
    } else if (type === "outgoing") {
      select.innerHTML = '<option value="outgoing">' + escapeHTML(_t("type_outgoing")) + '</option>';
    } else {
      select.innerHTML =
        '<option value="other">' + escapeHTML(_t("type_other")) + '</option>' +
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
    var isMinutes = type === "minutes";
    var isProposal = type === "proposal";
    var isReport = type === "report";
    var isOtherGroup = isOther || isMinutes || isProposal || isReport;

    if (isEdit) {
      el("formTitle").textContent = _t("edit_doc_title");
    } else if (isOutgoing) {
      el("formTitle").textContent = _t("create_outgoing_title");
    } else if (isIncoming) {
      el("formTitle").textContent = _t("create_incoming_title");
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
    el("sender").value = doc ? doc.sender : "";
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
    attachmentInput.value = "";
    attachmentInput.disabled = false;
    attachmentsSection.hidden = false;
    if (doc) {
      attachmentHint.textContent = _t("doc_attachments_hint");
      await refreshAttachmentList(doc.id);
    } else {
      // وضع الإنشاء: يختار المستخدم الملفات الآن وتُرفع تلقائياً بعد حفظ المراسلة.
      attachmentHint.textContent = _t("doc_attachments_hint");
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
    Array.prototype.slice.call(fileList || []).forEach(function (file) {
      state.pendingCounter += 1;
      state.pendingFiles.push({
        key: state.pendingCounter,
        file: file,
        status: "queued",
        error: null
      });
    });
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
    var queued = state.pendingFiles.length > 0;
    setBusy(button, true, createMode && queued ? "جارٍ الحفظ ورفع المرفقات…" : "جارٍ الحفظ…");
    try {
      if (!createMode) {
        await api.patch("/documents/" + state.editingDocumentId, payload);
        if (state.pendingFiles.length) {
          await uploadPendingEntries(state.editingDocumentId);
          if (!state.pendingFiles.length) {
            toast("تم تحديث المراسلة وحفظ المرفقات.");
            hideModal("documentModal");
          }
        } else {
          toast("تم تحديث المراسلة.");
          hideModal("documentModal");
        }
      } else {
        var created = await api.post("/documents", payload);
        var newDocumentId =
          created && created.document && created.document.id ? created.document.id : null;
        if (!newDocumentId) throw new Error("تعذّر تحديد المراسلة المنشأة.");
        // ننتقل إلى وضع التعديل فوراً كي تظهر المرفقات المخزَّنة وأزرارها،
        // مع إبقاء الملفات الفاشلة قابلة لإعادة المحاولة دون تكرار الناجحة.
        state.editingDocumentId = newDocumentId;
        el("formTitle").textContent = "تعديل بيانات الرسالة";
        el("attachmentHint").textContent = "اختر ملفاً أو أكثر.";
        refreshDocumentsAndStats();
        if (state.pendingFiles.length) {
          await uploadPendingEntries(newDocumentId);
          // تبقى النافذة مفتوحة لعرض المرفقات المرفوعة ونتائج أي فشل جزئي.
        } else {
          toast("تم تسجيل المراسلة بنجاح.");
          hideModal("documentModal");
        }
      }
    } catch (error) {
      // في وضع الإنشاء تبقى الملفات في قائمة الانتظار للسماح بإعادة المحاولة.
      showFormError("documentFormError", errorMessage(error));
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
      var detailTitlePrefix = window.I18N && window.I18N.getLanguage() === "en" ? "Document Details " : "تفاصيل المراسلة ";
      var docIdentifier = doc.reference || doc.sequenceNumber || doc.title || "—";
      el("detailTitle").textContent = detailTitlePrefix + (doc.reference ? doc.reference : "(" + docIdentifier + ")");
      var fields = [
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
      if (!deleted) {
        actions.push(
          '<button type="button" class="button" id="detailEditButton">' + escapeHTML(_t("edit")) + '</button>'
        );
      }
      if (isAdmin()) {
        if (deleted) {
          actions.push(
            '<button type="button" class="button" id="detailRestoreButton">' + escapeHTML(_t("restore")) + '</button>'
          );
        } else {
          actions.push(
            '<button type="button" class="button danger-button" id="detailDeleteButton">' + escapeHTML(_t("delete")) + '</button>'
          );
        }
      }
      actions.push(
        '<button type="button" class="button secondary-button" id="detailCloseButton">' + escapeHTML(_t("close")) + '</button>'
      );
      el("detailActions").innerHTML = actions.join("");

      var editButton = el("detailEditButton");
      if (editButton) {
        editButton.addEventListener("click", function () {
          hideModal("detailModal");
          openDocumentForm("edit", documentId);
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
        var confirmed = await confirmDialog(
          "هل تريد حذف هذه المعاملة؟ تُنقل إلى المحذوفات ويمكن للمدير استعادتها لاحقاً."
        );
        if (!confirmed) return false;
        await api.del("/documents/" + documentId);
        toast("تم نقل المعاملة إلى المحذوفات.");
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
    if (page === "dashboard" || page === "incoming" || page === "outgoing" || page === "archive") {
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
          '<button type="button" class="small-button' +
            (user.isActive ? " delete-button" : "") +
            '" data-user-action="toggle" data-id="' +
            escapeHTML(user.id) +
            '"' +
            (isSelf ? " disabled" : "") +
            ">" +
            escapeHTML(toggleText) +
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
    var employee = el("userRole").value === "employee";
    el("userDepartment").required = employee;
    el("userDepartmentRequired").hidden = !employee;
    el("userDepartmentHint").textContent = employee
      ? "إدارة نشطة إلزامية للموظف. لا يمكن حفظ الحساب كموظف دون تعيين إدارة."
      : "المدير يرى جميع الإدارات، ويمكن تركه بلا إدارة.";
    var blank = el("userDepartment").querySelector('option[value=""]');
    if (blank) blank.disabled = employee;
  }

  async function openUserModal(mode, user) {
    state.editingUserId = mode === "edit" ? user.id : null;
    el("userModalTitle").textContent =
      mode === "edit" ? "تعديل المستخدم «" + user.username + "»" : "إضافة مستخدم";
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
        showFormError("userFormError", "يجب اختيار إدارة نشطة للموظف.");
        return;
      }
      if (state.editingUserId) {
        await api.patch("/users/" + state.editingUserId, {
          displayName: el("userDisplayName").value.trim(),
          employeeNumber: employeeNumber,
          departmentId: departmentId,
          role: role
        });
        toast("تم تحديث بيانات المستخدم.");
      } else {
        await api.post("/users", {
          username: el("userUsername").value.trim(),
          displayName: el("userDisplayName").value.trim(),
          employeeNumber: employeeNumber,
          departmentId: departmentId,
          role: role,
          password: el("userPassword").value
        });
        toast("تم إنشاء المستخدم.");
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

  function renderAuditTable(container, items) {
    if (!items.length) {
      renderEmpty(container, _t("no_audit"));
      return;
    }
    var rows = items
      .map(function (entry) {
        var details = entry.details ? JSON.stringify(entry.details) : "—";
        return (
          "<tr><td>" +
          escapeHTML(formatDateTime(entry.createdAt)) +
          "</td><td>" +
          escapeHTML(entry.actorUsername || "—") +
          "</td><td>" +
          escapeHTML(getActionLabel(entry.action)) +
          '</td><td dir="ltr">' +
          escapeHTML(
            (entry.entityType || "—") +
              (entry.entityId ? " / " + truncate(entry.entityId, 8) : "")
          ) +
          '</td><td dir="ltr" title="' +
          escapeHTML(details) +
          '">' +
          escapeHTML(truncate(details, 70)) +
          "</td><td>" +
          escapeHTML(entry.ip || "—") +
          "</td></tr>"
        );
      })
      .join("");
    var auditColumns = [
      _t("col_audit_time"),
      _t("col_audit_user"),
      _t("col_audit_action"),
      _t("col_audit_entity"),
      _t("col_audit_details"),
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
     الإعدادات: كلمة المرور، النسخ الاحتياطي، ترحيل بيانات المتصفح
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

  async function exportBackup() {
    try {
      var result = await api.download("/exports/backup");
      api.saveBlob(result.blob, result.filename);
      toast("تم تجهيز النسخة الاحتياطية.");
    } catch (error) {
      toast(errorMessage(error), "error");
    }
  }

  async function importBackup() {
    var input = el("backupFileInput");
    var file = input.files && input.files[0];
    if (!file) {
      toast("اختر ملف النسخة الاحتياطية أولاً.", "error");
      return;
    }
    var text;
    try {
      text = await file.text();
    } catch (error) {
      toast("تعذر قراءة الملف.", "error");
      return;
    }
    var payload;
    try {
      payload = JSON.parse(text);
    } catch (error) {
      toast("ملف النسخة الاحتياطية غير صالح (JSON غير قابل للقراءة).", "error");
      return;
    }
    if (!payload || !Array.isArray(payload.documents)) {
      toast("ملف النسخة الاحتياطية غير صالح: لا يحتوي على قائمة معاملات.", "error");
      return;
    }
    var confirmed = await confirmDialog(
      "سيتم استيراد " +
        payload.documents.length +
        " معاملة من النسخة الاحتياطية. تُتجاهل السجلات المكررة ولا تُحذف البيانات الحالية. هل تريد المتابعة؟"
    );
    if (!confirmed) return;
    var button = el("importBackupButton");
    setBusy(button, true, "جارٍ الاستيراد…");
    try {
      var outcome = await api.post("/imports/backup", {
        formatVersion: payload.formatVersion || 1,
        departments: Array.isArray(payload.departments) ? payload.departments : [],
        documents: payload.documents
      });
      renderImportResult("backupImportResult", outcome, false);
      toast("تم استيراد النسخة الاحتياطية.");
      input.value = "";
      refreshDocumentsAndStats();
    } catch (error) {
      toast(errorMessage(error), "error");
    } finally {
      setBusy(button, false);
    }
  }

  function readLegacyBrowserData() {
    var documents = [];
    var departments = [];
    try {
      var storedDocuments = JSON.parse(localStorage.getItem(LEGACY_DOCUMENTS_KEY) || "null");
      if (Array.isArray(storedDocuments)) documents = storedDocuments;
      var storedDepartments = JSON.parse(localStorage.getItem(LEGACY_DEPARTMENTS_KEY) || "null");
      if (Array.isArray(storedDepartments)) departments = storedDepartments;
    } catch (error) {
      /* بيانات المتصفح تالفة: نتعامل معها كغير موجودة. */
    }
    return { documents: documents, departments: departments };
  }

  function updateLegacyStatus() {
    var legacy = readLegacyBrowserData();
    var status = el("legacyStatus");
    var importButton = el("importLegacyButton");
    if (!legacy.documents.length && !legacy.departments.length) {
      status.textContent = "لا توجد بيانات قديمة محفوظة في هذا المتصفح.";
      importButton.disabled = true;
      return;
    }
    status.textContent =
      "المعاملات في المتصفح: " +
      legacy.documents.length +
      " — الإدارات: " +
      legacy.departments.length;
    importButton.disabled = false;
  }

  async function importLegacyBrowserData() {
    var legacy = readLegacyBrowserData();
    if (!legacy.documents.length && !legacy.departments.length) return;
    var confirmed = await confirmDialog(
      "سيتم ترحيل " +
        legacy.documents.length +
        " معاملة و" +
        legacy.departments.length +
        " إدارة من متصفحك إلى الخادم. تُتجاهل السجلات المكررة، ولا تُنقل محتويات المرفقات. هل تريد المتابعة؟"
    );
    if (!confirmed) return;
    var button = el("importLegacyButton");
    setBusy(button, true, "جارٍ الترحيل…");
    try {
      var outcome = await api.post("/imports/legacy", {
        source: LEGACY_DOCUMENTS_KEY,
        departments: legacy.departments.map(function (department) {
          return {
            legacyId: department && department.id ? String(department.id) : undefined,
            name: String((department && department.name) || "").trim()
          };
        }).filter(function (department) {
          return department.name;
        }),
        documents: legacy.documents.map(function (document) {
          return {
            legacyId: document && document.id ? String(document.id) : undefined,
            reference: String((document && document.reference) || ""),
            title: String((document && document.title) || ""),
            type: (document && document.type) || "incoming",
            date: (document && document.date) || "",
            sender: (document && document.sender) || "",
            recipient: (document && document.recipient) || "",
            sequenceNumber: (document && document.sequenceNumber) || null,
            status: (document && document.status) || null,
            notes: (document && document.notes) || "",
            createdAt: (document && document.createdAt) || null,
            updatedAt: (document && document.updatedAt) || null,
            departmentLegacyId:
              document && document.department ? String(document.department) : undefined
          };
        })
      });
      renderImportResult("legacyResult", outcome, true);
      el("clearLegacyButton").hidden = false;
      toast("تم ترحيل بيانات المتصفح إلى الخادم.");
      refreshDocumentsAndStats();
    } catch (error) {
      toast(errorMessage(error), "error");
    } finally {
      setBusy(button, false);
    }
  }

  function renderImportResult(containerId, outcome, isLegacy) {
    var container = el(containerId);
    container.hidden = false;
    var summary = outcome.summary || {};
    var rejected = (outcome.results || []).filter(function (result) {
      return result.status === "rejected";
    });
    var html =
      '<div class="import-summary">' +
      "<span>استُوردت: <strong>" +
      escapeHTML(summary.documentsImported || 0) +
      "</strong></span>" +
      "<span>إدارات جديدة: <strong>" +
      escapeHTML(summary.departmentsCreated || 0) +
      "</strong></span>" +
      "<span>مكررة: <strong>" +
      escapeHTML(summary.duplicates || 0) +
      "</strong></span>" +
      "<span>مرفوضة: <strong>" +
      escapeHTML(summary.rejected || 0) +
      "</strong></span>" +
      "</div>";
    if (rejected.length) {
      html +=
        '<details class="import-rejected"><summary>عرض السجلات المرفوضة (' +
        rejected.length +
        ")</summary><ul>" +
        rejected
          .map(function (result) {
            return (
              "<li>السجل رقم " +
              escapeHTML(result.index + 1) +
              ": " +
              escapeHTML(result.reason || "سبب غير معروف") +
              "</li>"
            );
          })
          .join("") +
        "</ul></details>";
    }
    if (outcome.warnings && outcome.warnings.length) {
      html +=
        '<details class="import-rejected"><summary>تحذيرات (' +
        outcome.warnings.length +
        ")</summary><ul>" +
        outcome.warnings
          .map(function (warning) {
            return "<li>" + escapeHTML(warning) + "</li>";
          })
          .join("") +
        "</ul></details>";
    }
    if (isLegacy && summary.documentsImported > 0) {
      html +=
        '<p class="hint">يمكنك الآن حذف نسخة المتصفح القديمة من هذا الجهاز بالزر المجاور.</p>';
    }
    container.innerHTML = html;
  }

  function clearLegacyBrowserCopy() {
    confirmDialog("هل تريد حذف نسخة البيانات القديمة من هذا المتصفح؟").then(function (confirmed) {
      if (!confirmed) return;
      try {
        localStorage.removeItem(LEGACY_DOCUMENTS_KEY);
        localStorage.removeItem(LEGACY_DEPARTMENTS_KEY);
      } catch (error) {
        /* التخزين غير متاح. */
      }
      el("legacyResult").hidden = true;
      el("clearLegacyButton").hidden = true;
      updateLegacyStatus();
      toast("تم حذف نسخة المتصفح.");
    });
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
    updateLegacyStatus();
  }

  /* ========================================================================
     التنقل بين الصفحات
     ======================================================================== */
  async function showPage(pageId) {
    // حالة الدور/الإدارة تُقرأ من الخادم عند كل تنقّل، فلا تُبقي جلسة قائمة
    // واجهة إدارية قديمة بعد تغيير الدور أو تعطيل الحساب أو نقل الإدارة.
    if (state.user) await refreshSession();
    if (!PAGE_TITLES[pageId]) pageId = "dashboard";
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
    } else if (pageId === "reports") {
      loadReports();
    } else if (pageId === "users") {
      if (isAdmin()) loadUsers();
    } else if (pageId === "audit") {
      if (isAdmin()) loadAudit();
    } else if (pageId === "settings") {
      loadSettingsPage();
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
        } else if (state.currentPage === "incoming" || state.currentPage === "outgoing" || state.currentPage === "archive") {
          loadDocumentsView(state.currentPage);
        } else if (state.currentPage === "departments") {
          loadDepartmentListPage();
        } else if (state.currentPage === "reports") {
          loadReports();
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

    var openAboutBtn = el("openAboutPageBtn");
    if (openAboutBtn) {
      openAboutBtn.addEventListener("click", function () {
        showPage("about");
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
    if (el("addArchiveDocumentButton")) {
      el("addArchiveDocumentButton").addEventListener("click", function () {
        var defaultType = el("typeFilter") && el("typeFilter").value ? el("typeFilter").value : "incoming";
        openDocumentForm("create", null, defaultType, true);
      });
    }
    if (el("documentType")) {
      el("documentType").addEventListener("change", function () {
        state.documentType = el("documentType").value;
        updateDocumentFormLabels(state.documentType, Boolean(state.editingDocumentId));
      });
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
      if (state.uploadingAttachments) {
        toast("انتظر انتهاء رفع المرفقات قبل إغلاق النافذة.", "error");
        return;
      }
      hideModal("documentModal");
      hideModal("detailModal");
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
        if (action === "edit") openDocumentForm("edit", id);
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
      ["archiveSearch", "archive"],
      ["usersSearch", "users"]
    ];
    searchBindings.forEach(function (binding) {
      var view = state.views[binding[1]];
      el(binding[0]).addEventListener(
        "input",
        debounce(function () {
          view.q = el(binding[0]).value.trim();
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
    el("exportReportsCsvButton").addEventListener("click", function () {
      exportDocumentsCsv(false);
    });
    el("printReportButton").addEventListener("click", function () {
      window.print();
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
    el("exportBackupButton").addEventListener("click", exportBackup);
    el("importBackupButton").addEventListener("click", importBackup);
    el("importLegacyButton").addEventListener("click", importLegacyBrowserData);
    el("clearLegacyButton").addEventListener("click", clearLegacyBrowserCopy);
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
    try {
      await loadSession();
    } catch (error) {
      showLogin();
    } finally {
      el("bootScreen").classList.add("is-hidden");
    }
  }

  boot();
})();
