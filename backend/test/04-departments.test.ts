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

before(async () => {
  context = await createTestContext();
  await ensureMigrated(context.pool);
});

beforeEach(async () => {
  await resetDatabase(context.pool);
  await createTestUser(context.pool, { username: 'admin', role: 'admin' });
  await createTestUser(context.pool, { username: 'employee', role: 'employee' });
  adminClient = await loginClient(context.app, 'admin');
  employeeClient = await loginClient(context.app, 'employee');
});

after(async () => {
  await disposeTestContext(context);
});

test('admin creates departments; duplicates are rejected case-insensitively after whitespace normalization', async () => {
  const created = await apiRequest(context.app, adminClient, 'POST', '/departments', {
    payload: { name: 'الإدارة  العامة ' },
  });
  assert.equal(created.statusCode, 201);
  assert.equal(
    (created.json() as { department: { name: string } }).department.name,
    'الإدارة العامة',
  );

  const duplicate = await apiRequest(context.app, adminClient, 'POST', '/departments', {
    payload: { name: 'الإدارة العامة' },
  });
  assert.equal(duplicate.statusCode, 409);
  assert.equal((duplicate.json() as { error: { code: string } }).error.code, 'duplicate_department');

  const audit = await context.pool.query("SELECT 1 FROM audit_log WHERE action = 'department.created'");
  assert.equal(audit.rows.length, 1);
});

test('employees only list their own active department and cannot manage departments', async () => {
  await apiRequest(context.app, adminClient, 'POST', '/departments', { payload: { name: 'إدارة المالية' } });

  const own = await context.pool.query<{ id: string; name: string }>(
    `SELECT dep.id, dep.name
       FROM users u JOIN departments dep ON dep.id = u.department_id
      WHERE u.username = 'employee'`,
  );
  const list = await apiRequest(context.app, employeeClient, 'GET', '/departments');
  assert.equal(list.statusCode, 200);
  const items = (list.json() as { items: Array<{ id: string; name: string }> }).items;
  assert.equal(items.length, 1);
  assert.equal(items[0]!.id, own.rows[0]!.id);
  assert.equal(items[0]!.name, own.rows[0]!.name);

  // حتى مع includeInactive لا يستطيع الموظف رؤية إدارة أخرى أو إدارة معطّلة.
  const forced = await apiRequest(
    context.app,
    employeeClient,
    'GET',
    '/departments?includeInactive=true',
  );
  assert.deepEqual(
    (forced.json() as { items: Array<{ id: string }> }).items.map((item) => item.id),
    [own.rows[0]!.id],
  );

  const created = await apiRequest(context.app, employeeClient, 'POST', '/departments', {
    payload: { name: 'إدارة ممنوعة' },
  });
  assert.equal(created.statusCode, 403);

  const patched = await apiRequest(context.app, employeeClient, 'PATCH', `/departments/${own.rows[0]!.id}`, {
    payload: { name: 'تغيير ممنوع' },
  });
  assert.equal(patched.statusCode, 403);

  const deleted = await apiRequest(context.app, employeeClient, 'DELETE', `/departments/${own.rows[0]!.id}`);
  assert.equal(deleted.statusCode, 403);
});

test('department listing is scoped to the employee and deactivation is blocked while active employees remain', async () => {
  const own = await context.pool.query<{ id: string }>(
    "SELECT department_id AS id FROM users WHERE username = 'employee'",
  );
  const originalDepartmentId = own.rows[0]!.id;

  const created = await apiRequest(context.app, adminClient, 'POST', '/departments', {
    payload: { name: 'إدارة الوثائق' },
  });
  const departmentId = (created.json() as { department: { id: string } }).department.id;

  const document = await apiRequest(context.app, adminClient, 'POST', '/documents', {
    payload: {
      reference: 'DEPT-1',
      title: 'معاملة مرتبطة بإدارة',
      type: 'incoming',
      date: '2026-02-01',
      departmentId,
    },
  });
  assert.equal(document.statusCode, 201);

  const employeeId = await context.pool.query<{ id: string }>(
    "SELECT id FROM users WHERE username = 'employee'",
  );
  const assigned = await apiRequest(
    context.app,
    adminClient,
    'PATCH',
    `/users/${employeeId.rows[0]!.id}`,
    { payload: { departmentId } },
  );
  assert.equal(assigned.statusCode, 200);

  const withCount = await apiRequest(context.app, employeeClient, 'GET', '/departments');
  const item = (withCount.json() as { items: Array<{ id: string; documentCount: number }> }).items[0]!;
  assert.equal(item.id, departmentId);
  assert.equal(item.documentCount, 1);

  const blockedDeactivation = await apiRequest(
    context.app,
    adminClient,
    'PATCH',
    `/departments/${departmentId}`,
    { payload: { isActive: false } },
  );
  assert.equal(blockedDeactivation.statusCode, 409);
  assert.equal(
    (blockedDeactivation.json() as { error: { code: string } }).error.code,
    'department_has_active_employees',
  );

  // نقل الموظف إلى إدارة نشطة أخرى يسمح بتعطيل الإدارة.
  const moved = await apiRequest(
    context.app,
    adminClient,
    'PATCH',
    `/users/${employeeId.rows[0]!.id}`,
    { payload: { departmentId: originalDepartmentId } },
  );
  assert.equal(moved.statusCode, 200);

  const deactivated = await apiRequest(context.app, adminClient, 'PATCH', `/departments/${departmentId}`, {
    payload: { isActive: false },
  });
  assert.equal(deactivated.statusCode, 200);

  const employeeList = await apiRequest(context.app, employeeClient, 'GET', '/departments');
  const visible = (employeeList.json() as { items: Array<{ id: string }> }).items;
  assert.deepEqual(visible.map((entry) => entry.id), [originalDepartmentId]);

  const adminList = await apiRequest(context.app, adminClient, 'GET', '/departments?includeInactive=true');
  assert.equal((adminList.json() as { items: unknown[] }).items.length, 2);

  const employeeForced = await apiRequest(
    context.app,
    employeeClient,
    'GET',
    '/departments?includeInactive=true',
  );
  assert.deepEqual(
    (employeeForced.json() as { items: Array<{ id: string }> }).items.map((entry) => entry.id),
    [originalDepartmentId],
  );
});

test('a department referenced by documents cannot be deleted; an unused one can', async () => {
  const used = await apiRequest(context.app, adminClient, 'POST', '/departments', {
    payload: { name: 'إدارة مستخدمة' },
  });
  const usedId = (used.json() as { department: { id: string } }).department.id;
  await apiRequest(context.app, adminClient, 'POST', '/documents', {
    payload: { reference: 'USED-1', title: 'مرتبطة', type: 'incoming', date: '2026-03-01', departmentId: usedId },
  });

  const blocked = await apiRequest(context.app, adminClient, 'DELETE', `/departments/${usedId}`);
  assert.equal(blocked.statusCode, 409);
  assert.equal((blocked.json() as { error: { code: string } }).error.code, 'department_in_use');

  const unused = await apiRequest(context.app, adminClient, 'POST', '/departments', {
    payload: { name: 'إدارة غير مستخدمة' },
  });
  const unusedId = (unused.json() as { department: { id: string } }).department.id;

  const removed = await apiRequest(context.app, adminClient, 'DELETE', `/departments/${unusedId}`);
  assert.equal(removed.statusCode, 200);

  const gone = await apiRequest(context.app, adminClient, 'PATCH', `/departments/${unusedId}`, {
    payload: { name: 'بعد الحذف' },
  });
  assert.equal(gone.statusCode, 404);

  const audit = await context.pool.query("SELECT 1 FROM audit_log WHERE action = 'department.deleted'");
  assert.equal(audit.rows.length, 1);
});

test('a department referenced by a user cannot be deleted until the user is reassigned', async () => {
  const created = await apiRequest(context.app, adminClient, 'POST', '/departments', {
    payload: { name: 'إدارة مرتبطة بمستخدم' },
  });
  const departmentId = (created.json() as { department: { id: string } }).department.id;
  const employee = await context.pool.query<{ id: string; department_id: string }>(
    "SELECT id, department_id FROM users WHERE username = 'employee'",
  );

  const assigned = await apiRequest(
    context.app,
    adminClient,
    'PATCH',
    `/users/${employee.rows[0]!.id}`,
    { payload: { departmentId } },
  );
  assert.equal(assigned.statusCode, 200);

  const blocked = await apiRequest(context.app, adminClient, 'DELETE', `/departments/${departmentId}`);
  assert.equal(blocked.statusCode, 409);
  assert.equal((blocked.json() as { error: { code: string } }).error.code, 'department_has_users');

  const movedBack = await apiRequest(
    context.app,
    adminClient,
    'PATCH',
    `/users/${employee.rows[0]!.id}`,
    { payload: { departmentId: employee.rows[0]!.department_id } },
  );
  assert.equal(movedBack.statusCode, 200);

  const removed = await apiRequest(context.app, adminClient, 'DELETE', `/departments/${departmentId}`);
  assert.equal(removed.statusCode, 200);
});
