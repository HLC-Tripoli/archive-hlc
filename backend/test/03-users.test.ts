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
let adminId: string;
let employeeId: string;

before(async () => {
  context = await createTestContext();
  await ensureMigrated(context.pool);
});

beforeEach(async () => {
  await resetDatabase(context.pool);
  adminId = await createTestUser(context.pool, {
    username: 'admin',
    role: 'admin',
    displayName: 'مدير النظام',
  });
  employeeId = await createTestUser(context.pool, {
    username: 'employee',
    role: 'employee',
    displayName: 'موظف الأرشيف',
  });
  adminClient = await loginClient(context.app, 'admin');
  employeeClient = await loginClient(context.app, 'employee');
});

after(async () => {
  await disposeTestContext(context);
});

test('employees cannot access user administration', async () => {
  const list = await apiRequest(context.app, employeeClient, 'GET', '/users');
  assert.equal(list.statusCode, 403);

  const create = await apiRequest(context.app, employeeClient, 'POST', '/users', {
    payload: { username: 'sneaky', displayName: 'محاول', role: 'admin', password: 'password-123' },
  });
  assert.equal(create.statusCode, 403);

  const patch = await apiRequest(context.app, employeeClient, 'PATCH', `/users/${employeeId}`, {
    payload: { displayName: 'تغيير' },
  });
  assert.equal(patch.statusCode, 403);

  const reset = await apiRequest(context.app, employeeClient, 'POST', `/users/${employeeId}/password`, {
    payload: { password: 'new-password-456' },
  });
  assert.equal(reset.statusCode, 403);
});

test('admin creates a user, and usernames are unique case-insensitively', async () => {
  const created = await apiRequest(context.app, adminClient, 'POST', '/users', {
    payload: {
      username: 'newuser',
      displayName: 'مستخدم جديد',
      role: 'employee',
      password: 'password-123',
    },
  });
  assert.equal(created.statusCode, 201);
  const user = (created.json() as { user: { username: string; role: string; isActive: boolean } }).user;
  assert.equal(user.username, 'newuser');
  assert.equal(user.role, 'employee');
  assert.equal(user.isActive, true);

  const duplicate = await apiRequest(context.app, adminClient, 'POST', '/users', {
    payload: {
      username: 'ADMIN',
      displayName: 'مكرر',
      role: 'employee',
      password: 'password-123',
    },
  });
  assert.equal(duplicate.statusCode, 409);
  assert.equal((duplicate.json() as { error: { code: string } }).error.code, 'duplicate_username');

  const shortUsername = await apiRequest(context.app, adminClient, 'POST', '/users', {
    payload: { username: 'ab', displayName: 'قصير', role: 'employee', password: 'password-123' },
  });
  assert.equal(shortUsername.statusCode, 400);
  assert.equal((shortUsername.json() as { error: { code: string } }).error.code, 'validation_error');

  const shortPassword = await apiRequest(context.app, adminClient, 'POST', '/users', {
    payload: { username: 'okuser', displayName: 'قصير', role: 'employee', password: 'short' },
  });
  assert.equal(shortPassword.statusCode, 400);

  const audit = await context.pool.query("SELECT 1 FROM audit_log WHERE action = 'user.created'");
  assert.equal(audit.rows.length, 1);
});

test('admin updates users, and deactivation revokes the target sessions', async () => {
  const targetId = await createTestUser(context.pool, { username: 'target', displayName: 'هدف' });
  const targetClient = await loginClient(context.app, 'target');

  const renamed = await apiRequest(context.app, adminClient, 'PATCH', `/users/${targetId}`, {
    payload: { displayName: 'اسم محدث' },
  });
  assert.equal(renamed.statusCode, 200);
  assert.equal(
    (renamed.json() as { user: { displayName: string } }).user.displayName,
    'اسم محدث',
  );

  const deactivated = await apiRequest(context.app, adminClient, 'PATCH', `/users/${targetId}`, {
    payload: { isActive: false },
  });
  assert.equal(deactivated.statusCode, 200);
  assert.equal((deactivated.json() as { user: { isActive: boolean } }).user.isActive, false);

  const targetAfter = await apiRequest(context.app, targetClient, 'GET', '/auth/session');
  assert.equal(targetAfter.statusCode, 401);

  const loginAttempt = await context.app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username: 'target', password: 'password-123' },
  });
  assert.equal(loginAttempt.statusCode, 401);

  const audit = await context.pool.query(
    "SELECT details FROM audit_log WHERE action = 'user.updated' ORDER BY id DESC LIMIT 1",
  );
  assert.ok(((audit.rows[0]!.details as { revokedSessions: number }).revokedSessions) >= 1);

  const unknown = await apiRequest(
    context.app,
    adminClient,
    'PATCH',
    '/users/00000000-0000-4000-8000-000000000000',
    { payload: { displayName: 'لا يوجد' } },
  );
  assert.equal(unknown.statusCode, 404);
});

test('admin cannot deactivate their own account', async () => {
  const response = await apiRequest(context.app, adminClient, 'PATCH', `/users/${adminId}`, {
    payload: { isActive: false },
  });
  assert.equal(response.statusCode, 400);
  assert.equal((response.json() as { error: { code: string } }).error.code, 'self_deactivate');
});

test('the last active admin cannot be demoted or deactivated', async () => {
  const demote = await apiRequest(context.app, adminClient, 'PATCH', `/users/${adminId}`, {
    payload: { role: 'employee' },
  });
  assert.equal(demote.statusCode, 409);
  assert.equal((demote.json() as { error: { code: string } }).error.code, 'last_admin');
});

test('admin password reset revokes the target sessions', async () => {
  const targetId = await createTestUser(context.pool, { username: 'target2' });
  const targetClient = await loginClient(context.app, 'target2');

  const reset = await apiRequest(context.app, adminClient, 'POST', `/users/${targetId}/password`, {
    payload: { password: 'reset-password-456' },
  });
  assert.equal(reset.statusCode, 200);

  const targetAfter = await apiRequest(context.app, targetClient, 'GET', '/auth/session');
  assert.equal(targetAfter.statusCode, 401);

  const oldLogin = await context.app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username: 'target2', password: 'password-123' },
  });
  assert.equal(oldLogin.statusCode, 401);

  const newLogin = await context.app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username: 'target2', password: 'reset-password-456' },
  });
  assert.equal(newLogin.statusCode, 200);

  const audit = await context.pool.query(
    "SELECT 1 FROM audit_log WHERE action = 'user.password_reset' AND entity_id = $1",
    [targetId],
  );
  assert.equal(audit.rows.length, 1);
});

test('user list supports search, role filter, and pagination', async () => {
  for (let index = 0; index < 7; index += 1) {
    await createTestUser(context.pool, {
      username: `staff-${index}`,
      displayName: `موظف رقم ${index}`,
      role: 'employee',
    });
  }

  const filtered = await apiRequest(context.app, adminClient, 'GET', '/users?q=staff&pageSize=5');
  assert.equal(filtered.statusCode, 200);
  const body = filtered.json() as { items: unknown[]; total: number; pageSize: number };
  assert.equal(body.total, 7);
  assert.equal(body.items.length, 5);
  assert.equal(body.pageSize, 5);

  const byRole = await apiRequest(context.app, adminClient, 'GET', '/users?role=admin');
  const roleBody = byRole.json() as { total: number };
  assert.equal(roleBody.total, 1);

  const inactive = await apiRequest(context.app, adminClient, 'GET', '/users?isActive=false');
  assert.equal((inactive.json() as { total: number }).total, 0);
});
