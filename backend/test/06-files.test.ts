import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
  await createTestUser(context.pool, {
    username: 'employee',
    role: 'employee',
    permissions: [
      'view',
      'create',
      'edit',
      'delete',
      'attach_view',
      'attach_upload',
      'attach_delete',
    ],
  });
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

test('DELETE /files/:id soft-archives attachments while DELETE /files/:id/permanent purges them (admin only)', async () => {
  const documentId = await createDocument('FILE-6');
  const first = await uploadFile(documentId, 'scan.png', 'image/png', PNG_BYTES);
  const firstId = (first.json() as { file: { id: string } }).file.id;

  const employeeArchive = await apiRequest(context.app, employeeClient, 'DELETE', `/files/${firstId}`);
  assert.equal(employeeArchive.statusCode, 200, employeeArchive.body);
  // Storage object and DB row are preserved in soft-archive
  assert.equal(context.storage.objects.size, 1);

  const archivedRow = await context.pool.query<{
    archived_at: Date | null;
    archived_reason: string | null;
  }>('SELECT archived_at, archived_reason FROM document_files WHERE id = $1', [firstId]);
  assert.equal(archivedRow.rows.length, 1);
  assert.ok(archivedRow.rows[0]!.archived_at);
  assert.equal(archivedRow.rows[0]!.archived_reason, 'removed');

  // Active filesCount drops to 0
  const detailAfterArchive = await apiRequest(context.app, employeeClient, 'GET', `/documents/${documentId}`);
  assert.equal(detailAfterArchive.statusCode, 200);
  const docBody = detailAfterArchive.json() as { document: { files: unknown[]; filesCount: number } };
  assert.equal(docBody.document.filesCount, 0);
  assert.equal(docBody.document.files.length, 0);

  // Archived file remains downloadable and viewable, and appears in document history
  const archivedDownload = await apiRequest(context.app, employeeClient, 'GET', `/files/${firstId}/download`);
  assert.equal(archivedDownload.statusCode, 200);
  assert.ok(archivedDownload.rawPayload.equals(PNG_BYTES));

  const archivedView = await apiRequest(context.app, employeeClient, 'GET', `/files/${firstId}/view`);
  assert.equal(archivedView.statusCode, 200);

  const history = await apiRequest(context.app, employeeClient, 'GET', `/documents/${documentId}/history`);
  assert.equal(history.statusCode, 200, history.body);
  const historyBody = history.json() as {
    archivedFiles: Array<{ id: string; archivedReason: string | null; originalName: string }>;
  };
  assert.equal(historyBody.archivedFiles.length, 1);
  assert.equal(historyBody.archivedFiles[0]!.id, firstId);
  assert.equal(historyBody.archivedFiles[0]!.archivedReason, 'removed');
  assert.equal(historyBody.archivedFiles[0]!.originalName, 'scan.png');

  // Re-archiving an already archived file returns 404
  const doubleArchive = await apiRequest(context.app, adminClient, 'DELETE', `/files/${firstId}`);
  assert.equal(doubleArchive.statusCode, 404);

  // Employee cannot permanently delete
  const empPermanent = await apiRequest(context.app, employeeClient, 'DELETE', `/files/${firstId}/permanent`);
  assert.equal(empPermanent.statusCode, 403);

  // Admin permanently purges the file
  const adminPermanent = await apiRequest(context.app, adminClient, 'DELETE', `/files/${firstId}/permanent`);
  assert.equal(adminPermanent.statusCode, 200, adminPermanent.body);
  assert.equal(context.storage.objects.size, 0);

  const rowsAfterPurge = await context.pool.query('SELECT 1 FROM document_files WHERE id = $1', [firstId]);
  assert.equal(rowsAfterPurge.rows.length, 0);

  const audit = await context.pool.query<{ action: string }>(
    "SELECT action FROM audit_log WHERE action IN ('file.archived', 'file.purged') ORDER BY id ASC",
  );
  assert.deepEqual(
    audit.rows.map((row) => row.action),
    ['file.archived', 'file.purged'],
  );
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

test('attachment permissions enforce granular view, upload, and delete checks', async () => {
  await createTestUser(context.pool, {
    username: 'no-perm-employee',
    role: 'employee',
    permissions: ['view', 'create', 'edit', 'delete'],
  });
  const restrictedClient = await loginClient(context.app, 'no-perm-employee');

  const documentId = await createDocument('PERM-FILE-1');

  const deniedUpload = await apiRequest(context.app, restrictedClient, 'POST', `/documents/${documentId}/files`, {
    headers: { 'content-type': 'multipart/form-data; boundary=----boundary' },
    payload: Buffer.from('dummy'),
  });
  assert.equal(deniedUpload.statusCode, 403);

  const uploaded = await uploadFile(documentId, 'perm-doc.png', 'image/png', PNG_BYTES);
  assert.equal(uploaded.statusCode, 201);
  const fileId = (uploaded.json() as { file: { id: string } }).file.id;

  const deniedView = await apiRequest(context.app, restrictedClient, 'GET', `/files/${fileId}/view`);
  assert.equal(deniedView.statusCode, 403);

  const deniedDownload = await apiRequest(context.app, restrictedClient, 'GET', `/files/${fileId}/download`);
  assert.equal(deniedDownload.statusCode, 403);

  const deniedDelete = await apiRequest(context.app, restrictedClient, 'DELETE', `/files/${fileId}`);
  assert.equal(deniedDelete.statusCode, 403);
});

test('POST /files/:id/replace replaces active attachment, archives old version, and logs file.replaced', async () => {
  const documentId = await createDocument('FILE-REPLACE-1');
  const original = await uploadFile(documentId, 'v1.png', 'image/png', PNG_BYTES);
  assert.equal(original.statusCode, 201, original.body);
  const oldFileId = (original.json() as { file: { id: string } }).file.id;

  const pdfBytes = Buffer.from('%PDF-1.4\n%v2\n%%EOF\n');
  const fixture = multipartFixture({
    filename: 'v2.pdf',
    contentType: 'application/pdf',
    content: pdfBytes,
  });
  const replaced = await apiRequest(context.app, employeeClient, 'POST', `/files/${oldFileId}/replace`, {
    payload: fixture.payload,
    headers: fixture.headers,
  });
  assert.equal(replaced.statusCode, 201, replaced.body);
  const newFile = (replaced.json() as { file: { id: string; originalName: string } }).file;
  assert.equal(newFile.originalName, 'v2.pdf');
  assert.notEqual(newFile.id, oldFileId);

  // Both objects are stored; only the new file is active on the document
  assert.equal(context.storage.objects.size, 2);
  const detail = await apiRequest(context.app, employeeClient, 'GET', `/documents/${documentId}`);
  assert.equal(detail.statusCode, 200);
  const detailDoc = (detail.json() as {
    document: { filesCount: number; files: Array<{ id: string; originalName: string }> };
  }).document;
  assert.equal(detailDoc.filesCount, 1);
  assert.equal(detailDoc.files.length, 1);
  assert.equal(detailDoc.files[0]!.id, newFile.id);
  assert.equal(detailDoc.files[0]!.originalName, 'v2.pdf');

  // Old file is archived with replacedByFileId & archivedReason = 'replaced'
  const history = await apiRequest(context.app, employeeClient, 'GET', `/documents/${documentId}/history`);
  assert.equal(history.statusCode, 200, history.body);
  const archivedFiles = (history.json() as {
    archivedFiles: Array<{
      id: string;
      originalName: string;
      archivedReason: string | null;
      replacedByFileId: string | null;
    }>;
  }).archivedFiles;
  assert.equal(archivedFiles.length, 1);
  assert.equal(archivedFiles[0]!.id, oldFileId);
  assert.equal(archivedFiles[0]!.originalName, 'v1.png');
  assert.equal(archivedFiles[0]!.archivedReason, 'replaced');
  assert.equal(archivedFiles[0]!.replacedByFileId, newFile.id);

  // Old file remains downloadable
  const oldDownload = await apiRequest(context.app, employeeClient, 'GET', `/files/${oldFileId}/download`);
  assert.equal(oldDownload.statusCode, 200);
  assert.ok(oldDownload.rawPayload.equals(PNG_BYTES));

  const audit = await context.pool.query("SELECT 1 FROM audit_log WHERE action = 'file.replaced'");
  assert.equal(audit.rows.length, 1);
});

test('POST /files/check-duplicate detects active SHA-256 matches, enforces department isolation, and ignores archived/deleted', async () => {
  const uniqueBytes = Buffer.from('%PDF-1.4\n%unique-dup-check\n%%EOF\n');
  const sha256 = createHash('sha256').update(uniqueBytes).digest('hex');

  const docId = await createDocument('FILE-DUP-1');
  const uploaded = await uploadFile(docId, 'contract.pdf', 'application/pdf', uniqueBytes);
  assert.equal(uploaded.statusCode, 201, uploaded.body);
  const fileId = (uploaded.json() as { file: { id: string } }).file.id;

  // Same department employee finds the duplicate
  const sameDeptCheck = await apiRequest(context.app, employeeClient, 'POST', '/files/check-duplicate', {
    payload: { checksumSha256: sha256 },
  });
  assert.equal(sameDeptCheck.statusCode, 200, sameDeptCheck.body);
  const sameMatches = (sameDeptCheck.json() as {
    duplicates: Array<{ documentId: string; reference: string; title: string; type: string; fileName: string }>;
  }).duplicates;
  assert.equal(sameMatches.length, 1);
  assert.equal(sameMatches[0]!.documentId, docId);
  assert.equal(sameMatches[0]!.reference, 'FILE-DUP-1');
  assert.equal(sameMatches[0]!.fileName, 'contract.pdf');

  // Other department employee does NOT see it; admin sees it globally
  const otherDept = await apiRequest(context.app, adminClient, 'POST', '/departments', {
    payload: { name: 'إدارة أخرى للفحص' },
  });
  assert.equal(otherDept.statusCode, 201, otherDept.body);
  const otherDeptId = (otherDept.json() as { department: { id: string } }).department.id;
  await createTestUser(context.pool, {
    username: 'dup-other-emp',
    role: 'employee',
    departmentId: otherDeptId,
    permissions: ['view', 'create', 'attach_upload'],
  });
  const otherEmpClient = await loginClient(context.app, 'dup-other-emp');
  const otherCheck = await apiRequest(context.app, otherEmpClient, 'POST', '/files/check-duplicate', {
    payload: { checksumSha256: sha256 },
  });
  assert.equal(otherCheck.statusCode, 200);
  assert.equal((otherCheck.json() as { duplicates: unknown[] }).duplicates.length, 0);

  const adminCheck = await apiRequest(context.app, adminClient, 'POST', '/files/check-duplicate', {
    payload: { checksumSha256: sha256 },
  });
  assert.equal(adminCheck.statusCode, 200);
  assert.equal((adminCheck.json() as { duplicates: unknown[] }).duplicates.length, 1);

  // Soft-deleted document is ignored even for admin
  await apiRequest(context.app, adminClient, 'DELETE', `/documents/${docId}`);
  const deletedDocCheck = await apiRequest(context.app, adminClient, 'POST', '/files/check-duplicate', {
    payload: { checksumSha256: sha256 },
  });
  assert.equal(deletedDocCheck.statusCode, 200);
  assert.equal((deletedDocCheck.json() as { duplicates: unknown[] }).duplicates.length, 0);

  // Restore document, then archive the file -> archived file is ignored
  await apiRequest(context.app, adminClient, 'POST', `/documents/${docId}/restore`);
  await apiRequest(context.app, employeeClient, 'DELETE', `/files/${fileId}`);
  const archivedCheck = await apiRequest(context.app, employeeClient, 'POST', '/files/check-duplicate', {
    payload: { checksumSha256: sha256 },
  });
  assert.equal(archivedCheck.statusCode, 200);
  assert.equal((archivedCheck.json() as { duplicates: unknown[] }).duplicates.length, 0);
});
