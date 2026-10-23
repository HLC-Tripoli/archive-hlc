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
  type InjectResult,
  type TestContext,
} from './helpers.js';

let context: TestContext;
let adminClient: AuthedClient;
let employeeClient: AuthedClient;

const PNG_BYTES = Buffer.concat([
  Buffer.from('89504e470d0a1a0a', 'hex'),
  Buffer.alloc(128, 7),
]);

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
  context.storage.objects.clear();
  context.storage.failPut = false;
  context.storage.failGet = false;
  context.storage.failDelete = false;
});

after(async () => {
  await disposeTestContext(context);
});

async function createDocument(reference: string): Promise<string> {
  const response = await apiRequest(context.app, employeeClient, 'POST', '/documents', {
    payload: { reference, title: `معاملة ${reference}`, type: 'incoming', date: '2026-01-15' },
  });
  assert.equal(response.statusCode, 201, response.body);
  return (response.json() as { document: { id: string } }).document.id;
}

function uploadFile(
  documentId: string,
  filename: string,
  contentType: string,
  content: Buffer,
  fieldName?: string,
): Promise<InjectResult> {
  const fixture = multipartFixture({ filename, contentType, content, fieldName });
  return apiRequest(context.app, employeeClient, 'POST', `/documents/${documentId}/files`, {
    payload: fixture.payload,
    headers: fixture.headers,
  });
}

test('uploads an attachment, records it, and streams it back on download', async () => {
  const documentId = await createDocument('FILE-1');

  const uploaded = await uploadFile(documentId, 'scan.png', 'image/png', PNG_BYTES);
  assert.equal(uploaded.statusCode, 201, uploaded.body);
  const file = (uploaded.json() as { file: { id: string; originalName: string; sizeBytes: number } }).file;
  assert.equal(file.originalName, 'scan.png');
  assert.equal(file.sizeBytes, PNG_BYTES.length);

  assert.equal(context.storage.objects.size, 1);
  const [storedKey, stored] = [...context.storage.objects.entries()][0]!;
  assert.match(storedKey, /^documents\//);
  assert.ok(stored.data.equals(PNG_BYTES));

  const detail = await apiRequest(context.app, employeeClient, 'GET', `/documents/${documentId}`);
  assert.equal(
    (detail.json() as { document: { files: unknown[]; filesCount: number } }).document.files.length,
    1,
  );
  assert.equal(
    (detail.json() as { document: { filesCount: number } }).document.filesCount,
    1,
  );

  const download = await apiRequest(context.app, employeeClient, 'GET', `/files/${file.id}/download`);
  assert.equal(download.statusCode, 200);
  assert.ok(download.rawPayload.equals(PNG_BYTES));
  assert.match(String(download.headers['content-disposition']), /^attachment;/);
  assert.match(String(download.headers['cache-control']), /no-store/);

  const view = await apiRequest(context.app, employeeClient, 'GET', `/files/${file.id}/view`);
  assert.equal(view.statusCode, 200, view.body);
  assert.ok(view.rawPayload.equals(PNG_BYTES));
  assert.equal(String(view.headers['content-type']), 'image/png');
  assert.match(String(view.headers['content-disposition']), /^inline;/);
  assert.match(String(view.headers['cache-control']), /private/);
  assert.match(String(view.headers['cache-control']), /no-store/);
  assert.equal(String(view.headers['x-content-type-options']), 'nosniff');

  const audit = await context.pool.query(
    "SELECT action FROM audit_log WHERE action IN ('file.uploaded', 'file.downloaded', 'file.viewed') ORDER BY id ASC",
  );
  assert.deepEqual(
    audit.rows.map((row) => row.action),
    ['file.uploaded', 'file.downloaded', 'file.viewed'],
  );
});

test('inline viewing permits PDF and safe images only and never serves active content inline', async () => {
  const documentId = await createDocument('FILE-VIEW');
  const pdf = await uploadFile(documentId, 'scan.pdf', 'application/pdf', Buffer.from('%PDF-1.4\n%%EOF\n'));
  assert.equal(pdf.statusCode, 201, pdf.body);
  const pdfId = (pdf.json() as { file: { id: string } }).file.id;
  const pdfView = await apiRequest(context.app, employeeClient, 'GET', `/files/${pdfId}/view`);
  assert.equal(pdfView.statusCode, 200, pdfView.body);
  assert.equal(String(pdfView.headers['content-type']), 'application/pdf');
  assert.match(String(pdfView.headers['content-disposition']), /^inline;/);
  assert.equal(String(pdfView.headers['x-content-type-options']), 'nosniff');

  const csv = await uploadFile(
    documentId,
    'report.csv',
    'text/csv',
    Buffer.from('reference,title\nCSV-1,test\n'),
  );
  assert.equal(csv.statusCode, 201, csv.body);
  const csvId = (csv.json() as { file: { id: string } }).file.id;
  const csvView = await apiRequest(context.app, employeeClient, 'GET', `/files/${csvId}/view`);
  assert.equal(csvView.statusCode, 415);
  assert.equal((csvView.json() as { error: { code: string } }).error.code, 'unsupported_preview');
  const csvDownload = await apiRequest(context.app, employeeClient, 'GET', `/files/${csvId}/download`);
  assert.equal(csvDownload.statusCode, 200);
  assert.match(String(csvDownload.headers['content-disposition']), /^attachment;/);
  const viewed = await context.pool.query("SELECT 1 FROM audit_log WHERE action = 'file.viewed'");
  assert.equal(viewed.rows.length, 1);
});

test('rejects unsupported types, wrong content types, and missing files', async () => {
  const documentId = await createDocument('FILE-2');

  const exe = await uploadFile(documentId, 'malware.exe', 'application/octet-stream', PNG_BYTES);
  assert.equal(exe.statusCode, 400);
  assert.equal((exe.json() as { error: { code: string } }).error.code, 'unsupported_file_type');

  const json = await apiRequest(context.app, employeeClient, 'POST', `/documents/${documentId}/files`, {
    payload: { hello: 'world' },
  });
  assert.equal(json.statusCode, 400);
  assert.equal((json.json() as { error: { code: string } }).error.code, 'invalid_content_type');

  const boundary = '----hlcTestFieldsOnly';
  const fieldsOnlyPayload = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="note"\r\n\r\nمرحباً\r\n--${boundary}--\r\n`,
    'utf8',
  );
  const fieldsOnly = await apiRequest(
    context.app,
    employeeClient,
    'POST',
    `/documents/${documentId}/files`,
    {
      payload: fieldsOnlyPayload,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    },
  );
  assert.equal(fieldsOnly.statusCode, 400);
  assert.equal((fieldsOnly.json() as { error: { code: string } }).error.code, 'missing_file');

  const mismatch = await uploadFile(documentId, 'scan.png', 'application/pdf', PNG_BYTES);
  assert.equal(mismatch.statusCode, 400);
  assert.equal((mismatch.json() as { error: { code: string } }).error.code, 'mime_mismatch');

  assert.equal(context.storage.objects.size, 0);
});

test('rejects oversized uploads without persisting anything', async () => {
  const documentId = await createDocument('FILE-3');
  const oversized = Buffer.alloc(1_500_000, 1);

  const response = await uploadFile(documentId, 'big.pdf', 'application/pdf', oversized);
  assert.equal(response.statusCode, 413, response.body);

  const rows = await context.pool.query('SELECT 1 FROM document_files');
  assert.equal(rows.rows.length, 0);
  assert.equal(context.storage.objects.size, 0);
});

test('storage failures surface as gateway errors without persistence', async () => {
  const documentId = await createDocument('FILE-4');
  context.storage.failPut = true;

  const response = await uploadFile(documentId, 'scan.png', 'image/png', PNG_BYTES);
  assert.equal(response.statusCode, 502, response.body);
  assert.equal((response.json() as { error: { code: string } }).error.code, 'storage_upload_failed');

  const rows = await context.pool.query('SELECT 1 FROM document_files');
  assert.equal(rows.rows.length, 0);
  assert.equal(context.storage.objects.size, 0);
});

test('attachments cannot be added to deleted documents', async () => {
  const documentId = await createDocument('FILE-5');
  await apiRequest(context.app, adminClient, 'DELETE', `/documents/${documentId}`);

  const response = await uploadFile(documentId, 'scan.png', 'image/png', PNG_BYTES);
  assert.equal(response.statusCode, 409);
  assert.equal((response.json() as { error: { code: string } }).error.code, 'deleted_document');
});

test('employees may delete attachments on editable documents in their department; admins manage globally', async () => {
  const documentId = await createDocument('FILE-6');
  const first = await uploadFile(documentId, 'scan.png', 'image/png', PNG_BYTES);
  const firstId = (first.json() as { file: { id: string } }).file.id;

  const employeeDelete = await apiRequest(context.app, employeeClient, 'DELETE', `/files/${firstId}`);
  assert.equal(employeeDelete.statusCode, 200, employeeDelete.body);
  assert.equal(context.storage.objects.size, 0);

  const rows = await context.pool.query('SELECT 1 FROM document_files');
  assert.equal(rows.rows.length, 0);

  const second = await uploadFile(documentId, 'second.png', 'image/png', PNG_BYTES);
  const secondId = (second.json() as { file: { id: string } }).file.id;
  const adminDelete = await apiRequest(context.app, adminClient, 'DELETE', `/files/${secondId}`);
  assert.equal(adminDelete.statusCode, 200, adminDelete.body);
  assert.equal(context.storage.objects.size, 0);

  const audit = await context.pool.query("SELECT 1 FROM audit_log WHERE action = 'file.deleted'");
  assert.equal(audit.rows.length, 2);
});

test('anonymous users cannot download files; deleted documents hide files from employees only', async () => {
  const documentId = await createDocument('FILE-7');
  const uploaded = await uploadFile(documentId, 'scan.png', 'image/png', PNG_BYTES);
  const fileId = (uploaded.json() as { file: { id: string } }).file.id;

  const anonymous = await apiRequest(context.app, null, 'GET', `/files/${fileId}/download`);
  assert.equal(anonymous.statusCode, 401);

  await apiRequest(context.app, adminClient, 'DELETE', `/documents/${documentId}`);

  const employee = await apiRequest(context.app, employeeClient, 'GET', `/files/${fileId}/download`);
  assert.equal(employee.statusCode, 404);

  const admin = await apiRequest(context.app, adminClient, 'GET', `/files/${fileId}/download`);
  assert.equal(admin.statusCode, 200);
  assert.ok(admin.rawPayload.equals(PNG_BYTES));

  const employeeView = await apiRequest(context.app, employeeClient, 'GET', `/files/${fileId}/view`);
  assert.equal(employeeView.statusCode, 404);
  const adminView = await apiRequest(context.app, adminClient, 'GET', `/files/${fileId}/view`);
  assert.equal(adminView.statusCode, 200);

  const missing = await apiRequest(
    context.app,
    employeeClient,
    'GET',
    '/files/00000000-0000-4000-8000-000000000000/download',
  );
  assert.equal(missing.statusCode, 404);
});
