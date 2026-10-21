import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';
import {
  apiRequest,
  createTestContext,
  createTestUser,
  disposeTestContext,
  ensureMigrated,
  loginClient,
  resetDatabase,
  type AuthedClient,
  type TestContext,
} from './helpers.js';

let context: TestContext;
let adminClient: AuthedClient;
let employeeClient: AuthedClient;
let employeeDepartmentId: string;

const STATUSES = ['new', 'in_progress', 'completed', 'archived'] as const;

before(async () => {
  context = await createTestContext();
  await ensureMigrated(context.pool);
});

beforeEach(async () => {
  await resetDatabase(context.pool);
  await createTestUser(context.pool, { username: 'admin', role: 'admin' });
  await createTestUser(context.pool, { username: 'employee', role: 'employee' });
  const employeeRow = await context.pool.query<{ department_id: string }>(
    "SELECT department_id FROM users WHERE username = 'employee'",
  );
  employeeDepartmentId = employeeRow.rows[0]!.department_id;
  adminClient = await loginClient(context.app, 'admin');
  employeeClient = await loginClient(context.app, 'employee');
});

after(async () => {
  await disposeTestContext(context);
});

async function createDocument(
  payload: Record<string, unknown>,
  client: AuthedClient = employeeClient,
): Promise<{ id: string; reference: string }> {
  const response = await apiRequest(context.app, client, 'POST', '/documents', { payload });
  assert.equal(response.statusCode, 201, response.body);
  return (response.json() as { document: { id: string; reference: string } }).document;
}

async function createDepartment(name: string): Promise<string> {
  const response = await apiRequest(context.app, adminClient, 'POST', '/departments', {
    payload: { name },
  });
  assert.equal(response.statusCode, 201, response.body);
  return (response.json() as { department: { id: string } }).department.id;
}

async function seedDocuments(departmentId: string, count = 25): Promise<void> {
  for (let index = 1; index <= count; index += 1) {
    const payload: Record<string, unknown> = {
      reference: `DOC-${String(index).padStart(3, '0')}`,
      title: `معاملة تجريبية ${index}`,
      type: index % 2 === 0 ? 'outgoing' : 'incoming',
      date: `2026-0${(index % 3) + 1}-${String(index).padStart(2, '0')}`,
      status: STATUSES[(index - 1) % 4]!,
    };
    if (index % 2 === 0) payload.departmentId = departmentId;
    await createDocument(payload);
  }
}

test('employee creates a document in the assigned department; invalid payloads are rejected with Arabic validation errors', async () => {
  const created = await createDocument({
    reference: 'REF-001',
    title: 'معاملة واردة أولى',
    type: 'incoming',
    date: '2026-05-20',
    sender: 'جهة مرسلة',
    recipient: 'هاتف ليبيا',
    departmentId: employeeDepartmentId,
    notes: 'ملاحظة',
  });
  const detail = await apiRequest(context.app, employeeClient, 'GET', `/documents/${created.id}`);
  assert.equal(detail.statusCode, 200);
  const document = (detail.json() as { document: { status: string; department: { name: string }; notes: string } }).document;
  assert.equal(document.status, 'new');
  assert.ok(document.department.name);
  assert.equal(document.notes, 'ملاحظة');

  const missingTitle = await apiRequest(context.app, employeeClient, 'POST', '/documents', {
    payload: { reference: 'REF-002', type: 'incoming', date: '2026-05-20' },
  });
  assert.equal(missingTitle.statusCode, 400);
  const missingTitleError = missingTitle.json() as { error: { code: string; details?: { issues: unknown[] } } };
  assert.equal(missingTitleError.error.code, 'validation_error');
  assert.ok(Array.isArray(missingTitleError.error.details?.issues));

  const badDate = await apiRequest(context.app, employeeClient, 'POST', '/documents', {
    payload: { reference: 'REF-003', title: 'تاريخ خاطئ', type: 'incoming', date: '2026-13-45' },
  });
  assert.equal(badDate.statusCode, 400);
  assert.equal((badDate.json() as { error: { code: string } }).error.code, 'invalid_date');

  const badType = await apiRequest(context.app, employeeClient, 'POST', '/documents', {
    payload: { reference: 'REF-004', title: 'نوع خاطئ', type: 'memo', date: '2026-05-20' },
  });
  assert.equal(badType.statusCode, 400);
  assert.equal((badType.json() as { error: { code: string } }).error.code, 'validation_error');

  const unknownDepartment = await apiRequest(context.app, adminClient, 'POST', '/documents', {
    payload: {
      reference: 'REF-005',
      title: 'إدارة غير موجودة',
      type: 'incoming',
      date: '2026-05-20',
      departmentId: '00000000-0000-4000-8000-000000000000',
    },
  });
  assert.equal(unknownDepartment.statusCode, 400);
  assert.equal(
    (unknownDepartment.json() as { error: { code: string } }).error.code,
    'invalid_department',
  );

  const audit = await context.pool.query("SELECT 1 FROM audit_log WHERE action = 'document.created'");
  assert.equal(audit.rows.length, 1);
});

test('admin may create and clear a document department; an employee cannot choose null or another department', async () => {
  const adminCreated = await createDocument(
    {
      reference: 'REF-NULL-DEPT',
      title: 'بدون إدارة',
      type: 'incoming',
      date: '2026-05-20',
      departmentId: null,
    },
    adminClient,
  );
  const detail = await apiRequest(context.app, adminClient, 'GET', `/documents/${adminCreated.id}`);
  assert.equal(detail.statusCode, 200);
  assert.equal((detail.json() as { document: { department: unknown } }).document.department, null);

  const employeeNull = await apiRequest(context.app, employeeClient, 'POST', '/documents', {
    payload: {
      reference: 'REF-EMP-NULL',
      title: 'محاولة بدون إدارة',
      type: 'incoming',
      date: '2026-05-20',
      departmentId: null,
    },
  });
  assert.equal(employeeNull.statusCode, 403);
  assert.equal(
    (employeeNull.json() as { error: { code: string } }).error.code,
    'department_forbidden',
  );

  const otherDepartmentId = await createDepartment('إدارة أخرى');
  const employeeOther = await apiRequest(context.app, employeeClient, 'POST', '/documents', {
    payload: {
      reference: 'REF-EMP-OTHER',
      title: 'محاولة إدارة أخرى',
      type: 'incoming',
      date: '2026-05-20',
      departmentId: otherDepartmentId,
    },
  });
  assert.equal(employeeOther.statusCode, 403);
  assert.equal(
    (employeeOther.json() as { error: { code: string } }).error.code,
    'department_forbidden',
  );

  const ownDocument = await createDocument({ reference: 'REF-OWN', title: 'مع إدارتي', type: 'incoming', date: '2026-05-20' });
  const attemptMove = await apiRequest(
    context.app,
    employeeClient,
    'PATCH',
    `/documents/${ownDocument.id}`,
    { payload: { departmentId: otherDepartmentId } },
  );
  assert.equal(attemptMove.statusCode, 403);
  assert.equal(
    (attemptMove.json() as { error: { code: string } }).error.code,
    'department_forbidden',
  );

  const attemptClear = await apiRequest(
    context.app,
    employeeClient,
    'PATCH',
    `/documents/${ownDocument.id}`,
    { payload: { departmentId: null } },
  );
  assert.equal(attemptClear.statusCode, 403);

  const adminCleared = await apiRequest(
    context.app,
    adminClient,
    'PATCH',
    `/documents/${ownDocument.id}`,
    { payload: { departmentId: null } },
  );
  assert.equal(adminCleared.statusCode, 200, adminCleared.body);
  assert.equal((adminCleared.json() as { document: { department: unknown } }).document.department, null);
});

test('duplicate references are rejected regardless of letter case', async () => {
  await createDocument({ reference: 'INV-100', title: 'مرجع فريد', type: 'incoming', date: '2026-01-10' });

  const duplicate = await apiRequest(context.app, employeeClient, 'POST', '/documents', {
    payload: { reference: 'inv-100', title: 'مكرر', type: 'incoming', date: '2026-01-11' },
  });
  assert.equal(duplicate.statusCode, 409);
  assert.equal((duplicate.json() as { error: { code: string } }).error.code, 'duplicate_reference');
});

test('listing supports filters, Arabic search, sorting, and pagination within the employee department', async () => {
  await seedDocuments(employeeDepartmentId);

  const page = await apiRequest(context.app, employeeClient, 'GET', '/documents?page=1&pageSize=10');
  assert.equal(page.statusCode, 200);
  const pageBody = page.json() as { items: unknown[]; total: number; page: number; pageSize: number };
  assert.equal(pageBody.total, 25);
  assert.equal(pageBody.items.length, 10);
  assert.equal(pageBody.page, 1);

  const byStatus = await apiRequest(context.app, employeeClient, 'GET', '/documents?status=new');
  assert.equal((byStatus.json() as { total: number }).total, 7);

  const byType = await apiRequest(context.app, employeeClient, 'GET', '/documents?type=outgoing');
  assert.equal((byType.json() as { total: number }).total, 12);

  const byDepartment = await apiRequest(
    context.app,
    employeeClient,
    'GET',
    `/documents?departmentId=${employeeDepartmentId}`,
  );
  assert.equal((byDepartment.json() as { total: number }).total, 25);

  const byDate = await apiRequest(
    context.app,
    employeeClient,
    'GET',
    '/documents?dateFrom=2026-01-01&dateTo=2026-01-31',
  );
  assert.equal((byDate.json() as { total: number }).total, 8);

  const byReference = await apiRequest(context.app, employeeClient, 'GET', '/documents?q=DOC-013');
  const referenceBody = byReference.json() as { items: Array<{ reference: string }>; total: number };
  assert.equal(referenceBody.total, 1);
  assert.equal(referenceBody.items[0]!.reference, 'DOC-013');

  const arabicSearch = await apiRequest(context.app, employeeClient, 'GET', '/documents?q=تجريبية 7');
  assert.equal((arabicSearch.json() as { total: number }).total, 1);

  const sorted = await apiRequest(
    context.app,
    employeeClient,
    'GET',
    '/documents?sort=reference&order=asc&page=2&pageSize=10',
  );
  const sortedBody = sorted.json() as { items: Array<{ reference: string }> };
  assert.equal(sortedBody.items.length, 10);
  assert.equal(sortedBody.items[0]!.reference, 'DOC-011');

  const descending = await apiRequest(
    context.app,
    employeeClient,
    'GET',
    '/documents?sort=reference&order=desc',
  );
  const descendingBody = descending.json() as { items: Array<{ reference: string }> };
  assert.equal(descendingBody.items[0]!.reference, 'DOC-025');
});

test('updates report changed fields and reject empty or unknown payloads', async () => {
  const created = await createDocument({
    reference: 'UPD-1',
    title: 'قابلة للتعديل',
    type: 'incoming',
    date: '2026-04-01',
  });

  const updated = await apiRequest(context.app, employeeClient, 'PATCH', `/documents/${created.id}`, {
    payload: { status: 'completed', recipient: 'إدارة الأرشيف' },
  });
  assert.equal(updated.statusCode, 200);
  const updatedBody = updated.json() as {
    document: { status: string; recipient: string };
    changedFields: string[];
  };
  assert.equal(updatedBody.document.status, 'completed');
  assert.equal(updatedBody.document.recipient, 'إدارة الأرشيف');
  assert.ok(updatedBody.changedFields.includes('status'));
  assert.ok(updatedBody.changedFields.includes('recipient'));

  const empty = await apiRequest(context.app, employeeClient, 'PATCH', `/documents/${created.id}`, {
    payload: {},
  });
  assert.equal(empty.statusCode, 400);

  const unknownField = await apiRequest(context.app, employeeClient, 'PATCH', `/documents/${created.id}`, {
    payload: { bogus: 'x' },
  });
  assert.equal(unknownField.statusCode, 400);

  const unknownId = await apiRequest(
    context.app,
    employeeClient,
    'PATCH',
    '/documents/00000000-0000-4000-8000-000000000000',
    { payload: { status: 'new' } },
  );
  assert.equal(unknownId.statusCode, 404);

  const audit = await context.pool.query("SELECT 1 FROM audit_log WHERE action = 'document.updated'");
  assert.equal(audit.rows.length, 1);
});

test('soft delete hides the document from employees; admin can list and restore it', async () => {
  const created = await createDocument({
    reference: 'DEL-1',
    title: 'معاملة للحذف',
    type: 'incoming',
    date: '2026-06-01',
  });

  const anonymous = await apiRequest(context.app, null, 'GET', '/documents');
  assert.equal(anonymous.statusCode, 401);

  const employeeDelete = await apiRequest(context.app, employeeClient, 'DELETE', `/documents/${created.id}`);
  assert.equal(employeeDelete.statusCode, 403);

  const adminDelete = await apiRequest(context.app, adminClient, 'DELETE', `/documents/${created.id}`);
  assert.equal(adminDelete.statusCode, 200);
  assert.equal((adminDelete.json() as { outcome: string }).outcome, 'deleted');

  const employeeList = await apiRequest(context.app, employeeClient, 'GET', '/documents');
  assert.equal((employeeList.json() as { total: number }).total, 0);

  const employeeHidden = await apiRequest(context.app, employeeClient, 'GET', `/documents/${created.id}`);
  assert.equal(employeeHidden.statusCode, 404);

  const editDeleted = await apiRequest(context.app, employeeClient, 'PATCH', `/documents/${created.id}`, {
    payload: { status: 'completed' },
  });
  assert.equal(editDeleted.statusCode, 404);

  const adminList = await apiRequest(context.app, adminClient, 'GET', '/documents?includeDeleted=true');
  const adminBody = adminList.json() as { items: Array<{ deletedAt: string | null }>; total: number };
  assert.equal(adminBody.total, 1);
  assert.ok(adminBody.items[0]!.deletedAt);

  const adminDetail = await apiRequest(context.app, adminClient, 'GET', `/documents/${created.id}`);
  assert.equal(adminDetail.statusCode, 200);

  const restored = await apiRequest(
    context.app,
    adminClient,
    'POST',
    `/documents/${created.id}/restore`,
  );
  assert.equal(restored.statusCode, 200);
  assert.equal((restored.json() as { outcome: string }).outcome, 'restored');

  const employeeVisible = await apiRequest(context.app, employeeClient, 'GET', `/documents/${created.id}`);
  assert.equal(employeeVisible.statusCode, 200);

  const doubleRestore = await apiRequest(
    context.app,
    adminClient,
    'POST',
    `/documents/${created.id}/restore`,
  );
  assert.equal(doubleRestore.statusCode, 409);

  const audit = await context.pool.query(
    `SELECT action FROM audit_log WHERE action IN ('document.deleted', 'document.restored') ORDER BY id ASC`,
  );
  assert.deepEqual(
    audit.rows.map((row) => row.action),
    ['document.deleted', 'document.restored'],
  );
});

test('restoring a deleted document conflicts while an active document uses the same reference', async () => {
  const original = await createDocument({
    reference: 'CONFLICT-1',
    title: 'الأصلية',
    type: 'incoming',
    date: '2026-07-01',
  });
  const deleted = await apiRequest(context.app, adminClient, 'DELETE', `/documents/${original.id}`);
  assert.equal(deleted.statusCode, 200);

  await createDocument({ reference: 'conflict-1', title: 'البديلة', type: 'incoming', date: '2026-07-02' });

  const blocked = await apiRequest(context.app, adminClient, 'POST', `/documents/${original.id}/restore`);
  assert.equal(blocked.statusCode, 409);
  assert.equal((blocked.json() as { error: { code: string } }).error.code, 'restore_conflict');

  const replacement = await context.pool.query<{ id: string }>(
    "SELECT id FROM documents WHERE lower(reference) = 'conflict-1' AND deleted_at IS NULL",
  );
  await apiRequest(context.app, adminClient, 'DELETE', `/documents/${replacement.rows[0]!.id}`);

  const restored = await apiRequest(context.app, adminClient, 'POST', `/documents/${original.id}/restore`);
  assert.equal(restored.statusCode, 200);
});
