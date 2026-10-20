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
  var PAGE_TITLES = {
    dashboard: "لوحة التحكم",
    incoming: "المراسلات الواردة",
    outgoing: "المراسلات الصادرة",
    archive: "الأرشيف الإلكتروني",
    departments: "الإدارات والأقسام",
    reports: "التقارير والإحصائيات",
    users: "إدارة المستخدمين",
    audit: "سجل التدقيق",
    settings: "إعدادات المنظومة"
  };
  var TYPE_LABELS = { incoming: "وارد", outgoing: "صادر" };
  var STATUS_LABELS = {
    new: "جديدة",
    in_progress: "قيد الإجراء",
    completed: "مكتملة",
    archived: "مؤرشفة"
  };
  var ROLE_LABELS = { admin: "مدير النظام", employee: "موظف الأرشيف" };
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
  var LEGACY_DOCUMENTS_KEY = "hl_archive_data_v1";
  var LEGACY_DEPARTMENTS_KEY = "hl_archive_departments_v1";

  /* ========================================================================
     الحالة العامة
     ======================================================================== */
  var state = {
    user: null,
    currentPage: "dashboard",
    departments: [],
    views: {
      dashboard: { page: 1, pageSize: 8, q: "", total: 0 },
      incoming: { page: 1, pageSize: 10, q: "", total: 0 },
      outgoing: { page: 1, pageSize: 10, q: "", total: 0 },
      archive: {
        page: 1,
        pageSize: 10,
        q: "",
        type: "",
        status: "",
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
    detailDocumentId: null
  };

  function el(id) {
    return document.getElementById(id);
  }

  function isAdmin() {
    return Boolean(state.user && state.user.role === "admin");
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

  function formatDateTime(value) {
    if (!value) return "—";
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    var pad = function (part) {
      return String(part).padStart(2, "0");
    };
    return (
      date.getFullYear() +
      "-" +
      pad(date.getMonth() + 1) +
      "-" +
      pad(date.getDate()) +
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
    container.innerHTML =
      '<button type="button" class="small-button" data-pager="prev"' +
      (view.page <= 1 ? " disabled" : "") +
      ">السابق</button>" +
      '<span class="pager-info">صفحة ' +
      view.page +
      " من " +
      totalPages +
      " — إجمالي " +
      view.total +
      "</span>" +
      '<button type="button" class="small-button" data-pager="next"' +
      (view.page >= totalPages ? " disabled" : "") +
      ">التالي</button>";
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
      el("confirmOk").textContent = confirmLabel || "تأكيد";
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
    document.querySelectorAll(".admin-only").forEach(function (node) {
      node.classList.toggle("is-hidden", !admin);
    });
    el("userName").textContent = state.user.displayName;
    el("userRoleLabel").textContent = ROLE_LABELS[state.user.role] || state.user.role;
    var firstLetter = state.user.displayName.trim().charAt(0);
    el("userAvatar").textContent = firstLetter || "؟";
  }

  async function loadSession() {
    var session = await api.get("/auth/session");
    api.setCsrfToken(session.csrfToken);
    state.user = session.user;
    showApp();
    applyRoleUI();
    showPage("dashboard");
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
    showLogin();
    toast("تم تسجيل الخروج.");
  }

  /* ========================================================================
     الإدارات (تحميل مشترك + صفحة الإدارة)
     ======================================================================== */
  async function loadDepartmentsForSelects() {
    try {
      var data = await api.get("/departments", {});
      state.departments = data.items;
      fillDepartmentSelects();
    } catch (error) {
      /* الفلاتر تبقى فارغة عند تعذّر التحميل؛ لا نُفزع المستخدم برسالة. */
    }
  }

  function fillDepartmentSelects() {
    var archiveSelect = el("departmentFilter");
    var currentArchive = archiveSelect.value;
    archiveSelect.innerHTML = '<option value="">جميع الإدارات</option>';
    var formSelect = el("department");
    var currentForm = formSelect.value;
    formSelect.innerHTML = '<option value="">غير محددة</option>';
    state.departments.forEach(function (department) {
      var option = document.createElement("option");
      option.value = department.id;
      option.textContent = department.name;
      archiveSelect.appendChild(option);
      formSelect.appendChild(option.cloneNode(true));
    });
    archiveSelect.value = currentArchive;
    formSelect.value = currentForm;
  }

  async function loadDepartmentListPage() {
    var container = el("departmentList");
    var includeInactive = isAdmin() && el("includeInactiveDepartments").checked;
    renderLoading(container, "جارٍ تحميل الإدارات…");
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
      renderEmpty(container, "لم تتم إضافة إدارات بعد.");
      return;
    }
    container.innerHTML = items
      .map(function (department) {
        var actions = "";
        if (isAdmin()) {
          actions =
            '<button type="button" class="small-button" data-dept-action="rename" data-id="' +
            escapeHTML(department.id) +
            '">تعديل الاسم</button>' +
            '<button type="button" class="small-button" data-dept-action="toggle" data-id="' +
            escapeHTML(department.id) +
            '">' +
            (department.isActive ? "تعطيل" : "تفعيل") +
            "</button>" +
            '<button type="button" class="small-button delete-button" data-dept-action="delete" data-id="' +
            escapeHTML(department.id) +
            '">حذف</button>';
        }
        return (
          '<div class="department-item">' +
          '<div class="department-meta">' +
          "<strong>" +
          escapeHTML(department.name) +
          "</strong>" +
          '<small>عدد المعاملات: ' +
          escapeHTML(department.documentCount) +
          "</small>" +
          (department.isActive
            ? ""
            : ' <span class="badge badge-inactive">معطّلة</span>') +
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
  var DOC_COLUMNS = [
    "رقم المعاملة",
    "العنوان",
    "النوع",
    "التاريخ",
    "الحالة",
    "الإدارة",
    "الإجراءات"
  ];

  function renderDocuments(container, items) {
    if (!items.length) {
      renderEmpty(container, "لا توجد معاملات لعرضها.");
      return;
    }
    var admin = isAdmin();
    var rows = items
      .map(function (document) {
        var deleted = Boolean(document.deletedAt);
        var statusClass =
          document.status === "completed" || document.status === "archived"
            ? document.status
            : "";
        var actions = [
          '<button type="button" class="small-button" data-doc-action="view" data-id="' +
            escapeHTML(document.id) +
            '">عرض</button>'
        ];
        if (!deleted) {
          actions.push(
            '<button type="button" class="small-button" data-doc-action="edit" data-id="' +
              escapeHTML(document.id) +
              '">تعديل</button>'
          );
        }
        if (admin) {
          if (deleted) {
            actions.push(
              '<button type="button" class="small-button" data-doc-action="restore" data-id="' +
                escapeHTML(document.id) +
                '">استعادة</button>'
            );
          } else {
            actions.push(
              '<button type="button" class="small-button delete-button" data-doc-action="delete" data-id="' +
                escapeHTML(document.id) +
                '">حذف</button>'
            );
          }
        }
        return (
          "<tr" +
          (deleted ? ' class="row-deleted"' : "") +
          "><td>" +
          escapeHTML(document.reference) +
          "</td><td>" +
          escapeHTML(document.title) +
          (deleted ? ' <span class="badge badge-deleted">محذوفة</span>' : "") +
          "</td><td>" +
          escapeHTML(TYPE_LABELS[document.type] || document.type) +
          "</td><td>" +
          escapeHTML(document.date) +
          '</td><td><span class="status ' +
          statusClass +
          '">' +
          escapeHTML(STATUS_LABELS[document.status] || document.status) +
          "</span></td><td>" +
          escapeHTML(document.department ? document.department.name : "غير محددة") +
          '</td><td><div class="action-buttons">' +
          actions.join("") +
          "</div></td></tr>"
        );
      })
      .join("");
    container.innerHTML =
      '<div class="table-wrap"><table><thead><tr>' +
      DOC_COLUMNS.map(function (column) {
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
      status: view.status,
      departmentId: view.departmentId,
      dateFrom: view.dateFrom,
      dateTo: view.dateTo,
      sort: view.sort,
      order: view.order,
      includeDeleted: view.includeDeleted ? true : undefined,
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
      el("totalCount").textContent = stats.activeDocuments;
      el("pendingCount").textContent = stats.byStatus ? stats.byStatus.in_progress : 0;
    } catch (error) {
      /* البطاقات تبقى بآخر قيمة معروفة. */
    }
  }

  async function loadReports() {
    try {
      var summary = await api.get("/reports/summary", {});
      var statusCount = function (status) {
        var entry = (summary.byStatus || []).find(function (row) {
          return row.status === status;
        });
        return entry ? entry.count : 0;
      };
      el("reportTotal").textContent = summary.total;
      el("reportCompleted").textContent = statusCount("completed");
      el("reportPending").textContent = statusCount("in_progress");
      el("reportArchived").textContent = statusCount("archived");
      renderReportList(
        "reportByType",
        (summary.byType || []).map(function (row) {
          return { label: TYPE_LABELS[row.type] || row.type, count: row.count };
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
      container.innerHTML = '<div class="empty">لا توجد بيانات.</div>';
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
  async function openDocumentForm(mode, documentId, defaultType) {
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
    var form = el("documentForm");
    form.reset();
    showFormError("documentFormError", "");
    await loadDepartmentsForSelects();

    el("formTitle").textContent = doc
      ? "تعديل بيانات المعاملة"
      : defaultType === "outgoing"
        ? "تسجيل مراسلة صادرة"
        : "تسجيل مراسلة واردة";
    el("type").value = doc ? doc.type : defaultType || "incoming";
    el("reference").value = doc ? doc.reference : "";
    el("title").value = doc ? doc.title : "";
    el("date").value = doc ? doc.date : todayString();
    el("sender").value = doc ? doc.sender : "";
    el("recipient").value = doc ? doc.recipient : "";
    el("department").value = doc && doc.department ? doc.department.id : "";
    el("status").value = doc ? doc.status : "new";
    el("notes").value = doc ? doc.notes : "";

    var attachmentsSection = el("attachmentsSection");
    var attachmentInput = el("attachmentInput");
    var attachmentHint = el("attachmentHint");
    attachmentInput.value = "";
    attachmentsSection.hidden = false;
    if (doc) {
      el("attachmentUploadButton").hidden = false;
      attachmentHint.textContent =
        "يتم رفع الملفات فوراً إلى الخادم. الحد الأقصى لحجم الملف يحدده إعداد الخادم (UPLOAD_MAX_MB).";
      await refreshAttachmentList(doc.id);
    } else {
      // وضع الإنشاء: يختار المستخدم الملفات الآن وتُرفع تلقائياً بعد حفظ المعاملة.
      el("attachmentUploadButton").hidden = true;
      attachmentHint.textContent =
        "اختر الملفات المطلوبة؛ ستُرفع تلقائياً عند حفظ المعاملة. الحد الأقصى لحجم الملف يحدده إعداد الخادم (UPLOAD_MAX_MB).";
      renderEmpty(el("attachmentList"), "لم تُحدد ملفات بعد.");
    }
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
      renderEmpty(container, "لا توجد مرفقات لهذه المعاملة.");
      return;
    }
    container.innerHTML = files
      .map(function (file) {
        var deleteButton = "";
        if (isAdmin()) {
          deleteButton =
            '<button type="button" class="small-button delete-button" data-file-action="delete" data-id="' +
            escapeHTML(file.id) +
            '">حذف</button>';
        }
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
          '<button type="button" class="small-button" data-file-action="download" data-id="' +
          escapeHTML(file.id) +
          '">تنزيل</button>' +
          deleteButton +
          "</div></div>"
        );
      })
      .join("");
  }

  /** عرض الملفات المختارة في وضع الإنشاء (تُرفع تلقائياً عند حفظ المعاملة). */
  function renderPendingAttachments(files) {
    var container = el("attachmentList");
    if (!files.length) {
      renderEmpty(container, "لم تُحدد ملفات بعد.");
      return;
    }
    container.innerHTML = files
      .map(function (file) {
        return (
          '<div class="attachment-item"><div class="attachment-meta"><strong>' +
          escapeHTML(file.name) +
          "</strong><small>" +
          escapeHTML(formatBytes(file.size)) +
          " — ستُرفع عند حفظ المعاملة</small></div></div>"
        );
      })
      .join("");
  }

  async function submitDocumentForm(event) {
    event.preventDefault();
    var button = el("saveDocumentButton");
    showFormError("documentFormError", "");
    var payload = {
      reference: el("reference").value.trim(),
      title: el("title").value.trim(),
      type: el("type").value,
      date: el("date").value,
      sender: el("sender").value.trim(),
      recipient: el("recipient").value.trim(),
      departmentId: el("department").value || null,
      status: el("status").value,
      notes: el("notes").value.trim()
    };
    // في وضع الإنشاء: الملفات المختارة تُرفع بعد إنشاء المعاملة مباشرة.
    var pendingFiles = state.editingDocumentId
      ? []
      : Array.prototype.slice.call(el("attachmentInput").files || []);
    setBusy(button, true, pendingFiles.length ? "جارٍ الحفظ والرفع…" : "جارٍ الحفظ…");
    try {
      if (state.editingDocumentId) {
        await api.patch("/documents/" + state.editingDocumentId, payload);
        toast("تم تحديث المعاملة.");
      } else {
        var created = await api.post("/documents", payload);
        var newDocumentId =
          created && created.document && created.document.id ? created.document.id : null;
        var uploaded = 0;
        var failedNames = [];
        var lastUploadError = null;
        for (var index = 0; index < pendingFiles.length && newDocumentId; index += 1) {
          var formData = new FormData();
          formData.append("file", pendingFiles[index]);
          try {
            await api.postForm("/documents/" + newDocumentId + "/files", formData);
            uploaded += 1;
          } catch (uploadError) {
            lastUploadError = uploadError;
            failedNames.push(pendingFiles[index].name);
          }
        }
        if (!newDocumentId && pendingFiles.length) {
          failedNames = pendingFiles.map(function (file) {
            return file.name;
          });
        }
        if (failedNames.length) {
          toast(
            "تم تسجيل المعاملة، لكن تعذّر رفع: " +
              failedNames.join("، ") +
              (lastUploadError ? " — " + errorMessage(lastUploadError) : ""),
            "error"
          );
        } else if (uploaded > 0) {
          toast(
            uploaded === 1
              ? "تم تسجيل المعاملة ورفع المرفق."
              : "تم تسجيل المعاملة ورفع " + uploaded + " مرفقات."
          );
        } else {
          toast("تم تسجيل المعاملة بنجاح.");
        }
      }
      hideModal("documentModal");
      refreshDocumentsAndStats();
    } catch (error) {
      showFormError("documentFormError", errorMessage(error));
    } finally {
      setBusy(button, false);
    }
  }

  async function uploadSelectedAttachments() {
    var documentId = state.editingDocumentId;
    var input = el("attachmentInput");
    if (!documentId || !input.files || !input.files.length) {
      toast("اختر ملفاً واحداً على الأقل أولاً.", "error");
      return;
    }
    var button = el("attachmentUploadButton");
    var files = Array.prototype.slice.call(input.files);
    setBusy(button, true, "جارٍ الرفع…");
    var uploaded = 0;
    try {
      for (var index = 0; index < files.length; index += 1) {
        var formData = new FormData();
        formData.append("file", files[index]);
        await api.postForm("/documents/" + documentId + "/files", formData);
        uploaded += 1;
      }
      toast(
        uploaded === 1
          ? "تم رفع المرفق."
          : "تم رفع " + uploaded + " مرفقات."
      );
      input.value = "";
      await refreshAttachmentList(documentId);
      refreshDocumentsAndStats();
    } catch (error) {
      toast(
        (uploaded > 0 ? "تم رفع " + uploaded + " ملفاً، " : "") + errorMessage(error),
        "error"
      );
      await refreshAttachmentList(documentId);
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

  async function deleteFile(fileId) {
    var confirmed = await confirmDialog("هل تريد حذف هذا المرفق نهائياً؟");
    if (!confirmed) return;
    try {
      await api.del("/files/" + fileId);
      toast("تم حذف المرفق.");
      if (state.editingDocumentId) await refreshAttachmentList(state.editingDocumentId);
      refreshDocumentsAndStats();
    } catch (error) {
      toast(errorMessage(error), "error");
    }
  }

  async function openDocumentDetail(documentId) {
    var container = el("detailContent");
    state.detailDocumentId = documentId;
    renderLoading(container, "جارٍ تحميل التفاصيل…");
    el("detailActions").innerHTML = "";
    showModal("detailModal");
    try {
      var data = await api.get("/documents/" + documentId);
      var doc = data.document;
      var deleted = Boolean(doc.deletedAt);
      el("detailTitle").textContent = "تفاصيل المعاملة " + doc.reference;
      var fields = [
        ["رقم المعاملة", doc.reference],
        ["العنوان", doc.title],
        ["النوع", TYPE_LABELS[doc.type] || doc.type],
        ["التاريخ", doc.date],
        ["الحالة", STATUS_LABELS[doc.status] || doc.status],
        ["الإدارة", doc.department ? doc.department.name : "غير محددة"],
        ["الجهة المرسلة", doc.sender || "—"],
        ["الجهة المستلمة", doc.recipient || "—"],
        ["الملاحظات", doc.notes || "—"],
        ["سُجلت بواسطة", doc.createdByName || "—"],
        ["تاريخ التسجيل", formatDateTime(doc.createdAt)],
        ["آخر تعديل بواسطة", doc.updatedByName || "—"],
        ["تاريخ آخر تعديل", formatDateTime(doc.updatedAt)]
      ];
      if (deleted) {
        fields.push(["حُذفت بواسطة", doc.deletedByName || "—"]);
        fields.push(["تاريخ الحذف", formatDateTime(doc.deletedAt)]);
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
                '<button type="button" class="small-button" data-file-action="download" data-id="' +
                escapeHTML(file.id) +
                '">تنزيل</button></div></div>'
              );
            })
            .join("")
        : '<div class="empty">لا توجد مرفقات.</div>';
      container.innerHTML =
        '<div class="detail-grid">' +
        details +
        '</div><h3 class="detail-subtitle">المرفقات</h3><div class="attachment-list">' +
        attachments +
        "</div>";

      var actions = [];
      if (!deleted) {
        actions.push(
          '<button type="button" class="button" id="detailEditButton">تعديل</button>'
        );
      }
      if (isAdmin()) {
        if (deleted) {
          actions.push(
            '<button type="button" class="button" id="detailRestoreButton">استعادة</button>'
          );
        } else {
          actions.push(
            '<button type="button" class="button danger-button" id="detailDeleteButton">حذف</button>'
          );
        }
      }
      actions.push(
        '<button type="button" class="button secondary-button" id="detailCloseButton">إغلاق</button>'
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
      renderEmpty(container, "لا يوجد مستخدمون مطابقون.");
      return;
    }
    var rows = items
      .map(function (user) {
        var isSelf = state.user && user.id === state.user.id;
        var actions = [
          '<button type="button" class="small-button" data-user-action="edit" data-id="' +
            escapeHTML(user.id) +
            '">تعديل</button>',
          '<button type="button" class="small-button" data-user-action="password" data-id="' +
            escapeHTML(user.id) +
            '">إعادة تعيين كلمة المرور</button>',
          '<button type="button" class="small-button' +
            (user.isActive ? " delete-button" : "") +
            '" data-user-action="toggle" data-id="' +
            escapeHTML(user.id) +
            '"' +
            (isSelf ? " disabled" : "") +
            ">" +
            (user.isActive ? "تعطيل" : "تفعيل") +
            "</button>"
        ];
        var employeeNumber = user.employeeNumber
          ? escapeHTML(user.employeeNumber)
          : '<span class="muted">غير محدد</span>';
        return (
          "<tr><td>" +
          escapeHTML(user.username) +
          "</td><td>" +
          employeeNumber +
          "</td><td>" +
          escapeHTML(user.displayName) +
          '</td><td><span class="badge badge-' +
          (user.role === "admin" ? "admin" : "employee") +
          '">' +
          escapeHTML(ROLE_LABELS[user.role] || user.role) +
          "</span></td><td>" +
          '<span class="badge badge-' +
          (user.isActive ? "active" : "inactive") +
          '">' +
          (user.isActive ? "نشِط" : "معطَّل") +
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
    container.innerHTML =
      '<div class="table-wrap"><table><thead><tr>' +
      "<th>اسم المستخدم</th><th>الرقم الوظيفي</th><th>الاسم الكامل</th><th>الدور</th><th>الحالة</th><th>تاريخ الإنشاء</th><th>آخر دخول</th><th>الإجراءات</th>" +
      "</tr></thead><tbody>" +
      rows +
      "</tbody></table></div>";
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
      if (state.editingUserId) {
        await api.patch("/users/" + state.editingUserId, {
          displayName: el("userDisplayName").value.trim(),
          employeeNumber: employeeNumber,
          role: el("userRole").value
        });
        toast("تم تحديث بيانات المستخدم.");
      } else {
        await api.post("/users", {
          username: el("userUsername").value.trim(),
          displayName: el("userDisplayName").value.trim(),
          employeeNumber: employeeNumber,
          role: el("userRole").value,
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
      renderEmpty(container, "لا توجد سجلات مطابقة.");
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
          escapeHTML(ACTION_LABELS[entry.action] || entry.action) +
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
    container.innerHTML =
      '<div class="table-wrap"><table><thead><tr>' +
      "<th>الوقت</th><th>المستخدم</th><th>العملية</th><th>الكيان</th><th>التفاصيل</th><th>عنوان IP</th>" +
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
    updateLegacyStatus();
  }

  /* ========================================================================
     التنقل بين الصفحات
     ======================================================================== */
  function showPage(pageId) {
    if (!PAGE_TITLES[pageId]) pageId = "dashboard";
    state.currentPage = pageId;
    document.querySelectorAll(".page").forEach(function (page) {
      page.classList.toggle("active", page.id === pageId);
    });
    document.querySelectorAll(".menu").forEach(function (button) {
      button.classList.toggle("active", button.dataset.page === pageId);
    });
    el("pageTitle").textContent = PAGE_TITLES[pageId];
    if (pageId === "dashboard") {
      loadDashboardStats();
      loadDocumentsView("dashboard");
    } else if (pageId === "incoming" || pageId === "outgoing") {
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

  /* ========================================================================
     الربط بالأحداث
     ======================================================================== */
  function bindEvents() {
    el("loginForm").addEventListener("submit", doLogin);
    el("logoutButton").addEventListener("click", doLogout);

    document.querySelectorAll(".menu").forEach(function (button) {
      button.addEventListener("click", function () {
        showPage(button.dataset.page);
      });
    });

    el("addDocumentButton").addEventListener("click", function () {
      openDocumentForm("create", null, "incoming");
    });
    el("addIncomingButton").addEventListener("click", function () {
      openDocumentForm("create", null, "incoming");
    });
    el("addOutgoingButton").addEventListener("click", function () {
      openDocumentForm("create", null, "outgoing");
    });

    el("documentForm").addEventListener("submit", submitDocumentForm);
    el("closeDocumentModal").addEventListener("click", function () {
      hideModal("documentModal");
    });
    el("cancelDocumentButton").addEventListener("click", function () {
      hideModal("documentModal");
    });
    el("attachmentUploadButton").addEventListener("click", uploadSelectedAttachments);
    el("attachmentInput").addEventListener("change", function () {
      if (state.editingDocumentId) return;
      renderPendingAttachments(Array.prototype.slice.call(el("attachmentInput").files || []));
    });
    el("documentModal").addEventListener("click", function (event) {
      if (event.target === el("documentModal")) hideModal("documentModal");
    });

    el("closeDetailModal").addEventListener("click", function () {
      hideModal("detailModal");
    });
    el("detailModal").addEventListener("click", function (event) {
      if (event.target === el("detailModal")) hideModal("detailModal");
    });

    el("userForm").addEventListener("submit", submitUserForm);
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
      var fileButton = event.target.closest("[data-file-action]");
      if (fileButton) {
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
      ["statusFilter", "status"],
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
    el("includeDeletedFilter").addEventListener("change", function () {
      state.views.archive.includeDeleted = el("includeDeletedFilter").checked;
      state.views.archive.page = 1;
      loadDocumentsView("archive");
    });
    el("clearArchiveFilters").addEventListener("click", function () {
      el("archiveSearch").value = "";
      el("typeFilter").value = "";
      el("statusFilter").value = "";
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
        status: "",
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
    el("today").textContent = "تاريخ اليوم: " + todayString();
    api.setUnauthorizedHandler(function () {
      if (state.user) {
        toast("انتهت صلاحية الجلسة. الرجاء تسجيل الدخول من جديد.", "error");
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
