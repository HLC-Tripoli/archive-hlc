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
  await seed();
});

after(async () => {
  await disposeTestContext(context);
});

async function seed(): Promise<void> {
  const department = await apiRequest(context.app, adminClient, 'POST', '/departments', {
    payload: { name: 'الإدارة العامة' },
  });
  const departmentId = (department.json() as { department: { id: string } }).department.id;

  const employee = await context.pool.query<{ id: string; department_id: string }>(
    "SELECT id, department_id FROM users WHERE username = 'employee'",
  );
  const employeeId = employee.rows[0]!.id;
  const originalDepartmentId = employee.rows[0]!.department_id;
  const assigned = await apiRequest(context.app, adminClient, 'PATCH', `/users/${employeeId}`, {
    payload: { departmentId },
  });
  assert.equal(assigned.statusCode, 200, assigned.body);

  // أربع معاملات في إدارة الموظف الحالية.
  const employeeDocuments = [
    { reference: 'REP-001', sequenceNumber: '0012/A', type: 'incoming', date: '2026-01-05' },
    { reference: 'REP-002', type: 'outgoing', date: '2026-01-06' },
    { reference: 'REP-003', type: 'incoming', date: '2026-02-01' },
    { reference: 'REP-004', type: 'outgoing', date: '2026-03-01' },
  ];
  for (const document of employeeDocuments) {
    const response = await apiRequest(context.app, employeeClient, 'POST', '/documents', {
      payload: { title: `معاملة ${document.reference}`, departmentId, ...document },
    });
    assert.equal(response.statusCode, 201, response.body);
  }

  // أربع معاملات أخرى خارج نطاق الموظف (إدارته السابقة) لفحص العزل.
  for (let index = 0; index < 4; index += 1) {
    const response = await apiRequest(context.app, adminClient, 'POST', '/documents', {
      payload: {
        reference: `ADM-00${index + 1}`,
        title: `معاملة إدارية ${index + 1}`,
        type: index % 2 === 0 ? 'incoming' : 'outgoing',
        date: `2026-0${index + 1}-15`,
        departmentId: originalDepartmentId,
      },
    });
    assert.equal(response.statusCode, 201, response.body);
  }
}

test('dashboard statistics are role-appropriate', async () => {
  const adminView = await apiRequest(context.app, adminClient, 'GET', '/stats/dashboard');
  assert.equal(adminView.statusCode, 200);
  const adminStats = adminView.json() as {
    activeDocuments: number;
    deletedDocuments: number;
    incoming: number;
    outgoing: number;
    other: number;
    byStatus?: unknown;
    departments: number;
    users: number | null;
    recent: unknown[];
  };
  assert.equal(adminStats.activeDocuments, 8);
  assert.equal(adminStats.deletedDocuments, 0);
  assert.equal(adminStats.incoming, 4);
  assert.equal(adminStats.outgoing, 4);
  assert.equal(adminStats.other, 0);
  assert.equal(adminStats.byStatus, undefined);
  assert.equal(adminStats.departments, 2);
  assert.equal(adminStats.users, 2);
  assert.equal(adminStats.recent.length, 5);

  const employeeView = await apiRequest(context.app, employeeClient, 'GET', '/stats/dashboard');
  assert.equal(employeeView.statusCode, 200);
  const employeeStats = employeeView.json() as {
    activeDocuments: number;
    deletedDocuments: number;
    incoming: number;
    outgoing: number;
    other: number;
    departments: number;
    users: number | null;
    recent: Array<{ reference: string }>;
  };
  assert.equal(employeeStats.activeDocuments, 4);
  assert.equal(employeeStats.deletedDocuments, 0);
  assert.equal(employeeStats.incoming, 2);
  assert.equal(employeeStats.outgoing, 2);
  assert.equal(employeeStats.other, 0);
  assert.equal(employeeStats.departments, 1);
  assert.equal(employeeStats.users, null);
  assert.equal(employeeStats.recent.length, 4);
  assert.ok(employeeStats.recent.every((item) => item.reference.startsWith('REP-')));
});

test('report summaries aggregate by type, department, and month without exposing status', async () => {
  const response = await apiRequest(context.app, employeeClient, 'GET', '/reports/summary');
  assert.equal(response.statusCode, 200);
  const summary = response.json() as {
    total: number;
    byStatus?: unknown;
    byType: Array<{ type: string; count: number }>;
    byDepartment: Array<{ department: string; count: number }>;
  };
  assert.equal(summary.total, 4);
  assert.equal(summary.byStatus, undefined);
  assert.deepEqual(
    summary.byType.map((row) => `${row.type}:${row.count}`).sort(),
    ['incoming:2', 'outgoing:2'],
  );
  const general = summary.byDepartment.find((row) => row.department === 'الإدارة العامة');
  assert.equal(general?.count, 4);
  assert.equal(summary.byDepartment.length, 1);

  // مرشِّح الحالة متقاعد: يُقبل للتوافق ولا يغيّر النتيجة.
  const filtered = await apiRequest(context.app, employeeClient, 'GET', '/reports/summary?status=completed');
  assert.equal((filtered.json() as { total: number }).total, 4);
});

test('CSV export contains a BOM, Arabic headers, and one row per document', async () => {
  const response = await apiRequest(
    context.app,
    employeeClient,
    'GET',
    '/reports/documents.csv?dateFrom=2026-01-01&dateTo=2026-12-31',
  );
  assert.equal(response.statusCode, 200);
  assert.match(String(response.headers['content-type']), /text\/csv/);
  assert.match(String(response.headers['content-disposition']), /\.csv/);

  const text = response.body;
  assert.ok(text.startsWith('\uFEFF'));
  assert.ok(text.includes('الرقم الاشاري'));
  assert.ok(text.includes('رقم التسلسل'));
  assert.ok(text.includes('موضوع الرسالة'));
  assert.ok(text.includes('تاريخ الرسالة'));
  assert.ok(text.includes('REP-001'));
  assert.ok(text.includes('0012/A'));
  assert.equal(text.includes('الحالة'), false);
  assert.equal(text.includes('مكتملة'), false);

  const lines = text.trim().split(/\r?\n/);
  assert.equal(lines.length, 5);
});

test('audit log is admin-only and supports filtering', async () => {
  const employeeView = await apiRequest(context.app, employeeClient, 'GET', '/audit');
  assert.equal(employeeView.statusCode, 403);

  const employee = await context.pool.query<{ id: string }>(
    "SELECT id FROM users WHERE username = 'employee'",
  );
  const response = await apiRequest(
    context.app,
    adminClient,
    'GET',
    `/audit?action=document.created&actorUserId=${employee.rows[0]!.id}&pageSize=10`,
  );
  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    items: Array<{ action: string; actorUsername: string | null; entityType: string | null }>;
    total: number;
    page: number;
    pageSize: number;
  };
  assert.equal(body.total, 4);
  assert.equal(body.items.length, 4);
  for (const item of body.items) {
    assert.equal(item.action, 'document.created');
    assert.equal(item.actorUsername, 'employee');
    assert.equal(item.entityType, 'document');
  }

  const paged = await apiRequest(context.app, adminClient, 'GET', '/audit?page=2&pageSize=2');
  assert.equal((paged.json() as { items: unknown[] }).items.length, 2);

  const invalidDate = await apiRequest(context.app, adminClient, 'GET', '/audit?dateFrom=not-a-date');
  assert.equal(invalidDate.statusCode, 400);
});
