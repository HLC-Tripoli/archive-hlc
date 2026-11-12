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
  assert.equal(body.version, '1.0.51');
  assert.equal(res.headers['x-app-version'], '1.0.51');
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

  // Employee cannot change status to in_progress (only admin can)
  const empStatus = await apiRequest(context.app, employeeClient, 'PATCH', `/tickets/${created.id}/status`, {
    payload: {
      status: 'in_progress',
    },
  });
  assert.equal(empStatus.statusCode, 403);

  // 6. Employee cannot edit ticket via PATCH /tickets/:id
  const empEdit = await apiRequest(context.app, employeeClient, 'PATCH', `/tickets/${created.id}`, {
    payload: { title: 'عنوان معدل من موظف' },
  });
  assert.equal(empEdit.statusCode, 403);

  // 7. Admin edits ticket via PATCH /tickets/:id
  const adminEdit = await apiRequest(context.app, adminClient, 'PATCH', `/tickets/${created.id}`, {
    payload: { title: 'عنوان معدل من المدير', status: 'closed' },
  });
  assert.equal(adminEdit.statusCode, 200);
  const editBody = adminEdit.json() as { ticket: { title: string; status: string } };
  assert.equal(editBody.ticket.title, 'عنوان معدل من المدير');
  assert.equal(editBody.ticket.status, 'closed');

  // 8. Employee cannot delete ticket
  const empDel = await apiRequest(context.app, employeeClient, 'DELETE', `/tickets/${created.id}`);
  assert.equal(empDel.statusCode, 403);

  // 9. Admin deletes ticket
  const adminDel = await apiRequest(context.app, adminClient, 'DELETE', `/tickets/${created.id}`);
  assert.equal(adminDel.statusCode, 200);

  // 10. Verify ticket is gone
  const verifyGone = await apiRequest(context.app, adminClient, 'GET', `/tickets/${created.id}`);
  assert.equal(verifyGone.statusCode, 404);
});

test('Support ticket image attachments: upload on create, download, reply with image', async () => {
  const pngBytes = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
    0x42, 0x60, 0x82,
  ]);

  function makeMultipart(fields: Record<string, string>, file?: { filename: string; contentType: string; content: Buffer }) {
    const boundary = '----hlcTestBoundary' + Date.now();
    const parts: Buffer[] = [];
    for (const [k, v] of Object.entries(fields)) {
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`, 'utf8'));
    }
    if (file) {
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`, 'utf8'));
      parts.push(file.content);
      parts.push(Buffer.from('\r\n', 'utf8'));
    }
    parts.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
    return {
      payload: Buffer.concat(parts),
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    };
  }

  // 1. Employee creates a ticket with an attached screenshot
  const mpCreate = makeMultipart(
    {
      title: 'خطأ عند فتح شاشة الأرشيف',
      message: 'تظهر لي هذه الرسالة كما في لقطة الشاشة المرفقة',
    },
    {
      filename: 'error-screen.png',
      contentType: 'image/png',
      content: pngBytes,
    },
  );

  const createRes = await apiRequest(context.app, employeeClient, 'POST', '/tickets', {
    payload: mpCreate.payload,
    headers: mpCreate.headers,
  });
  assert.equal(createRes.statusCode, 201);
  const created = createRes.json() as { id: string; title: string; hasAttachment: boolean };
  assert.ok(created.id);
  assert.equal(created.hasAttachment, true);

  // 2. Fetch ticket details and inspect initial message attachment
  const detailRes = await apiRequest(context.app, employeeClient, 'GET', `/tickets/${created.id}`);
  assert.equal(detailRes.statusCode, 200);
  const detail = detailRes.json() as {
    ticket: { id: string; title: string };
    messages: Array<{
      id: string;
      message: string;
      attachmentName?: string;
      attachmentMimeType?: string;
      hasAttachment?: boolean;
    }>;
  };
  assert.equal(detail.messages.length, 1);
  const firstMsg = detail.messages[0]!;
  assert.equal(firstMsg.hasAttachment, true);
  assert.equal(firstMsg.attachmentName, 'error-screen.png');
  assert.equal(firstMsg.attachmentMimeType, 'image/png');

  // 3. Download/stream the attached image
  const attachRes = await apiRequest(
    context.app,
    employeeClient,
    'GET',
    `/tickets/${created.id}/messages/${firstMsg.id}/attachment`,
  );
  assert.equal(attachRes.statusCode, 200);
  assert.equal(attachRes.headers['content-type'], 'image/png');
  assert.deepEqual(attachRes.rawPayload, pngBytes);

  // Admin can also view the attachment
  const adminAttachRes = await apiRequest(
    context.app,
    adminClient,
    'GET',
    `/tickets/${created.id}/messages/${firstMsg.id}/attachment`,
  );
  assert.equal(adminAttachRes.statusCode, 200);
  assert.deepEqual(adminAttachRes.rawPayload, pngBytes);

  // 4. Admin replies with an image
  const mpReply = makeMultipart(
    {
      message: 'يرجى مراجعة هذا الإعداد للتأكد من حله',
    },
    {
      filename: 'solution-guide.png',
      contentType: 'image/png',
      content: pngBytes,
    },
  );

  const replyRes = await apiRequest(context.app, adminClient, 'POST', `/tickets/${created.id}/messages`, {
    payload: mpReply.payload,
    headers: mpReply.headers,
  });
  assert.equal(replyRes.statusCode, 201);
  const replyBody = replyRes.json() as {
    message: { id: string; message: string; hasAttachment: boolean; attachmentName: string };
  };
  assert.equal(replyBody.message.hasAttachment, true);
  assert.equal(replyBody.message.attachmentName, 'solution-guide.png');

  // 5. Cleanup: Admin deletes ticket
  const delRes = await apiRequest(context.app, adminClient, 'DELETE', `/tickets/${created.id}`);
  assert.equal(delRes.statusCode, 200);
});
