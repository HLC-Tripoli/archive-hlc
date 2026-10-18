"use strict";
const DATA_KEY = "hl_archive_data_v1";
const DEPT_KEY = "hl_archive_departments_v1";
let documents = [];
let departments = [];
let currentType = "incoming";
let editingId = null;
function loadJSON(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null");
    return value === null ? fallback : value;
  } catch {
    return fallback;
  }
}
documents = loadJSON(DATA_KEY, []);
departments = loadJSON(DEPT_KEY, []);
if (!Array.isArray(documents)) documents = [];
if (!Array.isArray(departments)) departments = [];
function saveData() {
  try {
    localStorage.setItem(DATA_KEY, JSON.stringify(documents));
    localStorage.setItem(DEPT_KEY, JSON.stringify(departments));
    return true;
  } catch {
    toast("تعذر الحفظ. قد تكون مساحة التخزين ممتلئة.");
    return false;
  }
}
function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}
function toast(message) {
  const element = document.getElementById("toast");
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    element.classList.remove("show");
  }, 3000);
}
function todayString() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
document.getElementById("today").textContent =
  "تاريخ اليوم: " + todayString();
document.querySelectorAll(".menu").forEach(button => {
  button.addEventListener("click", () => {
    showPage(button.dataset.page);
  });
});
function showPage(pageId) {
  document.querySelectorAll(".page").forEach(page => {
    page.classList.toggle("active", page.id === pageId);
  });
  document.querySelectorAll(".menu").forEach(button => {
    button.classList.toggle("active", button.dataset.page === pageId);
  });
  const titles = {
    dashboard: "لوحة التحكم",
    incoming: "المراسلات الواردة",
    outgoing: "المراسلات الصادرة",
    archive: "الأرشيف الإلكتروني",
    departments: "الإدارات والأقسام",
    reports: "التقارير والإحصائيات",
    settings: "إعدادات المنظومة"
  };
  document.getElementById("pageTitle").textContent =
    titles[pageId] || "الأرشيف";
  renderAll();
}
function openForm(type, id = null) {
  currentType = type;
  editingId = id;
  const form = document.getElementById("documentForm");
  form.reset();
  updateDepartmentOptions();
  const doc = id ? documents.find(item => item.id === id) : null;
  document.getElementById("formTitle").textContent =
    doc ? "تعديل بيانات المعاملة" :
    type === "incoming" ? "تسجيل مراسلة واردة" : "تسجيل مراسلة صادرة";
  document.getElementById("type").value = doc ? doc.type : type;
  document.getElementById("reference").value = doc ? doc.reference : "";
  document.getElementById("title").value = doc ? doc.title : "";
  document.getElementById("date").value = doc ? doc.date : todayString();
  document.getElementById("sender").value = doc ? doc.sender : "";
  document.getElementById("recipient").value = doc ? doc.recipient : "";
  document.getElementById("department").value = doc ? doc.department : "";
  document.getElementById("status").value = doc ? doc.status : "جديدة";
  document.getElementById("notes").value = doc ? doc.notes : "";
  document.getElementById("attachment").value = "";
  document.getElementById("documentModal").classList.add("show");
}
function closeForm() {
  document.getElementById("documentModal").classList.remove("show");
  editingId = null;
}
document.getElementById("documentForm").addEventListener("submit", event => {
  event.preventDefault();
  const reference = document.getElementById("reference").value.trim();
  const title = document.getElementById("title").value.trim();
  const type = document.getElementById("type").value;
  const duplicate = documents.some(doc =>
    doc.reference.toLowerCase() === reference.toLowerCase() &&
    doc.id !== editingId
  );
  if (duplicate) {
    toast("رقم المعاملة مستخدم بالفعل.");
    return;
  }
  const file = document.getElementById("attachment").files[0];
  const oldDoc = editingId
    ? documents.find(doc => doc.id === editingId)
    : null;
  const record = {
    id: editingId || (
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : String(Date.now())
    ),
    reference,
    title,
    type,
    date: document.getElementById("date").value,
    sender: document.getElementById("sender").value.trim(),
    recipient: document.getElementById("recipient").value.trim(),
    department: document.getElementById("department").value,
    status: document.getElementById("status").value,
    notes: document.getElementById("notes").value.trim(),
    attachmentName: file ? file.name : oldDoc ? oldDoc.attachmentName : "",
    createdAt: oldDoc ? oldDoc.createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  if (editingId) {
    documents = documents.map(doc => doc.id === editingId ? record : doc);
  } else {
    documents.push(record);
  }
  if (!saveData()) return;
  closeForm();
  renderAll();
  toast(editingId ? "تم تحديث المعاملة." : "تم تسجيل المعاملة بنجاح.");
});
function statusClass(status) {
  if (status === "مكتملة") return "completed";
  if (status === "مؤرشفة") return "archived";
  return "";
}
function getDepartmentName(id) {
  const department = departments.find(item => item.id === id);
  return department ? department.name : "غير محددة";
}
function matchesSearch(doc, query) {
  if (!query) return true;
  const text = [
    doc.reference,
    doc.title,
    doc.sender,
    doc.recipient,
    doc.date,
    doc.notes,
    getDepartmentName(doc.department)
  ].join(" ").toLowerCase();
  return text.includes(query.toLowerCase());
}
function documentRow(doc) {
  const typeName = doc.type === "incoming" ? "وارد" : "صادر";
  return `
    <tr>
      <td>${escapeHTML(doc.reference)}</td>
      <td>${escapeHTML(doc.title)}</td>
      <td>${typeName}</td>
      <td>${escapeHTML(doc.date)}</td>
      <td>
        <span class="status ${statusClass(doc.status)}">
          ${escapeHTML(doc.status)}
        </span>
      </td>
      <td>${escapeHTML(getDepartmentName(doc.department))}</td>
      <td>
        <div class="action-buttons">
          <button class="small-button" data-action="view" data-id="${escapeHTML(doc.id)}">عرض</button>
          <button class="small-button" data-action="edit" data-id="${escapeHTML(doc.id)}">تعديل</button>
          <button class="small-button delete-button" data-action="delete" data-id="${escapeHTML(doc.id)}">حذف</button>
        </div>
      </td>
    </tr>
  `;
}
function renderTable(targetId, list) {
  const target = document.getElementById(targetId);
  if (!list.length) {
    target.innerHTML = '<div class="empty">لا توجد معاملات لعرضها.</div>';
    return;
  }
  target.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>رقم المعاملة</th>
            <th>العنوان</th>
            <th>النوع</th>
            <th>التاريخ</th>
            <th>الحالة</th>
            <th>الإدارة</th>
            <th>الإجراءات</th>
          </tr>
        </thead>
        <tbody>${list.map(documentRow).join("")}</tbody>
      </table>
    </div>
  `;
}
function renderAll() {
  const incoming = documents.filter(doc => doc.type === "incoming");
  const outgoing = documents.filter(doc => doc.type === "outgoing");
  const pending = documents.filter(doc => doc.status === "قيد الإجراء");
  document.getElementById("incomingCount").textContent = incoming.length;
  document.getElementById("outgoingCount").textContent = outgoing.length;
  document.getElementById("totalCount").textContent = documents.length;
  document.getElementById("pendingCount").textContent = pending.length;
  const latest = [...documents]
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
    .filter(doc => matchesSearch(
      doc,
      document.getElementById("dashboardSearch").value.trim()
    ))
    .slice(0, 10);
  renderTable("dashboardTable", latest);
  renderTable("incomingTable", incoming);
  renderTable("outgoingTable", outgoing);
  const query = document.getElementById("archiveSearch").value.trim();
  const type = document.getElementById("typeFilter").value;
  const status = document.getElementById("statusFilter").value;
  const archive = documents.filter(doc =>
    matchesSearch(doc, query) &&
    (!type || doc.type === type) &&
    (!status || doc.status === status)
  );
  renderTable("archiveTable", archive);
  renderDepartments();
  renderReports();
}
function renderReports() {
  document.getElementById("reportTotal").textContent = documents.length;
  document.getElementById("reportCompleted").textContent =
    documents.filter(doc => doc.status === "مكتملة").length;
  document.getElementById("reportPending").textContent =
    documents.filter(doc => doc.status === "قيد الإجراء").length;
  document.getElementById("reportArchived").textContent =
    documents.filter(doc => doc.status === "مؤرشفة").length;
}
document.getElementById("dashboardSearch").addEventListener("input", renderAll);
document.getElementById("archiveSearch").addEventListener("input", renderAll);
document.getElementById("typeFilter").addEventListener("change", renderAll);
document.getElementById("statusFilter").addEventListener("change", renderAll);
document.addEventListener("click", event => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const id = button.dataset.id;
  const action = button.dataset.action;
  const doc = documents.find(item => item.id === id);
  if (!doc) return;
  if (action === "view") {
    alert(
      "رقم المعاملة: " + doc.reference +
      "\nالعنوان: " + doc.title +
      "\nالنوع: " + (doc.type === "incoming" ? "وارد" : "صادر") +
      "\nالتاريخ: " + doc.date +
      "\nالجهة المرسلة: " + (doc.sender || "غير محددة") +
      "\nالجهة المستلمة: " + (doc.recipient || "غير محددة") +
      "\nالإدارة: " + getDepartmentName(doc.department) +
      "\nالحالة: " + doc.status +
      "\nالمرفق: " + (doc.attachmentName || "لا يوجد") +
      "\nالملاحظات: " + (doc.notes || "لا توجد")
    );
  }
  if (action === "edit") {
    openForm(doc.type, doc.id);
  }
  if (action === "delete") {
    if (!confirm("هل أنت متأكد من حذف هذه المعاملة؟")) return;
    documents = documents.filter(item => item.id !== id);
    if (saveData()) {
      renderAll();
      toast("تم حذف المعاملة من النسخة التجريبية.");
    }
  }
});
document.getElementById("departmentForm").addEventListener("submit", event => {
  event.preventDefault();
  const input = document.getElementById("departmentName");
  const name = input.value.trim();
  if (!name) return;
  if (departments.some(dep => dep.name.toLowerCase() === name.toLowerCase())) {
    toast("الإدارة موجودة بالفعل.");
    return;
  }
  departments.push({
    id: String(Date.now()),
    name
  });
  if (saveData()) {
    input.value = "";
    renderAll();
    toast("تمت إضافة الإدارة.");
  }
});
function renderDepartments() {
  const list = document.getElementById("departmentList");
  if (!departments.length) {
    list.innerHTML = '<div class="empty">لم تتم إضافة إدارات بعد.</div>';
    updateDepartmentOptions();
    return;
  }
  list.innerHTML = departments.map(dep => `
    <div class="department-item">
      <span>${escapeHTML(dep.name)}</span>
      <button class="small-button delete-button"
        data-department-delete="${escapeHTML(dep.id)}">حذف</button>
    </div>
  `).join("");
  updateDepartmentOptions();
}
function updateDepartmentOptions() {
  const select = document.getElementById("department");
  const current = select.value;
  select.innerHTML = '<option value="">غير محددة</option>';
  departments.forEach(dep => {
    const option = document.createElement("option");
    option.value = dep.id;
    option.textContent = dep.name;
    select.appendChild(option);
  });
  select.value = current;
}
document.addEventListener("click", event => {
  const button = event.target.closest("[data-department-delete]");
  if (!button) return;
  const id = button.dataset.departmentDelete;
  if (documents.some(doc => doc.department === id)) {
    toast("لا يمكن حذف الإدارة لأنها مرتبطة بمعاملات.");
    return;
  }
  if (!confirm("هل تريد حذف هذه الإدارة؟")) return;
  departments = departments.filter(dep => dep.id !== id);
  if (saveData()) {
    renderAll();
    toast("تم حذف الإدارة.");
  }
});
function downloadFile(filename, content, type) {
  const blob = new Blob(["\uFEFF", content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportCSV() {
  const rows = [
    ["رقم المعاملة", "العنوان", "النوع", "التاريخ", "الجهة المرسلة",
      "الجهة المستلمة", "الإدارة", "الحالة", "اسم المرفق", "ملاحظات"],
    ...documents.map(doc => [
      doc.reference,
      doc.title,
      doc.type === "incoming" ? "وارد" : "صادر",
      doc.date,
      doc.sender,
      doc.recipient,
      getDepartmentName(doc.department),
      doc.status,
      doc.attachmentName,
      doc.notes
    ])
  ];
  const csv = rows.map(row =>
    row.map(value => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")
  ).join("\r\n");
  downloadFile("archive-report.csv", csv, "text/csv;charset=utf-8;");
  toast("تم تجهيز ملف CSV.");
}
function backupData() {
  const backup = {
    version: 1,
    exportedAt: new Date().toISOString(),
    documents,
    departments
  };
  downloadFile(
    "archive-backup.json",
    JSON.stringify(backup, null, 2),
    "application/json"
  );
}
function restoreData() {
  const input = document.getElementById("restoreFile");
  const file = input.files[0];
  if (!file) {
    toast("اختر ملف النسخة الاحتياطية أولاً.");
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (
        !data ||
        !Array.isArray(data.documents) ||
        !Array.isArray(data.departments)
      ) {
        throw new Error("Invalid backup");
      }
      if (!confirm("ستُستبدل البيانات الحالية بمحتويات النسخة الاحتياطية. هل تريد المتابعة؟")) {
        return;
      }
      const oldDocuments = documents;
      const oldDepartments = departments;
      documents = data.documents;
      departments = data.departments;
      if (!saveData()) {
        documents = oldDocuments;
        departments = oldDepartments;
        saveData();
        return;
      }
      renderAll();
      toast("تمت استعادة البيانات.");
      input.value = "";
    } catch {
      toast("ملف النسخة الاحتياطية غير صالح.");
    }
  };
  reader.readAsText(file);
}
function clearAllData() {
  if (!confirm("تحذير: سيتم حذف جميع المعاملات والإدارات. هل تريد المتابعة؟")) {
    return;
  }
  documents = [];
  departments = [];
  if (saveData()) {
    renderAll();
    toast("تم مسح البيانات التجريبية.");
  }
}
document.getElementById("documentModal").addEventListener("click", event => {
  if (event.target.id === "documentModal") closeForm();
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape") closeForm();
});
renderAll();
// تسجيل دخول تجريبي للواجهة فقط.
// لا يوفر حماية حقيقية للبيانات.
const demoUsers = [
  {
    username: "admin",
    password: "1234",
    role: "admin",
    displayName: "مدير النظام"
  },
  {
    username: "employee",
    password: "1234",
    role: "employee",
    displayName: "موظف الأرشيف"
  }
];
const loginScreen = document.getElementById("loginScreen");
const loginForm = document.getElementById("loginForm");
const loginMessage = document.getElementById("loginMessage");
loginForm.addEventListener("submit", function (event) {
  event.preventDefault();
  const username = document
    .getElementById("loginUsername")
    .value.trim();
  const password = document
    .getElementById("loginPassword")
    .value;
  const user = demoUsers.find(item =>
    item.username === username &&
    item.password === password
  );
  if (!user) {
    loginMessage.textContent =
      "اسم المستخدم أو كلمة المرور غير صحيحة.";
    return;
  }
  // هذه الجلسة التجريبية لا تحمي البيانات من التلاعب.
  sessionStorage.setItem(
    "demoArchiveUser",
    JSON.stringify({
      username: user.username,
      role: user.role,
      displayName: user.displayName
    })
  );
  loginMessage.textContent = "";
  loginScreen.style.display = "none";
  document.querySelector(".user-badge strong").textContent =
    user.displayName;
  applyDemoPermissions(user.role);
  toast("تم تسجيل الدخول إلى الواجهة التجريبية.");
});
function applyDemoPermissions(role) {
  const buttons = document.querySelectorAll(".menu");
  buttons.forEach(button => {
    button.style.display = "";
  });
  // الموظف التجريبي لا يرى قائمة الإعدادات.
  if (role === "employee") {
    const settingsButton = document.querySelector(
      '.menu[data-page="settings"]'
    );
    if (settingsButton) {
      settingsButton.style.display = "none";
    }
  }
}
function demoLogout() {
  sessionStorage.removeItem("demoArchiveUser");
  location.reload();
}
// إضافة زر الخروج إلى بطاقة المستخدم.
(function addLogoutButton() {
  const badge = document.querySelector(".user-badge");
  if (!badge) return;
  const button = document.createElement("button");
  button.className = "logout-button";
  button.textContent = "تسجيل الخروج";
  button.type = "button";
  button.addEventListener("click", demoLogout);
  badge.appendChild(button);
})();
// عند فتح الصفحة، تظهر شاشة الدخول دائمًا.
loginScreen.style.display = "flex";