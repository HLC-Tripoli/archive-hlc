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

test('GET /file-types returns active allowed file types and acceptString for authenticated users', async () => {
  const res = await apiRequest(context.app, employeeClient, 'GET', '/file-types');

  assert.equal(res.statusCode, 200);
  const body = res.json() as { items: any[]; extensions: string[]; acceptString: string };
  assert.ok(Array.isArray(body.items));
  assert.ok(body.items.length >= 17);
  assert.ok(body.extensions.includes('pdf'));
  assert.ok(body.extensions.includes('png'));
  assert.ok(body.extensions.includes('txt'));
  assert.ok(body.acceptString.includes('.pdf'));
});

test('GET /settings/file-types is restricted to admin', async () => {
  const empRes = await apiRequest(context.app, employeeClient, 'GET', '/settings/file-types');
  assert.equal(empRes.statusCode, 403);

  const adminRes = await apiRequest(context.app, adminClient, 'GET', '/settings/file-types');
  assert.equal(adminRes.statusCode, 200);
  const body = adminRes.json() as { items: any[] };
  assert.ok(body.items.length >= 17);
});

test('Admin can add a new file type, toggle it, and delete it', async () => {
  // 1. Add new file type: custom dwg
  const addRes = await apiRequest(context.app, adminClient, 'POST', '/settings/file-types', {
    payload: {
      extension: 'dwg',
      mimeType: 'image/vnd.dwg',
      category: 'image',
      labelAr: 'رسم هندسي DWG',
      labelEn: 'AutoCAD Drawing',
      isEnabled: true,
    },
  });
  assert.equal(addRes.statusCode, 201);
  const created = (addRes.json() as { fileType: any }).fileType;
  assert.equal(created.extension, 'dwg');
  assert.equal(created.isEnabled, true);

  // Verify it appears in active file types
  const listRes = await apiRequest(context.app, employeeClient, 'GET', '/file-types');
  const listBody = listRes.json() as { extensions: string[] };
  assert.ok(listBody.extensions.includes('dwg'));

  // 2. Toggle disabled
  const toggleRes = await apiRequest(context.app, adminClient, 'PATCH', '/settings/file-types/dwg', {
    payload: { isEnabled: false },
  });
  assert.equal(toggleRes.statusCode, 200);
  const toggled = (toggleRes.json() as { fileType: any }).fileType;
  assert.equal(toggled.isEnabled, false);

  // Verify it is no longer in active extensions
  const listAfterToggle = await apiRequest(context.app, employeeClient, 'GET', '/file-types');
  assert.ok(!(listAfterToggle.json() as { extensions: string[] }).extensions.includes('dwg'));

  // 3. Delete file type
  const delRes = await apiRequest(context.app, adminClient, 'DELETE', '/settings/file-types/dwg');
  assert.equal(delRes.statusCode, 200);
});

test('Disabling a file type rejects uploads of that type', async () => {
  // Create document
  const docRes = await apiRequest(context.app, adminClient, 'POST', '/documents', {
    payload: {
      title: 'وثيقة اختبار تعطيل الصيغة',
      date: '2026-11-02',
      type: 'incoming',
    },
  });
  assert.equal(docRes.statusCode, 201);
  const docId = (docRes.json() as { document: { id: string } }).document.id;

  // 1. Uploading txt should succeed initially
  const txtPayload = multipartFixture({
    file: {
      filename: 'sample.txt',
      contentType: 'text/plain',
      data: Buffer.from('محتوى نصي'),
    },
  });
  const firstUpload = await apiRequest(context.app, adminClient, 'POST', `/documents/${docId}/files`, {
    headers: { 'content-type': txtPayload.contentType },
    payload: txtPayload.body,
  });
  assert.equal(firstUpload.statusCode, 201);

  // 2. Disable txt format in settings
  const disableRes = await apiRequest(context.app, adminClient, 'PATCH', '/settings/file-types/txt', {
    payload: { isEnabled: false },
  });
  assert.equal(disableRes.statusCode, 200);

  // 3. Uploading txt now should be rejected with 400 unsupported_file_type
  const secondUpload = await apiRequest(context.app, adminClient, 'POST', `/documents/${docId}/files`, {
    headers: { 'content-type': txtPayload.contentType },
    payload: txtPayload.body,
  });
  assert.equal(secondUpload.statusCode, 400);
  const errBody = secondUpload.json() as { error: { code: string; message: string } };
  assert.equal(errBody.error.code, 'unsupported_file_type');

  // 4. Re-enable txt format
  await apiRequest(context.app, adminClient, 'PATCH', '/settings/file-types/txt', {
    payload: { isEnabled: true },
  });

  // 5. Uploading txt should succeed again
  const thirdUpload = await apiRequest(context.app, adminClient, 'POST', `/documents/${docId}/files`, {
    headers: { 'content-type': txtPayload.contentType },
    payload: txtPayload.body,
  });
  assert.equal(thirdUpload.statusCode, 201);
});

test('POST /settings/file-types/reset restores all default file types', async () => {
  // Delete a type
  await apiRequest(context.app, adminClient, 'DELETE', '/settings/file-types/csv');

  // Reset to default
  const resetRes = await apiRequest(context.app, adminClient, 'POST', '/settings/file-types/reset');
  assert.equal(resetRes.statusCode, 200);
  const body = resetRes.json() as { items: any[] };
  const extensions = body.items.map((i) => i.extension);
  assert.ok(extensions.includes('csv'));
  assert.ok(extensions.includes('pdf'));
});
