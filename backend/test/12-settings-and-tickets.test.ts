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
  await createTestUser(context.pool, {
    username: 'employee',
    role: 'employee',
    permissions: ['view', 'create', 'edit', 'delete'],
  });
  adminClient = await loginClient(context.app, 'admin');
  employeeClient = await loginClient(context.app, 'employee');
  context.storage.objects.clear();
});

after(async () => {
  await disposeTestContext(context);
});

test('GET /version returns current application version and header', async () => {
  const res = await apiRequest(context.app, employeeClient, 'GET', '/version');
  assert.equal(res.statusCode, 200);
  const body = res.json() as { version: string };
  assert.equal(body.version, '1.0.45');
  assert.equal(res.headers['x-app-version'], '1.0.45');
});

test('GET /settings returns default uploadMaxMb', async () => {
  const res = await apiRequest(context.app, employeeClient, 'GET', '/settings');
  assert.equal(res.statusCode, 200);
  const body = res.json() as { uploadMaxMb: number };
  assert.equal(body.uploadMaxMb, context.config.uploadMaxMb);
});

test('PATCH /settings is restricted to admin and updates value', async () => {
  // Employee cannot change settings
  const forbidden = await apiRequest(context.app, employeeClient, 'PATCH', '/settings', {
    payload: { uploadMaxMb: 50 },
  });
  assert.equal(forbidden.statusCode, 403);

  // Admin updates setting
  const res = await apiRequest(context.app, adminClient, 'PATCH', '/settings', {
    payload: { uploadMaxMb: 50 },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json() as { uploadMaxMb: number };
  assert.equal(body.uploadMaxMb, 50);

  // Verify updated value via GET
  const verify = await apiRequest(context.app, employeeClient, 'GET', '/settings');
  assert.equal(verify.statusCode, 200);
  assert.equal((verify.json() as { uploadMaxMb: number }).uploadMaxMb, 50);

  // Out of range rejected
  const invalid = await apiRequest(context.app, adminClient, 'PATCH', '/settings', {
    payload: { uploadMaxMb: 200 },
  });
  assert.equal(invalid.statusCode, 400);
});

test('Support tickets workflow: create, list, chat message, status update', async () => {
  // 1. Employee creates a ticket
  const createRes = await apiRequest(context.app, employeeClient, 'POST', '/tickets', {
    payload: {
      title: 'مشكلة في تحميل المرفقات',
      message: 'لا أستطيع تحميل ملف بحجم 30 ميجابايت',
    },
  });
  assert.equal(createRes.statusCode, 201);
  const created = createRes.json() as { id: string; title: string; status: string };
  assert.ok(created.id);
  assert.equal(created.title, 'مشكلة في تحميل المرفقات');
  assert.equal(created.status, 'open');

  // Verify details
  const getCreated = await apiRequest(context.app, employeeClient, 'GET', `/tickets/${created.id}`);
  assert.equal(getCreated.statusCode, 200);
  const detail = getCreated.json() as { ticket: { id: string; title: string; status: string }; messages: any[] };
  assert.equal(detail.ticket.title, 'مشكلة في تحميل المرفقات');
  assert.equal(detail.ticket.status, 'open');
  assert.equal(detail.messages.length, 1);
  assert.equal(detail.messages[0].message, 'لا أستطيع تحميل ملف بحجم 30 ميجابايت');

  // 2. Listing tickets
  // Employee sees own ticket
  const empList = await apiRequest(context.app, employeeClient, 'GET', '/tickets');
  assert.equal(empList.statusCode, 200);
  const empTickets = empList.json() as { items: any[] };
  assert.equal(empTickets.items.length, 1);

  // Admin sees all tickets
  const adminList = await apiRequest(context.app, adminClient, 'GET', '/tickets');
  assert.equal(adminList.statusCode, 200);
  const adminTickets = adminList.json() as { items: any[] };
  assert.equal(adminTickets.items.length, 1);

  // 3. Admin replies to ticket
  const replyRes = await apiRequest(context.app, adminClient, 'POST', `/tickets/${created.id}/messages`, {
    payload: {
      message: 'تم زيادة الحد الأقصى للمرفقات إلى 50 ميجابايت، يرجى المحاولة الآن.',
    },
  });
  assert.equal(replyRes.statusCode, 201);

  // 4. Fetch ticket details and verify 2 messages
  const detailRes = await apiRequest(context.app, employeeClient, 'GET', `/tickets/${created.id}`);
  assert.equal(detailRes.statusCode, 200);
  const detail2 = detailRes.json() as { messages: any[] };
  assert.equal(detail2.messages.length, 2);
  assert.equal(detail2.messages[1].senderRole, 'admin');

  // 5. Admin updates status to resolved
  const statusRes = await apiRequest(context.app, adminClient, 'PATCH', `/tickets/${created.id}/status`, {
    payload: {
      status: 'resolved',
    },
  });
  assert.equal(statusRes.statusCode, 200);
  const updatedTicket = statusRes.json() as { status: string };
  assert.equal(updatedTicket.status, 'resolved');

  // Employee cannot update status
  const empStatus = await apiRequest(context.app, employeeClient, 'PATCH', `/tickets/${created.id}/status`, {
    payload: {
      status: 'closed',
    },
  });
  assert.equal(empStatus.statusCode, 403);
});
