import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';
import {
  apiRequest,
  createTestContext,
  createTestUser,
  disposeTestContext,
  ensureMigrated,
  loginClient,
  multipartFixture,
  resetDatabase,
  type AuthedClient,
  type InjectResult,
  type TestContext,
} from './helpers.js';

/**
 * اختبارات أمنية شاملة لعزل الإدارات (المسألة #10).
 * كل اختبار يتحقق من أن الخادم هو مصدر الحقيقة، لا الواجهة ولا الجلسة القديمة
 * ولا أي معرّف أو مرشِّح يرسله العميل.
 */

let context: TestContext;
let adminClient: AuthedClient;
let employeeAClient: AuthedClient;
let employeeBClient: AuthedClient;
let departmentA: string;
let departmentB: string;
let employeeAId: string;

const PNG_BYTES = Buffer.concat([
  Buffer.from('89504e470d0a1a0a', 'hex'),
  Buffer.alloc(64, 3),
]);

before(async () => {
  context = await createTestContext();
  await ensureMigrated(context.pool);
});

beforeEach(async () => {
  await resetDatabase(context.pool);
  await createTestUser(context.pool, { username: 'admin', role: 'admin' });
  adminClient = await loginClient(context.app, 'admin');
  departmentA = await createDepartment('إدارة أ');
  departmentB = await createDepartment('إدارة ب');
  employeeAId = await createTestUser(context.pool, {
    username: 'employee.a',
    departmentId: departmentA,
  });
  await createTestUser(context.pool, {
    username: 'employee.b',
    departmentId: departmentB,
  });
  employeeAClient = await loginClient(context.app, 'employee.a');
  employeeBClient = await loginClient(context.app, 'employee.b');
  context.storage.objects.clear();
  context.storage.failGet = false;
  context.storage.failPut = false;
});

after(async () => {
  await disposeTestContext(context);
});

async function createDepartment(name: string): Promise<string> {
  const response = await apiRequest(context.app, adminClient, 'POST', '/departments', {
    payload: { name },
  });
  assert.equal(response.statusCode, 201, response.body);
  return (response.json() as { department: { id: string } }).department.id;
}

async function createDocument(
  client: AuthedClient,
  reference: string,
  departmentId: string | null,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const response = await apiRequest(context.app, client, 'POST', '/documents', {
    payload: {
      reference,
      title: `معاملة ${reference}`,
      type: 'incoming',
      date: '2026-04-01',
      departmentId,
      ...overrides,
    },
  });
  assert.equal(response.statusCode, 201, response.body);
  return (response.json() as { document: { id: string } }).document.id;
}

function uploadFile(
  client: AuthedClient,
  documentId: string,
  filename = 'scan.png',
): Promise<InjectResult> {
  const fixture = multipartFixture({
    filename,
    contentType: 'image/png',
    content: PNG_BYTES,
  });
  return apiRequest(context.app, client, 'POST', `/documents/${documentId}/files`, {
    payload: fixture.payload,
    headers: fixture.headers,
  });
}

function uploadFileId(response: InjectResult): string {
  assert.equal(response.statusCode, 201, response.body);
  return (response.json() as { file: { id: string } }).file.id;
}

interface DocumentListBody {
  items: Array<{ id: string; reference: string; department: { id: string } | null }>;
  total: number;
}

test('employee list is scoped server-side and no filter, search, sort, or paging parameter expands it', async () => {
  const a1 = await createDocument(adminClient, 'ISO-A-1', departmentA);
  await createDocument(adminClient, 'ISO-A-2', departmentA, {
    type: 'outgoing',
  });
  const b1 = await createDocument(adminClient, 'ISO-B-1', departmentB);
  const nullDoc = await createDocument(adminClient, 'ISO-NULL-1', null);

  const own = await apiRequest(context.app, employeeAClient, 'GET', '/documents');
  assert.equal(own.statusCode, 200, own.body);
  const ownBody = own.json() as DocumentListBody;
  assert.equal(ownBody.total, 2);
  assert.deepEqual(
    ownBody.items.map((item) => item.reference).sort(),
    ['ISO-A-1', 'ISO-A-2'],
  );
  assert.ok(ownBody.items.every((item) => item.department?.id === departmentA));

  const cases = [
    `/documents?departmentId=${departmentB}`,
    `/documents?q=ISO-B-1`,
    `/documents?q=${encodeURIComponent('إدارة ب')}`,
    `/documents?type=outgoing&departmentId=${departmentB}`,
    `/documents?dateFrom=2026-04-01&dateTo=2026-04-30&departmentId=${departmentB}`,
    '/documents?page=99',
    '/documents?pageSize=100&sort=reference&order=asc',
    '/documents?includeDeleted=true',
  ];
  for (const path of cases) {
    const response = await apiRequest(context.app, employeeAClient, 'GET', path);
    assert.equal(response.statusCode, 200, `${path}: ${response.body}`);
    const body = response.json() as DocumentListBody;
    if (path === '/documents?page=99') {
      // الإجمالي يبقى صحيحاً حتى لو كانت الصفحة فارغة.
      assert.equal(body.total, 2);
      assert.equal(body.items.length, 0);
    } else if (
      path.startsWith('/documents?pageSize=100') ||
      path === '/documents?includeDeleted=true'
    ) {
      assert.equal(body.total, 2);
      assert.ok(body.items.every((item) => item.reference.startsWith('ISO-A-')));
    } else {
      assert.equal(body.total, 0, path);
      assert.equal(body.items.length, 0, path);
    }
  }

  // المدير يرى كل الإدارات بما فيها غير المعيّنة.
  const adminList = await apiRequest(
    context.app,
    adminClient,
    'GET',
    '/documents?includeDeleted=true&pageSize=100',
  );
  assert.equal(adminList.statusCode, 200);
  const adminBody = adminList.json() as DocumentListBody;
  assert.equal(adminBody.total, 4);
  const adminIds = new Set(adminBody.items.map((item) => item.id));
  for (const id of [a1, b1, nullDoc]) assert.ok(adminIds.has(id));
});

test('cross-department detail, update, delete visibility, and attachments are not found for employees', async () => {
  const a1 = await createDocument(adminClient, 'ISO-A-DETAIL', departmentA);
  const b1 = await createDocument(adminClient, 'ISO-B-DETAIL', departmentB);
  const deletedA = await createDocument(adminClient, 'ISO-A-DELETED', departmentA);
  const deletedFile = uploadFileId(await uploadFile(adminClient, deletedA));

  // حذف ناعم لإدارة أ: الموظف لا يراه إطلاقاً حتى مع includeDeleted.
  const deleted = await apiRequest(context.app, adminClient, 'DELETE', `/documents/${deletedA}`);
  assert.equal(deleted.statusCode, 200, deleted.body);

  const ownDetail = await apiRequest(context.app, employeeAClient, 'GET', `/documents/${a1}`);
  assert.equal(ownDetail.statusCode, 200);
  const foreignDetail = await apiRequest(context.app, employeeAClient, 'GET', `/documents/${b1}`);
  assert.equal(foreignDetail.statusCode, 404);
  const deletedDetail = await apiRequest(
    context.app,
    employeeAClient,
    'GET',
    `/documents/${deletedA}`,
  );
  assert.equal(deletedDetail.statusCode, 404);

  const foreignUpdate = await apiRequest(context.app, employeeAClient, 'PATCH', `/documents/${b1}`, {
    payload: { title: 'محاولة تعديل خارج الإدارة' },
  });
  assert.equal(foreignUpdate.statusCode, 404);
  const deletedUpdate = await apiRequest(
    context.app,
    employeeAClient,
    'PATCH',
    `/documents/${deletedA}`,
    { payload: { title: 'محاولة تعديل محذوف' } },
  );
  assert.equal(deletedUpdate.statusCode, 404);

  // الموظف لا يملك صلاحية حذف/استعادة أصلاً، ويبقى الفحص على مستوى الدور.
  const employeeDelete = await apiRequest(
    context.app,
    employeeAClient,
    'DELETE',
    `/documents/${a1}`,
  );
  assert.equal(employeeDelete.statusCode, 403);
  const employeeRestore = await apiRequest(
    context.app,
    employeeAClient,
    'POST',
    `/documents/${deletedA}/restore`,
  );
  assert.equal(employeeRestore.statusCode, 403);

  // مرفقات: المدير يرفع لكل إدارة، والموظف يرى مرفق إدارته فقط.
  const aFile = uploadFileId(await uploadFile(adminClient, a1));
  const bFile = uploadFileId(await uploadFile(adminClient, b1));

  const ownDownload = await apiRequest(
    context.app,
    employeeAClient,
    'GET',
    `/files/${aFile}/download`,
  );
  assert.equal(ownDownload.statusCode, 200);
  const foreignDownload = await apiRequest(
    context.app,
    employeeAClient,
    'GET',
    `/files/${bFile}/download`,
  );
  assert.equal(foreignDownload.statusCode, 404);
  const ownView = await apiRequest(
    context.app,
    employeeAClient,
    'GET',
    `/files/${aFile}/view`,
  );
  assert.equal(ownView.statusCode, 200, ownView.body);
  const foreignView = await apiRequest(
    context.app,
    employeeAClient,
    'GET',
    `/files/${bFile}/view`,
  );
  assert.equal(foreignView.statusCode, 404);
  const foreignFileDelete = await apiRequest(
    context.app,
    employeeAClient,
    'DELETE',
    `/files/${bFile}`,
  );
  assert.equal(foreignFileDelete.statusCode, 404);
  const deletedDownload = await apiRequest(
    context.app,
    employeeAClient,
    'GET',
    `/files/${aFile}/download`,
  );
  assert.equal(deletedDownload.statusCode, 200);

  const foreignUpload = await uploadFile(employeeAClient, b1);
  assert.equal(foreignUpload.statusCode, 404);
  const ownUpload = await uploadFile(employeeAClient, a1, 'own.png');
  assert.equal(ownUpload.statusCode, 201, ownUpload.body);
  const ownUploadId = uploadFileId(ownUpload);
  const ownFileDelete = await apiRequest(
    context.app,
    employeeAClient,
    'DELETE',
    `/files/${ownUploadId}`,
  );
  assert.equal(ownFileDelete.statusCode, 200, ownFileDelete.body);
  const foreignFileStillThere = await apiRequest(
    context.app,
    adminClient,
    'GET',
    `/files/${bFile}/download`,
  );
  assert.equal(foreignFileStillThere.statusCode, 200);

  // مرفق مستند محذوف لا يُنزَّل ولا يُحذف للموظف.
  const deletedFileDownload = await apiRequest(
    context.app,
    employeeAClient,
    'GET',
    `/files/${deletedFile}/download`,
  );
  assert.equal(deletedFileDownload.statusCode, 404);
  const deletedFileView = await apiRequest(
    context.app,
    employeeAClient,
    'GET',
    `/files/${deletedFile}/view`,
  );
  assert.equal(deletedFileView.statusCode, 404);
  const deletedFileDelete = await apiRequest(
    context.app,
    employeeAClient,
    'DELETE',
    `/files/${deletedFile}`,
  );
  assert.equal(deletedFileDelete.statusCode, 404);

  // المدير يرى التفاصيل المحذوفة عالمياً.
  const adminDeletedDetail = await apiRequest(
    context.app,
    adminClient,
    'GET',
    `/documents/${deletedA}`,
  );
  assert.equal(adminDeletedDetail.statusCode, 200);
});

test('employee writes always use the current assigned department and cannot move data', async () => {
  const created = await apiRequest(context.app, employeeAClient, 'POST', '/documents', {
    payload: {
      reference: 'ISO-WRITE-1',
      title: 'معاملة بلا إدارة في الطلب',
      type: 'incoming',
      date: '2026-04-02',
    },
  });
  assert.equal(created.statusCode, 201, created.body);
  const createdId = (created.json() as { document: { id: string } }).document.id;
  const detail = await apiRequest(context.app, employeeAClient, 'GET', `/documents/${createdId}`);
  assert.equal(detail.statusCode, 200);
  assert.equal(
    (detail.json() as { document: { department: { id: string } } }).document.department.id,
    departmentA,
  );

  for (const departmentId of [departmentB, null]) {
    const response = await apiRequest(context.app, employeeAClient, 'POST', '/documents', {
      payload: {
        reference: `ISO-WRITE-${departmentId ?? 'NULL'}`,
        title: 'محاولة إدارة غير مسموحة',
        type: 'incoming',
        date: '2026-04-02',
        departmentId,
      },
    });
    assert.equal(response.statusCode, 403, response.body);
    assert.equal(
      (response.json() as { error: { code: string } }).error.code,
      'department_forbidden',
    );
  }

  const move = await apiRequest(context.app, employeeAClient, 'PATCH', `/documents/${createdId}`, {
    payload: { departmentId: departmentB },
  });
  assert.equal(move.statusCode, 403);
  assert.equal((move.json() as { error: { code: string } }).error.code, 'department_forbidden');

  const clear = await apiRequest(context.app, employeeAClient, 'PATCH', `/documents/${createdId}`, {
    payload: { departmentId: null },
  });
  assert.equal(clear.statusCode, 403);

  const sameDepartment = await apiRequest(
    context.app,
    employeeAClient,
    'PATCH',
    `/documents/${createdId}`,
    { payload: { departmentId: departmentA, title: 'تعديل مسموح' } },
  );
  assert.equal(sameDepartment.statusCode, 200, sameDepartment.body);

  // الموظف لا يستطيع إنشاء معاملة بإدارة غير موجودة أو معطّلة حتى لو طابق المعرّف.
  const unknown = await apiRequest(context.app, employeeAClient, 'POST', '/documents', {
    payload: {
      reference: 'ISO-WRITE-UNKNOWN',
      title: 'إدارة غير موجودة',
      type: 'incoming',
      date: '2026-04-02',
      departmentId: '00000000-0000-4000-8000-000000000000',
    },
  });
  assert.equal(unknown.statusCode, 403);
});

test('dashboard, reports, and CSV export are scoped to the employee department', async () => {
  await createDocument(adminClient, 'ISO-DASH-A1', departmentA, { type: 'incoming' });
  await createDocument(adminClient, 'ISO-DASH-A2', departmentA, { type: 'outgoing' });
  await createDocument(adminClient, 'ISO-DASH-B1', departmentB, { type: 'incoming' });
  await createDocument(adminClient, 'ISO-DASH-B2', departmentB, { type: 'outgoing' });
  await createDocument(adminClient, 'ISO-DASH-NULL', null);

  const dashboard = await apiRequest(context.app, employeeAClient, 'GET', '/stats/dashboard');
  assert.equal(dashboard.statusCode, 200, dashboard.body);
  const stats = dashboard.json() as {
    activeDocuments: number;
    deletedDocuments: number;
    incoming: number;
    outgoing: number;
    departments: number;
    users: number | null;
    recent: Array<{ reference: string }>;
  };
  assert.equal(stats.activeDocuments, 2);
  assert.equal(stats.deletedDocuments, 0);
  assert.equal(stats.incoming, 1);
  assert.equal(stats.outgoing, 1);
  assert.equal(stats.departments, 1);
  assert.equal(stats.users, null);
  assert.ok(stats.recent.every((row) => row.reference.startsWith('ISO-DASH-A')));

  const summary = await apiRequest(context.app, employeeAClient, 'GET', '/reports/summary');
  assert.equal(summary.statusCode, 200, summary.body);
  const summaryBody = summary.json() as {
    total: number;
    byDepartment: Array<{ department: string; count: number }>;
  };
  assert.equal(summaryBody.total, 2);
  assert.deepEqual(summaryBody.byDepartment, [{ department: 'إدارة أ', count: 2 }]);

  const foreignSummary = await apiRequest(
    context.app,
    employeeAClient,
    'GET',
    `/reports/summary?departmentId=${departmentB}`,
  );
  assert.equal(foreignSummary.statusCode, 200);
  assert.equal((foreignSummary.json() as { total: number }).total, 0);
  assert.deepEqual((foreignSummary.json() as { byDepartment: unknown[] }).byDepartment, []);

  const csv = await apiRequest(
    context.app,
    employeeAClient,
    'GET',
    `/reports/documents.csv?departmentId=${departmentB}`,
  );
  assert.equal(csv.statusCode, 200);
  assert.equal(csv.body.includes('ISO-DASH-B'), false);
  assert.equal(csv.body.trim().split('\n').length, 1);

  const ownCsv = await apiRequest(context.app, employeeAClient, 'GET', '/reports/documents.csv');
  assert.equal(ownCsv.statusCode, 200);
  assert.ok(ownCsv.body.includes('ISO-DASH-A1'));
  assert.ok(ownCsv.body.includes('ISO-DASH-A2'));
  assert.equal(ownCsv.body.includes('ISO-DASH-B1'), false);
  assert.equal(ownCsv.body.includes('ISO-DASH-NULL'), false);

  const foreignDashboard = await apiRequest(
    context.app,
    employeeAClient,
    'GET',
    `/reports/summary?q=${encodeURIComponent('إدارة ب')}`,
  );
  assert.equal(foreignDashboard.statusCode, 200);
  assert.equal((foreignDashboard.json() as { total: number }).total, 0);
});

test('unassigned employee keeps login but every operational endpoint is denied with a clear Arabic message', async () => {
  const unassignedId = await createTestUser(context.pool, {
    username: 'unassigned',
    departmentId: null,
  });
  const unassigned = await loginClient(context.app, 'unassigned');
  assert.equal(unassigned.user.departmentId, null);

  const session = await apiRequest(context.app, unassigned, 'GET', '/auth/session');
  assert.equal(session.statusCode, 200);
  assert.equal((session.json() as { user: { departmentId: string | null } }).user.departmentId, null);

  const aDoc = await createDocument(adminClient, 'ISO-U-A', departmentA);
  const bDoc = await createDocument(adminClient, 'ISO-U-B', departmentB);
  const bFile = uploadFileId(await uploadFile(adminClient, bDoc));

  const paths: Array<[string, string, unknown?]> = [
    ['GET', '/documents'],
    ['GET', `/documents/${aDoc}`],
    ['POST', '/documents', {
      reference: 'ISO-U-WRITE',
      title: 'محاولة موظف بلا إدارة',
      type: 'incoming',
      date: '2026-04-03',
      departmentId: departmentA,
    }],
    ['GET', '/stats/dashboard'],
    ['GET', '/reports/summary'],
    ['GET', '/reports/documents.csv'],
    ['GET', `/files/${bFile}/download`],
    ['PATCH', `/documents/${aDoc}`, { title: 'محاولة تعديل' }],
  ];

  for (const [method, path, payload] of paths) {
    const response = await apiRequest(
      context.app,
      unassigned,
      method as 'GET' | 'POST' | 'PATCH',
      path,
      payload === undefined ? {} : { payload },
    );
    assert.equal(response.statusCode, 403, `${method} ${path}: ${response.body}`);
    const error = (response.json() as { error: { code: string; message: string } }).error;
    assert.equal(error.code, 'department_required', `${method} ${path}`);
    assert.ok(error.message.includes('إدارة'), `${method} ${path}: ${error.message}`);
  }

  const upload = await uploadFile(unassigned, aDoc);
  assert.equal(upload.statusCode, 403);
  assert.equal(
    (upload.json() as { error: { code: string } }).error.code,
    'department_required',
  );

  // لا تُكتب أي معاملة من المحاولات المرفوضة.
  const count = await context.pool.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM documents WHERE reference LIKE 'ISO-U-WRITE%'",
  );
  assert.equal(count.rows[0]!.count, 0);

  // نقاط الإدارات العامة لا تُعيد بيانات تشغيلية.
  const departments = await apiRequest(context.app, unassigned, 'GET', '/departments');
  assert.equal(departments.statusCode, 200);
  assert.deepEqual((departments.json() as { items: unknown[] }).items, []);

  // إدارة المستخدم غير المعيّن تبقى غير معيّنة.
  const row = await context.pool.query<{ department_id: string | null }>(
    'SELECT department_id FROM users WHERE id = $1',
    [unassignedId],
  );
  assert.equal(row.rows[0]!.department_id, null);
});

test('an employee whose department is inactive is denied until an administrator reactivates it, without stale session data', async () => {
  const departmentC = await createDepartment('إدارة معطّلة');
  const employeeCId = await createTestUser(context.pool, {
    username: 'employee.c',
    departmentId: departmentC,
    isActive: false,
  });

  // تعطيل الإدارة مسموح بعد تعطيل الحساب النشط.
  const deactivated = await apiRequest(
    context.app,
    adminClient,
    'PATCH',
    `/departments/${departmentC}`,
    { payload: { isActive: false } },
  );
  assert.equal(deactivated.statusCode, 200, deactivated.body);

  const reactivatedUser = await apiRequest(
    context.app,
    adminClient,
    'PATCH',
    `/users/${employeeCId}`,
    { payload: { isActive: true } },
  );
  assert.equal(reactivatedUser.statusCode, 200, reactivatedUser.body);

  const employeeC = await loginClient(context.app, 'employee.c');
  assert.equal(employeeC.user.departmentId, departmentC);
  assert.equal(employeeC.user.departmentActive, false);

  const session = await apiRequest(context.app, employeeC, 'GET', '/auth/session');
  assert.equal(session.statusCode, 200);
  assert.equal(
    (session.json() as { user: { departmentActive: boolean } }).user.departmentActive,
    false,
  );

  for (const path of ['/documents', '/stats/dashboard', '/reports/summary', '/reports/documents.csv']) {
    const response = await apiRequest(context.app, employeeC, 'GET', path);
    assert.equal(response.statusCode, 403, `${path}: ${response.body}`);
    assert.equal(
      (response.json() as { error: { code: string } }).error.code,
      'department_inactive',
      path,
    );
  }

  const create = await apiRequest(context.app, employeeC, 'POST', '/documents', {
    payload: {
      reference: 'ISO-INACTIVE-WRITE',
      title: 'محاولة كتابة',
      type: 'incoming',
      date: '2026-04-04',
    },
  });
  assert.equal(create.statusCode, 403);
  assert.equal(
    (create.json() as { error: { code: string } }).error.code,
    'department_inactive',
  );

  const departments = await apiRequest(context.app, employeeC, 'GET', '/departments');
  assert.equal(departments.statusCode, 200);
  assert.deepEqual((departments.json() as { items: unknown[] }).items, []);

  // التفعيل يظهر فوراً في الطلب التالي دون إعادة تسجيل الدخول.
  const activated = await apiRequest(
    context.app,
    adminClient,
    'PATCH',
    `/departments/${departmentC}`,
    { payload: { isActive: true } },
  );
  assert.equal(activated.statusCode, 200, activated.body);
  const list = await apiRequest(context.app, employeeC, 'GET', '/documents');
  assert.equal(list.statusCode, 200, list.body);
  assert.equal((list.json() as { total: number }).total, 0);
});

test('department assignment changes take effect on the next request without re-login or session revocation', async () => {
  const aDoc = await createDocument(adminClient, 'ISO-FRESH-A', departmentA);
  const bDoc = await createDocument(adminClient, 'ISO-FRESH-B', departmentB);

  const before = await apiRequest(context.app, employeeAClient, 'GET', '/documents');
  assert.equal(before.statusCode, 200);
  assert.deepEqual(
    (before.json() as DocumentListBody).items.map((row) => row.reference),
    ['ISO-FRESH-A'],
  );

  const moved = await apiRequest(context.app, adminClient, 'PATCH', `/users/${employeeAId}`, {
    payload: { departmentId: departmentB },
  });
  assert.equal(moved.statusCode, 200, moved.body);

  const after = await apiRequest(context.app, employeeAClient, 'GET', '/documents');
  assert.equal(after.statusCode, 200);
  assert.deepEqual(
    (after.json() as DocumentListBody).items.map((row) => row.reference),
    ['ISO-FRESH-B'],
  );
  const oldDoc = await apiRequest(context.app, employeeAClient, 'GET', `/documents/${aDoc}`);
  assert.equal(oldDoc.statusCode, 404);
  const newDoc = await apiRequest(context.app, employeeAClient, 'GET', `/documents/${bDoc}`);
  assert.equal(newDoc.statusCode, 200);

  const stats = await apiRequest(context.app, employeeAClient, 'GET', '/stats/dashboard');
  assert.equal(stats.statusCode, 200);
  assert.equal((stats.json() as { activeDocuments: number }).activeDocuments, 1);

  // إعادة التعيين تعمل بالاتجاه الآخر أيضاً وبدون إعادة دخول.
  await apiRequest(context.app, adminClient, 'PATCH', `/users/${employeeAId}`, {
    payload: { departmentId: departmentA },
  });
  const back = await apiRequest(context.app, employeeAClient, 'GET', '/documents');
  assert.deepEqual(
    (back.json() as DocumentListBody).items.map((row) => row.reference),
    ['ISO-FRESH-A'],
  );

  // كل تغيير في ارتباط الموظف يُرصد في سجل التدقيق مع الإدارة الجديدة.
  const audit = await context.pool.query<{
    details: {
      changed: { departmentId: string; departmentName: string };
      revokedSessions: number;
    };
  }>(
    `SELECT details FROM audit_log
      WHERE action = 'user.updated' AND entity_id = $1
      ORDER BY id DESC LIMIT 1`,
    [employeeAId],
  );
  assert.equal(audit.rows[0]!.details.changed.departmentId, departmentA);
  assert.equal(audit.rows[0]!.details.changed.departmentName, 'إدارة أ');
  assert.equal(audit.rows[0]!.details.revokedSessions, 0);
});

test('administrators remain global, and employee department rules are enforced on user management', async () => {
  const admin2 = await apiRequest(context.app, adminClient, 'POST', '/users', {
    payload: {
      username: 'admin.two',
      displayName: 'مدير ثان',
      role: 'admin',
      password: 'password-123',
    },
  });
  assert.equal(admin2.statusCode, 201, admin2.body);
  const admin2Body = admin2.json() as {
    user: { id: string; departmentId: string | null; role: string };
  };
  assert.equal(admin2Body.user.departmentId, null);
  assert.equal(admin2Body.user.role, 'admin');

  await createDocument(adminClient, 'ISO-ADMIN-A', departmentA);
  await createDocument(adminClient, 'ISO-ADMIN-B', departmentB);
  await createDocument(adminClient, 'ISO-ADMIN-NULL', null);

  const admin2Client = await loginClient(context.app, 'admin.two');
  const globalList = await apiRequest(context.app, admin2Client, 'GET', '/documents');
  assert.equal(globalList.statusCode, 200);
  assert.equal((globalList.json() as { total: number }).total, 3);
  const globalDepartments = await apiRequest(
    context.app,
    admin2Client,
    'GET',
    '/departments?includeInactive=true',
  );
  assert.equal((globalDepartments.json() as { items: unknown[] }).items.length, 2);

  const employeeWithoutDepartment = await apiRequest(context.app, adminClient, 'POST', '/users', {
    payload: {
      username: 'no.department',
      displayName: 'موظف بلا إدارة',
      role: 'employee',
      password: 'password-123',
    },
  });
  assert.equal(employeeWithoutDepartment.statusCode, 400);
  assert.equal(
    (employeeWithoutDepartment.json() as { error: { code: string } }).error.code,
    'department_required',
  );

  const inactiveDepartment = await createDepartment('إدارة غير نشطة');
  await apiRequest(context.app, adminClient, 'PATCH', `/departments/${inactiveDepartment}`, {
    payload: { isActive: false },
  });
  const employeeInactiveDepartment = await apiRequest(
    context.app,
    adminClient,
    'POST',
    '/users',
    {
      payload: {
        username: 'inactive.department',
        displayName: 'موظف إدارة معطلة',
        role: 'employee',
        departmentId: inactiveDepartment,
        password: 'password-123',
      },
    },
  );
  assert.equal(employeeInactiveDepartment.statusCode, 400);
  assert.equal(
    (employeeInactiveDepartment.json() as { error: { code: string } }).error.code,
    'inactive_department',
  );

  // تحويل مدير إلى موظف يتطلب إدارة نشطة.
  const demoteWithoutDepartment = await apiRequest(
    context.app,
    adminClient,
    'PATCH',
    `/users/${admin2Body.user.id}`,
    { payload: { role: 'employee' } },
  );
  assert.equal(demoteWithoutDepartment.statusCode, 400);
  assert.equal(
    (demoteWithoutDepartment.json() as { error: { code: string } }).error.code,
    'department_required',
  );

  // لا يمكن إفراغ إدارة موظف قائم.
  const clearEmployeeDepartment = await apiRequest(
    context.app,
    adminClient,
    'PATCH',
    `/users/${employeeAId}`,
    { payload: { departmentId: null } },
  );
  assert.equal(clearEmployeeDepartment.statusCode, 400);
  assert.equal(
    (clearEmployeeDepartment.json() as { error: { code: string } }).error.code,
    'department_required',
  );

  // تعيين إدارة نشطة عند تحويل المدير إلى موظف ينجح.
  const demoted = await apiRequest(
    context.app,
    adminClient,
    'PATCH',
    `/users/${admin2Body.user.id}`,
    { payload: { role: 'employee', departmentId: departmentA } },
  );
  assert.equal(demoted.statusCode, 200, demoted.body);
  assert.equal(
    (demoted.json() as { user: { role: string; departmentId: string } }).user.departmentId,
    departmentA,
  );
});

test('employee cannot reach user, audit, import, or backup administration endpoints', async () => {
  const requests: Array<[string, string, unknown?]> = [
    ['GET', '/users'],
    ['GET', '/audit'],
    ['GET', '/exports/backup'],
    ['POST', '/imports/legacy', { departments: [], documents: [] }],
    ['POST', '/imports/backup', { documents: [] }],
    ['POST', '/users', {
      username: 'forbidden.user',
      displayName: 'ممنوع',
      role: 'employee',
      departmentId: departmentA,
      password: 'password-123',
    }],
  ];
  for (const [method, path, payload] of requests) {
    const response = await apiRequest(
      context.app,
      employeeAClient,
      method as 'GET' | 'POST',
      path,
      payload === undefined ? {} : { payload },
    );
    assert.equal(response.statusCode, 403, `${method} ${path}: ${response.body}`);
  }
});
