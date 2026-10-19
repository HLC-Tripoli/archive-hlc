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

test('employees can list departments but cannot manage them', async () => {
  await apiRequest(context.app, adminClient, 'POST', '/departments', { payload: { name: 'إدارة المالية' } });

  const list = await apiRequest(context.app, employeeClient, 'GET', '/departments');
  assert.equal(list.statusCode, 200);
  const items = (list.json() as { items: Array<{ name: string }> }).items;
  assert.equal(items.length, 1);
  assert.equal(items[0]!.name, 'إدارة المالية');

  const created = await apiRequest(context.app, employeeClient, 'POST', '/departments', {
    payload: { name: 'إدارة ممنوعة' },
  });
  assert.equal(created.statusCode, 403);

  const id = await context.pool.query<{ id: string }>('SELECT id FROM departments LIMIT 1');
  const patched = await apiRequest(context.app, employeeClient, 'PATCH', `/departments/${id.rows[0]!.id}`, {
    payload: { name: 'تغيير ممنوع' },
  });
  assert.equal(patched.statusCode, 403);

  const deleted = await apiRequest(context.app, employeeClient, 'DELETE', `/departments/${id.rows[0]!.id}`);
  assert.equal(deleted.statusCode, 403);
});

test('department listing hides inactive departments from employees and counts documents', async () => {
  const created = await apiRequest(context.app, adminClient, 'POST', '/departments', {
    payload: { name: 'إدارة الوثائق' },
  });
  const departmentId = (created.json() as { department: { id: string } }).department.id;

  const document = await apiRequest(context.app, employeeClient, 'POST', '/documents', {
    payload: {
      reference: 'DEPT-1',
      title: 'معاملة مرتبطة بإدارة',
      type: 'incoming',
      date: '2026-02-01',
      departmentId,
    },
  });
  assert.equal(document.statusCode, 201);

  const withCount = await apiRequest(context.app, employeeClient, 'GET', '/departments');
  const item = (withCount.json() as { items: Array<{ documentCount: number }> }).items[0]!;
  assert.equal(item.documentCount, 1);

  const deactivated = await apiRequest(context.app, adminClient, 'PATCH', `/departments/${departmentId}`, {
    payload: { isActive: false },
  });
  assert.equal(deactivated.statusCode, 200);

  const employeeList = await apiRequest(context.app, employeeClient, 'GET', '/departments');
  assert.equal((employeeList.json() as { items: unknown[] }).items.length, 0);

  const adminList = await apiRequest(context.app, adminClient, 'GET', '/departments?includeInactive=true');
  assert.equal((adminList.json() as { items: unknown[] }).items.length, 1);

  const employeeForced = await apiRequest(
    context.app,
    employeeClient,
    'GET',
    '/departments?includeInactive=true',
  );
  assert.equal((employeeForced.json() as { items: unknown[] }).items.length, 0);
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
