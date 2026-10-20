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

test('admin creates users with normalized employee numbers', async () => {
  const cases: Array<{
    username: string;
    employeeNumber?: string | null;
    expected: string | null;
  }> = [
    { username: 'empzero', employeeNumber: '  001245  ', expected: '001245' },
    { username: 'empalpha', employeeNumber: 'EMP-A17', expected: 'EMP-A17' },
    { username: 'emplower', employeeNumber: 'abc-009', expected: 'abc-009' },
    { username: 'empnone', expected: null },
    { username: 'empnull', employeeNumber: null, expected: null },
    { username: 'empempty', employeeNumber: '', expected: null },
    { username: 'empspace', employeeNumber: '   ', expected: null },
  ];

  for (const entry of cases) {
    const payload: Record<string, unknown> = {
      username: entry.username,
      displayName: entry.username,
      role: 'employee',
      password: 'password-123',
    };
    if ('employeeNumber' in entry) payload.employeeNumber = entry.employeeNumber;

    const response = await apiRequest(context.app, adminClient, 'POST', '/users', { payload });
    assert.equal(response.statusCode, 201, `create failed for ${entry.username}`);
    const user = (response.json() as { user: { employeeNumber: string | null } }).user;
    assert.equal(user.employeeNumber, entry.expected, `wrong employee number for ${entry.username}`);
  }

  const search = await apiRequest(context.app, adminClient, 'GET', '/users?q=001245');
  assert.equal(search.statusCode, 200);
  const listed = search.json() as {
    total: number;
    items: Array<{ username: string; employeeNumber: string | null }>;
  };
  assert.equal(listed.total, 1);
  assert.equal(listed.items[0]!.username, 'empzero');
  assert.equal(listed.items[0]!.employeeNumber, '001245');

  const byAlpha = await apiRequest(context.app, adminClient, 'GET', '/users?q=emp-a17');
  assert.equal((byAlpha.json() as { total: number }).total, 1);

  const audit = await context.pool.query<{ details: { employeeNumber: string | null } }>(
    "SELECT details FROM audit_log WHERE action = 'user.created' AND details->>'username' = 'empzero'",
  );
  assert.equal(audit.rows[0]!.details.employeeNumber, '001245');
});

test('employee numbers are unique case-insensitively, even under concurrent writes', async () => {
  const first = await apiRequest(context.app, adminClient, 'POST', '/users', {
    payload: {
      username: 'dup-one',
      displayName: 'مكرر أول',
      employeeNumber: 'DUP-100',
      role: 'employee',
      password: 'password-123',
    },
  });
  assert.equal(first.statusCode, 201);

  const duplicate = await apiRequest(context.app, adminClient, 'POST', '/users', {
    payload: {
      username: 'dup-two',
      displayName: 'مكرر ثانٍ',
      employeeNumber: 'dup-100',
      role: 'employee',
      password: 'password-123',
    },
  });
  assert.equal(duplicate.statusCode, 409);
  assert.equal(
    (duplicate.json() as { error: { code: string } }).error.code,
    'duplicate_employee_number',
  );

  // كتابتان متزامنتان: القيد الفريد في PostgreSQL هو الحكم النهائي، لا الفحص المسبق.
  const [left, right] = await Promise.all(
    ['CONC-1', 'conc-1'].map((employeeNumber, index) =>
      apiRequest(context.app, adminClient, 'POST', '/users', {
        payload: {
          username: `conc-${index}`,
          displayName: `متزامن ${index}`,
          employeeNumber,
          role: 'employee',
          password: 'password-123',
        },
      }),
    ),
  );
  assert.deepEqual([left.statusCode, right.statusCode].sort((a, b) => a - b), [201, 409]);

  const tooLong = 'a'.repeat(65);
  const oversized = await apiRequest(context.app, adminClient, 'POST', '/users', {
    payload: {
      username: 'toolong',
      displayName: 'طويل',
      employeeNumber: tooLong,
      role: 'employee',
      password: 'password-123',
    },
  });
  assert.equal(oversized.statusCode, 400);
  assert.equal(
    (oversized.json() as { error: { code: string } }).error.code,
    'employee_number_too_long',
  );

  const control = await apiRequest(context.app, adminClient, 'POST', '/users', {
    payload: {
      username: 'control',
      displayName: 'محارف تحكم',
      employeeNumber: 'EMP\u0001X',
      role: 'employee',
      password: 'password-123',
    },
  });
  assert.equal(control.statusCode, 400);
  assert.equal((control.json() as { error: { code: string } }).error.code, 'invalid_employee_number');

  const maxLength = 'b'.repeat(64);
  const atLimit = await apiRequest(context.app, adminClient, 'POST', '/users', {
    payload: {
      username: 'atlimit',
      displayName: 'الحد الأقصى',
      employeeNumber: maxLength,
      role: 'employee',
      password: 'password-123',
    },
  });
  assert.equal(atLimit.statusCode, 201);
  assert.equal(
    (atLimit.json() as { user: { employeeNumber: string | null } }).user.employeeNumber,
    maxLength,
  );
});

test('admin edits and clears employee numbers, and changes are audited', async () => {
  const targetId = await createTestUser(context.pool, {
    username: 'editable',
    displayName: 'قابل للتعديل',
  });

  const set = await apiRequest(context.app, adminClient, 'PATCH', `/users/${targetId}`, {
    payload: { employeeNumber: '  EMP-42  ' },
  });
  assert.equal(set.statusCode, 200);
  assert.equal(
    (set.json() as { user: { employeeNumber: string | null } }).user.employeeNumber,
    'EMP-42',
  );

  const listed = await apiRequest(context.app, adminClient, 'GET', '/users?q=EMP-42');
  const listedBody = listed.json() as {
    total: number;
    items: Array<{ id: string; employeeNumber: string | null }>;
  };
  assert.equal(listedBody.total, 1);
  assert.equal(listedBody.items[0]!.id, targetId);
  assert.equal(listedBody.items[0]!.employeeNumber, 'EMP-42');

  const setAudit = await context.pool.query<{ details: { changed: { employeeNumber?: string } } }>(
    `SELECT details FROM audit_log
      WHERE action = 'user.updated' AND entity_id = $1
      ORDER BY id DESC LIMIT 1`,
    [targetId],
  );
  assert.equal(setAudit.rows[0]!.details.changed.employeeNumber, 'EMP-42');

  // تعديل حقل آخر لا يمسّ الرقم الوظيفي.
  const otherField = await apiRequest(context.app, adminClient, 'PATCH', `/users/${targetId}`, {
    payload: { displayName: 'اسم جديد' },
  });
  assert.equal(
    (otherField.json() as { user: { employeeNumber: string | null } }).user.employeeNumber,
    'EMP-42',
  );

  const cleared = await apiRequest(context.app, adminClient, 'PATCH', `/users/${targetId}`, {
    payload: { employeeNumber: null },
  });
  assert.equal(cleared.statusCode, 200);
  assert.equal((cleared.json() as { user: { employeeNumber: string | null } }).user.employeeNumber, null);

  const listedAfterClear = await apiRequest(context.app, adminClient, 'GET', '/users?q=editable');
  assert.equal(
    (listedAfterClear.json() as { items: Array<{ employeeNumber: string | null }> }).items[0]!
      .employeeNumber,
    null,
  );

  // إعادة التعيين ثم المسح بقيمة فارغة/فراغات يطبّعها الخادم إلى NULL.
  await apiRequest(context.app, adminClient, 'PATCH', `/users/${targetId}`, {
    payload: { employeeNumber: 'E-2' },
  });
  const clearedByWhitespace = await apiRequest(context.app, adminClient, 'PATCH', `/users/${targetId}`, {
    payload: { employeeNumber: '   ' },
  });
  assert.equal(clearedByWhitespace.statusCode, 200);
  assert.equal(
    (clearedByWhitespace.json() as { user: { employeeNumber: string | null } }).user.employeeNumber,
    null,
  );

  const clearAudit = await context.pool.query<{ details: { changed: { employeeNumber?: null } } }>(
    `SELECT details FROM audit_log
      WHERE action = 'user.updated' AND entity_id = $1
      ORDER BY id DESC LIMIT 1`,
    [targetId],
  );
  assert.equal(clearAudit.rows[0]!.details.changed.employeeNumber, null);

  await createTestUser(context.pool, { username: 'otheruser', employeeNumber: 'OTHER-1' });
  const duplicate = await apiRequest(context.app, adminClient, 'PATCH', `/users/${targetId}`, {
    payload: { employeeNumber: 'other-1' },
  });
  assert.equal(duplicate.statusCode, 409);
  assert.equal(
    (duplicate.json() as { error: { code: string } }).error.code,
    'duplicate_employee_number',
  );

  const tooLong = await apiRequest(context.app, adminClient, 'PATCH', `/users/${targetId}`, {
    payload: { employeeNumber: 'a'.repeat(65) },
  });
  assert.equal(tooLong.statusCode, 400);
  assert.equal(
    (tooLong.json() as { error: { code: string } }).error.code,
    'employee_number_too_long',
  );
});

test('employees cannot create users or alter employee numbers directly', async () => {
  const list = await apiRequest(context.app, employeeClient, 'GET', '/users');
  assert.equal(list.statusCode, 403);

  const anonymous = await apiRequest(context.app, null, 'GET', '/users');
  assert.equal(anonymous.statusCode, 401);

  const create = await apiRequest(context.app, employeeClient, 'POST', '/users', {
    payload: {
      username: 'sneaky-emp',
      displayName: 'محاول',
      employeeNumber: 'HACK-1',
      role: 'employee',
      password: 'password-123',
    },
  });
  assert.equal(create.statusCode, 403);

  const patch = await apiRequest(context.app, employeeClient, 'PATCH', `/users/${employeeId}`, {
    payload: { employeeNumber: 'HACK-1' },
  });
  assert.equal(patch.statusCode, 403);

  const stored = await context.pool.query<{ employee_number: string | null }>(
    'SELECT employee_number FROM users WHERE id = $1',
    [employeeId],
  );
  assert.equal(stored.rows[0]!.employee_number, null);
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

test('pagination total stays correct on pages beyond the result set and with filters', async () => {
  for (let index = 0; index < 7; index += 1) {
    await createTestUser(context.pool, {
      username: `pagestaff-${index}`,
      displayName: `موظف صفحات ${index}`,
      employeeNumber: `P-000${index}`,
      role: 'employee',
    });
  }

  // الصفحة تتجاوز النتائج: لا صفوف، لكن الإجمالي يجب أن يبقى 7 لا صفراً.
  const beyond = await apiRequest(
    context.app,
    adminClient,
    'GET',
    '/users?q=pagestaff&page=99&pageSize=5',
  );
  assert.equal(beyond.statusCode, 200);
  const beyondBody = beyond.json() as { items: unknown[]; total: number };
  assert.equal(beyondBody.items.length, 0);
  assert.equal(beyondBody.total, 7);

  // الشروط المجتمعة (بحث + دور + حالة) مع صفحة متجاوزة.
  const filteredBeyond = await apiRequest(
    context.app,
    adminClient,
    'GET',
    '/users?q=pagestaff&role=employee&isActive=true&page=99&pageSize=5',
  );
  assert.equal((filteredBeyond.json() as { total: number }).total, 7);

  // بحث بالرقم الوظيفي مع ترقيم صفحات: صفحة ثانية داخل النتائج.
  const secondPage = await apiRequest(
    context.app,
    adminClient,
    'GET',
    '/users?q=P-000&role=employee&isActive=true&page=2&pageSize=3',
  );
  const secondBody = secondPage.json() as {
    items: Array<{ employeeNumber: string | null }>;
    total: number;
    page: number;
  };
  assert.equal(secondBody.total, 7);
  assert.equal(secondBody.items.length, 3);
  assert.equal(secondBody.page, 2);
  assert.ok(secondBody.items.every((item) => item.employeeNumber?.startsWith('P-000')));

  const empty = await apiRequest(context.app, adminClient, 'GET', '/users?q=no-such-user-xyz');
  const emptyBody = empty.json() as { items: unknown[]; total: number };
  assert.equal(emptyBody.items.length, 0);
  assert.equal(emptyBody.total, 0);
});
