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

test('Notifications workflow: list, unread-count, read, read-all, and triggers', async () => {
  // 1. Initially notifications list is empty
  const initialRes = await apiRequest(context.app, adminClient, 'GET', '/notifications');
  assert.equal(initialRes.statusCode, 200);
  const initialBody = initialRes.json() as { items: unknown[]; unreadCount: number };
  assert.equal(initialBody.items.length, 0);
  assert.equal(initialBody.unreadCount, 0);

  // 2. Employee creates a ticket -> triggers notification for admin
  const ticketRes = await apiRequest(context.app, employeeClient, 'POST', '/tickets', {
    payload: {
      title: 'طلب صيانة طابعة',
      message: 'الطابعة لا تستجيب للأمر.',
    },
  });
  assert.equal(ticketRes.statusCode, 201);
  const ticketData = ticketRes.json() as { id: string };

  // 3. Admin checks notifications
  const adminNotifsRes = await apiRequest(context.app, adminClient, 'GET', '/notifications');
  assert.equal(adminNotifsRes.statusCode, 200);
  const adminNotifs = adminNotifsRes.json() as { items: Array<{ id: string; title: string; isRead: boolean }>; unreadCount: number };
  assert.equal(adminNotifs.unreadCount, 1);
  assert.equal(adminNotifs.items.length, 1);
  assert.equal(adminNotifs.items[0]?.title, 'تذكرة دعم جديدة');
  assert.equal(adminNotifs.items[0]?.isRead, false);

  // 4. Admin checks unread-count endpoint
  const countRes = await apiRequest(context.app, adminClient, 'GET', '/notifications/unread-count');
  assert.equal(countRes.statusCode, 200);
  assert.equal((countRes.json() as { unreadCount: number }).unreadCount, 1);

  // 5. Admin marks notification as read
  const notifId = adminNotifs.items[0]!.id;
  const readRes = await apiRequest(context.app, adminClient, 'PATCH', `/notifications/${notifId}/read`);
  assert.equal(readRes.statusCode, 200);
  assert.equal((readRes.json() as { success: boolean; unreadCount: number }).unreadCount, 0);

  // 6. Admin replies to ticket -> triggers notification for employee
  const replyRes = await apiRequest(context.app, adminClient, 'POST', `/tickets/${ticketData.id}/messages`, {
    payload: {
      message: 'جاري فحص اتصال الكابل بالطابعة.',
    },
  });
  assert.equal(replyRes.statusCode, 201);

  // 7. Employee checks notifications
  const empNotifsRes = await apiRequest(context.app, employeeClient, 'GET', '/notifications');
  assert.equal(empNotifsRes.statusCode, 200);
  const empNotifs = empNotifsRes.json() as { items: Array<{ id: string; title: string; isRead: boolean }>; unreadCount: number };
  assert.equal(empNotifs.unreadCount, 1);
  assert.equal(empNotifs.items.length, 1);
  assert.equal(empNotifs.items[0]?.title, 'رد جديد على تذكرة الدعم');

  // 8. Employee marks all as read
  const readAllRes = await apiRequest(context.app, employeeClient, 'POST', '/notifications/read-all');
  assert.equal(readAllRes.statusCode, 200);
  assert.equal((readAllRes.json() as { unreadCount: number }).unreadCount, 0);

  const empNotifsAfter = await apiRequest(context.app, employeeClient, 'GET', '/notifications');
  assert.equal((empNotifsAfter.json() as { unreadCount: number }).unreadCount, 0);
});
