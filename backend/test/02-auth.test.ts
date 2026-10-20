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
  type TestContext,
} from './helpers.js';

let context: TestContext;
let adminId: string;
let employeeId: string;

before(async () => {
  context = await createTestContext();
  await ensureMigrated(context.pool);
});

beforeEach(async () => {
  await resetDatabase(context.pool);
  adminId = await createTestUser(context.pool, { username: 'admin', role: 'admin', displayName: 'مدير النظام' });
  employeeId = await createTestUser(context.pool, { username: 'employee', role: 'employee', displayName: 'موظف الأرشيف' });
});

after(async () => {
  await disposeTestContext(context);
});

test('login succeeds with valid credentials, sets an HttpOnly session cookie, and returns a CSRF token', async () => {
  const response = await context.app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username: 'admin', password: 'password-123' },
  });
  assert.equal(response.statusCode, 200);
  const setCookie = response.headers['set-cookie'];
  const cookieHeader = Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie);
  assert.match(cookieHeader, /hlc_session=/);
  assert.match(cookieHeader, /HttpOnly/i);
  assert.match(cookieHeader, /SameSite=Lax/i);

  const body = response.json() as { user: { username: string }; csrfToken: string };
  assert.equal(body.user.username, 'admin');
  assert.ok(body.csrfToken.length >= 32);

  const sessionCheck = await context.app.inject({
    method: 'GET',
    url: '/api/v1/auth/session',
    cookies: { hlc_session: /hlc_session=([^;]+)/.exec(cookieHeader)![1]! },
  });
  assert.equal(sessionCheck.statusCode, 200);
  assert.equal((sessionCheck.json() as { user: { username: string } }).user.username, 'admin');

  const audit = await context.pool.query(
    "SELECT 1 FROM audit_log WHERE action = 'auth.login.success' AND actor_user_id = $1",
    [adminId],
  );
  assert.equal(audit.rows.length, 1);
});

test('login rejects wrong password, unknown user, and inactive account with the same generic message', async () => {
  await createTestUser(context.pool, { username: 'inactive', isActive: false });
  const generic = 'اسم المستخدم أو كلمة المرور غير صحيحة.';

  for (const payload of [
    { username: 'admin', password: 'wrong-password' },
    { username: 'ghost-user', password: 'whatever-123' },
    { username: 'inactive', password: 'password-123' },
  ]) {
    const response = await context.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload });
    assert.equal(response.statusCode, 401);
    assert.equal((response.json() as { error: { message: string } }).error.message, generic);
  }

  const failures = await context.pool.query(
    "SELECT details FROM audit_log WHERE action = 'auth.login.failed' ORDER BY id ASC",
  );
  assert.equal(failures.rows.length, 3);
  const reasons = failures.rows.map((row) => (row.details as { reason: string }).reason);
  assert.deepEqual(reasons, ['bad_password', 'unknown_user', 'inactive_account']);
});

test('login accepts identifier for usernames or employee numbers and keeps username compatibility', async () => {
  const zeroId = await createTestUser(context.pool, {
    username: 'zero.emp',
    employeeNumber: '001245',
    displayName: 'صاحب الأصفار',
  });
  const alphaId = await createTestUser(context.pool, {
    username: 'alpha.emp',
    employeeNumber: 'EMP-A17',
  });
  const lowerId = await createTestUser(context.pool, {
    username: 'lower.emp',
    employeeNumber: 'abc-009',
  });

  const cases: Array<{ identifier: string; expectedUsername: string; expectedId: string }> = [
    { identifier: '001245', expectedUsername: 'zero.emp', expectedId: zeroId },
    { identifier: '  001245  ', expectedUsername: 'zero.emp', expectedId: zeroId },
    { identifier: 'EMP-A17', expectedUsername: 'alpha.emp', expectedId: alphaId },
    { identifier: 'emp-a17', expectedUsername: 'alpha.emp', expectedId: alphaId },
    { identifier: 'ABC-009', expectedUsername: 'lower.emp', expectedId: lowerId },
    { identifier: 'zero.emp', expectedUsername: 'zero.emp', expectedId: zeroId },
    { identifier: 'ZERO.EMP', expectedUsername: 'zero.emp', expectedId: zeroId },
  ];

  for (const entry of cases) {
    const response = await context.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { identifier: entry.identifier, password: 'password-123' },
    });
    assert.equal(response.statusCode, 200, `login failed for ${entry.identifier}`);
    const body = response.json() as {
      user: { id: string; username: string; displayName: string; role: string };
      csrfToken: string;
    };
    assert.equal(body.user.id, entry.expectedId);
    assert.equal(body.user.username, entry.expectedUsername);
    assert.ok(body.csrfToken.length >= 32);
    // لا تُعاد أي أسرار أو بصمات كلمات مرور ضمن استجابة الدخول.
    assert.doesNotMatch(response.body, /passwordHash|password_hash|argon2/i);

    const session = await context.pool.query<{ user_id: string }>(
      `SELECT s.user_id FROM sessions s
        WHERE s.user_id = $1 AND s.expires_at > now()`,
      [entry.expectedId],
    );
    assert.ok(session.rows.length >= 1);

    const audit = await context.pool.query<{ actor_username: string | null }>(
      `SELECT actor_username FROM audit_log
        WHERE action = 'auth.login.success' AND actor_user_id = $1
        ORDER BY id DESC LIMIT 1`,
      [entry.expectedId],
    );
    assert.equal(audit.rows[0]!.actor_username, entry.expectedUsername);
  }

  // العملاء القدامى الذين ما زالوا يرسلون username يعملون كما كانوا.
  const legacy = await context.app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username: 'ZERO.EMP', password: 'password-123' },
  });
  assert.equal(legacy.statusCode, 200);
  assert.equal((legacy.json() as { user: { username: string } }).user.username, 'zero.emp');

  // ويمكن للعميل القديم إرسال رقم وظيفي في حقل username أيضاً.
  const legacyEmployee = await context.app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username: '001245', password: 'password-123' },
  });
  assert.equal(legacyEmployee.statusCode, 200);
  assert.equal(
    (legacyEmployee.json() as { user: { username: string } }).user.username,
    'zero.emp',
  );
});

test('employee-number login failures stay generic and are audited internally', async () => {
  await createTestUser(context.pool, { username: 'known.emp', employeeNumber: 'KNOWN-1' });
  await createTestUser(context.pool, {
    username: 'inactive.emp',
    employeeNumber: 'INACT-1',
    isActive: false,
  });
  const generic = 'اسم المستخدم أو كلمة المرور غير صحيحة.';

  const cases = [
    { identifier: 'KNOWN-1', password: 'wrong-password', reason: 'bad_password' },
    { identifier: 'NO-SUCH-1', password: 'whatever-123', reason: 'unknown_user' },
    { identifier: 'inact-1', password: 'password-123', reason: 'inactive_account' },
  ];

  for (const entry of cases) {
    const response = await context.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { identifier: entry.identifier, password: entry.password },
    });
    assert.equal(response.statusCode, 401);
    assert.equal((response.json() as { error: { message: string } }).error.message, generic);
  }

  const failures = await context.pool.query<{ details: { reason: string } }>(
    "SELECT details FROM audit_log WHERE action = 'auth.login.failed' ORDER BY id ASC",
  );
  assert.deepEqual(
    failures.rows.map((row) => row.details.reason),
    ['bad_password', 'unknown_user', 'inactive_account'],
  );

  const sessions = await context.pool.query('SELECT 1 FROM sessions');
  assert.equal(sessions.rows.length, 0);
});

test('login requires one usable identifier and rejects conflicting or unknown fields', async () => {
  const bothSame = await context.app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { identifier: 'admin', username: 'ADMIN', password: 'password-123' },
  });
  assert.equal(bothSame.statusCode, 200);

  const conflicting = await context.app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { identifier: 'admin', username: 'employee', password: 'password-123' },
  });
  assert.equal(conflicting.statusCode, 400);
  assert.equal(
    (conflicting.json() as { error: { code: string } }).error.code,
    'identifier_mismatch',
  );

  const missingIdentifier = await context.app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { password: 'password-123' },
  });
  assert.equal(missingIdentifier.statusCode, 400);
  assert.equal(
    (missingIdentifier.json() as { error: { code: string } }).error.code,
    'validation_error',
  );

  const missingPassword = await context.app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { identifier: 'admin' },
  });
  assert.equal(missingPassword.statusCode, 400);

  const extraField = await context.app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { identifier: 'admin', password: 'password-123', role: 'admin' },
  });
  assert.equal(extraField.statusCode, 400);

  // معرّف من فراغات فقط لا يصلح ولا يكشف أي تفاصيل.
  const blank = await context.app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { identifier: '   ', password: 'password-123' },
  });
  assert.equal(blank.statusCode, 401);
  assert.equal(
    (blank.json() as { error: { message: string } }).error.message,
    'اسم المستخدم أو كلمة المرور غير صحيحة.',
  );
});

test('an identifier that matches a username and another employee number is rejected as ambiguous', async () => {
  const usernameOwner = await createTestUser(context.pool, {
    username: 'SHARED-77',
    employeeNumber: 'USR-1',
  });
  const employeeOwner = await createTestUser(context.pool, {
    username: 'emp.owner',
    employeeNumber: 'shared-77',
  });
  const generic = 'اسم المستخدم أو كلمة المرور غير صحيحة.';

  const ambiguous = await context.app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { identifier: 'Shared-77', password: 'password-123' },
  });
  assert.equal(ambiguous.statusCode, 401);
  assert.equal((ambiguous.json() as { error: { message: string } }).error.message, generic);

  const sessions = await context.pool.query('SELECT 1 FROM sessions');
  assert.equal(sessions.rows.length, 0);
  const audit = await context.pool.query<{ details: { reason: string } }>(
    `SELECT details FROM audit_log
      WHERE action = 'auth.login.failed' ORDER BY id DESC LIMIT 1`,
  );
  assert.equal(audit.rows[0]!.details.reason, 'ambiguous_identifier');

  // المعرّفات غير المتعارضة لكل حساب تبقى صالحة.
  const byUsername = await context.app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { identifier: 'emp.owner', password: 'password-123' },
  });
  assert.equal(byUsername.statusCode, 200);
  const byEmployee = await context.app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { identifier: 'usr-1', password: 'password-123' },
  });
  assert.equal(byEmployee.statusCode, 200);
  assert.equal(
    (byEmployee.json() as { user: { username: string } }).user.username,
    'SHARED-77',
  );
  assert.notEqual(usernameOwner, employeeOwner);
});

test('expired sessions are rejected and purged', async () => {
  const client = await loginClient(context.app, 'admin');
  await context.pool.query(
    "UPDATE sessions SET expires_at = now() - interval '1 second' WHERE user_id = $1",
    [adminId],
  );
  const response = await apiRequest(context.app, client, 'GET', '/auth/session');
  assert.equal(response.statusCode, 401);
  const remaining = await context.pool.query('SELECT 1 FROM sessions WHERE user_id = $1', [adminId]);
  assert.equal(remaining.rows.length, 0);
});

test('logout invalidates the session server-side', async () => {
  const client = await loginClient(context.app, 'employee');
  const logout = await apiRequest(context.app, client, 'POST', '/auth/logout');
  assert.equal(logout.statusCode, 200);

  const after = await apiRequest(context.app, client, 'GET', '/auth/session');
  assert.equal(after.statusCode, 401);

  const audit = await context.pool.query(
    "SELECT 1 FROM audit_log WHERE action = 'auth.logout' AND actor_user_id = $1",
    [employeeId],
  );
  assert.equal(audit.rows.length, 1);
});

test('mutating requests require a valid CSRF token while GET requests do not', async () => {
  const client = await loginClient(context.app, 'admin');

  const noCsrf = await context.app.inject({
    method: 'POST',
    url: '/api/v1/auth/password',
    cookies: { hlc_session: client.token },
    payload: { currentPassword: 'password-123', newPassword: 'new-password-456' },
  });
  assert.equal(noCsrf.statusCode, 403);
  assert.equal((noCsrf.json() as { error: { code: string } }).error.code, 'csrf_failed');

  const wrongCsrf = await context.app.inject({
    method: 'POST',
    url: '/api/v1/auth/password',
    cookies: { hlc_session: client.token },
    headers: { 'x-csrf-token': 'f'.repeat(64) },
    payload: { currentPassword: 'password-123', newPassword: 'new-password-456' },
  });
  assert.equal(wrongCsrf.statusCode, 403);

  const getOk = await apiRequest(context.app, client, 'GET', '/auth/session');
  assert.equal(getOk.statusCode, 200);
});

test('anonymous mutations fail with 401 (not 403)', async () => {
  const response = await apiRequest(context.app, null, 'POST', '/documents', {
    payload: { reference: 'X', title: 'Y', type: 'incoming', date: '2026-01-01' },
  });
  assert.equal(response.statusCode, 401);
});

test('requests from a foreign origin are rejected (origin check)', async () => {
  const response = await context.app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { origin: 'http://evil.example' },
    payload: { username: 'admin', password: 'password-123' },
  });
  assert.equal(response.statusCode, 403);
  assert.equal((response.json() as { error: { code: string } }).error.code, 'origin_not_allowed');
});

test('a configured PUBLIC_ORIGIN is enforced on mutations', async () => {
  const scoped = await createTestContext({ publicOrigin: 'http://archive.example' });
  try {
    const rejected = await scoped.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: 'http://evil.example' },
      payload: { username: 'admin', password: 'password-123' },
    });
    assert.equal(rejected.statusCode, 403);

    const accepted = await scoped.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: 'http://archive.example' },
      payload: { username: 'admin', password: 'password-123' },
    });
    assert.equal(accepted.statusCode, 200);
  } finally {
    await disposeTestContext(scoped);
  }
});

test('password change verifies the current password and revokes the other sessions', async () => {
  const first = await loginClient(context.app, 'admin');
  const second = await loginClient(context.app, 'admin');

  const wrongCurrent = await apiRequest(context.app, first, 'POST', '/auth/password', {
    payload: { currentPassword: 'wrong-password', newPassword: 'new-password-456' },
  });
  assert.equal(wrongCurrent.statusCode, 400);
  assert.equal(
    (wrongCurrent.json() as { error: { code: string } }).error.code,
    'invalid_current_password',
  );

  const changed = await apiRequest(context.app, first, 'POST', '/auth/password', {
    payload: { currentPassword: 'password-123', newPassword: 'new-password-456' },
  });
  assert.equal(changed.statusCode, 200);

  const secondAfter = await apiRequest(context.app, second, 'GET', '/auth/session');
  assert.equal(secondAfter.statusCode, 401);
  const firstAfter = await apiRequest(context.app, first, 'GET', '/auth/session');
  assert.equal(firstAfter.statusCode, 200);

  const oldLogin = await context.app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username: 'admin', password: 'password-123' },
  });
  assert.equal(oldLogin.statusCode, 401);
  const newLogin = await context.app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username: 'admin', password: 'new-password-456' },
  });
  assert.equal(newLogin.statusCode, 200);

  const audit = await context.pool.query(
    "SELECT details FROM audit_log WHERE action = 'auth.password.changed'",
  );
  assert.equal(audit.rows.length, 1);
  assert.ok(((audit.rows[0]!.details as { revokedSessions: number }).revokedSessions) >= 1);
});

test('login attempts are rate limited', async () => {
  const limited = await createTestContext({
    rateLimits: { loginMax: 3, sensitiveMax: 50, globalMax: 100000 },
  });
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await limited.app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { username: 'admin', password: 'wrong-password' },
      });
      assert.equal(response.statusCode, 401);
    }
    const blocked = await limited.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'admin', password: 'wrong-password' },
    });
    assert.equal(blocked.statusCode, 429);
    assert.equal((blocked.json() as { error: { code: string } }).error.code, 'rate_limited');
  } finally {
    await disposeTestContext(limited);
  }
});
