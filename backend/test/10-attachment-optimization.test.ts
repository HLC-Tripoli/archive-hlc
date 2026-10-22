import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test, { after, afterEach, before, beforeEach } from 'node:test';
import exifReader from 'exif-reader';
import sharp from 'sharp';
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
import {
  createAttachmentOptimizer,
  type AttachmentOptimizer,
  type OptimizeCandidateInput,
} from '../src/services/optimization/optimizer.js';
import { OptimizationError } from '../src/services/optimization/tools.js';
import { storeAttachment } from '../src/services/files.js';

const execFileAsync = promisify(execFile);
const FIXTURES = fileURLToPath(new URL('./fixtures/optimization/', import.meta.url));

let context: TestContext;
let adminClient: AuthedClient;
let employeeClient: AuthedClient;
let realOptimizer: AttachmentOptimizer;

/** محسّن قابل للتبديل كي تختبر حالات الفشل دون إعادة بناء التطبيق. */
class SwitchableOptimizer implements AttachmentOptimizer {
  current: AttachmentOptimizer;

  constructor(initial: AttachmentOptimizer) {
    this.current = initial;
  }

  produceCandidate(input: OptimizeCandidateInput) {
    return this.current.produceCandidate(input);
  }
}

let optimizer: SwitchableOptimizer;

function fixture(name: string): Promise<Buffer> {
  return readFile(path.join(FIXTURES, name));
}

function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

async function createDocument(reference: string, departmentId?: string): Promise<string> {
  const client = departmentId ? adminClient : employeeClient;
  const response = await apiRequest(context.app, client, 'POST', '/documents', {
    payload: {
      reference,
      title: `معاملة ${reference}`,
      type: 'incoming',
      date: '2026-01-15',
      ...(departmentId ? { departmentId } : {}),
    },
  });
  assert.equal(response.statusCode, 201, response.body);
  return (response.json() as { document: { id: string } }).document.id;
}

function uploadFile(
  documentId: string,
  filename: string,
  contentType: string,
  content: Buffer,
  client: AuthedClient = employeeClient,
): Promise<InjectResult> {
  const multipart = multipartFixture({ filename, contentType, content });
  return apiRequest(context.app, client, 'POST', `/documents/${documentId}/files`, {
    payload: multipart.payload,
    headers: multipart.headers,
  });
}

interface FileRow {
  id: string;
  original_name: string;
  mime_type: string;
  size_bytes: string | number;
  checksum_sha256: string;
  storage_key: string;
  uploaded_by: string;
  created_at: Date;
}

async function fileRow(fileId: string): Promise<FileRow> {
  const { rows } = await context.pool.query<FileRow>(
    `SELECT id, original_name, mime_type, size_bytes, checksum_sha256,
            storage_key, uploaded_by, created_at
       FROM document_files WHERE id = $1`,
    [fileId],
  );
  assert.ok(rows[0], 'expected a document_files row');
  return rows[0]!;
}

async function assertStoredMatchesDownload(
  fileId: string,
  client: AuthedClient = employeeClient,
): Promise<{ row: FileRow; stored: Buffer; downloaded: Buffer }> {
  const row = await fileRow(fileId);
  const storedEntry = context.storage.objects.get(row.storage_key);
  assert.ok(storedEntry, 'expected a stored object');
  const stored = storedEntry.data;
  assert.equal(Number(row.size_bytes), stored.length);
  assert.equal(row.checksum_sha256, sha256(stored));

  const download = await apiRequest(context.app, client, 'GET', `/files/${fileId}/download`);
  assert.equal(download.statusCode, 200, download.body);
  assert.ok(download.rawPayload.equals(stored), 'downloaded bytes must equal stored bytes');
  return { row, stored, downloaded: download.rawPayload };
}

async function assertTempDirectoryClean(): Promise<void> {
  try {
    assert.deepEqual(await readdir(context.config.processingTmpDir), []);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

async function rawPixels(data: Buffer): Promise<Buffer> {
  return sharp(data, { limitInputPixels: 20_000_000, failOn: 'error' })
    .ensureAlpha()
    .raw()
    .toBuffer();
}

async function withTempFile<T>(data: Buffer, suffix: string, task: (file: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(path.join(tmpdir(), 'hlc-opt-test-'));
  const file = path.join(directory, `download.${suffix}`);
  try {
    await writeFile(file, data);
    return await task(file);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function pdfInfo(file: string): Promise<Record<string, string>> {
  const { stdout } = await execFileAsync('pdfinfo', ['-f', '1', '-l', '2', file]);
  const result: Record<string, string> = {};
  for (const line of stdout.split('\n')) {
    const match = /^(.+?):\s+(.*)$/.exec(line);
    if (match) result[match[1]!.trim()] = match[2]!.trim();
  }
  return result;
}

async function pdfText(file: string): Promise<string> {
  const { stdout } = await execFileAsync('pdftotext', [file, '-']);
  return stdout;
}

async function assertPdfValid(file: string): Promise<void> {
  const result = await execFileAsync('qpdf', ['--check', file]).catch((error: unknown) => {
    throw new Error(`qpdf --check failed: ${String((error as { stderr?: string }).stderr ?? '')}`);
  });
  assert.match(`${result.stdout}\n${result.stderr}`, /No syntax or stream encoding errors found/);
}

before(async () => {
  optimizer = new SwitchableOptimizer({
    async produceCandidate() {
      return { produced: false, reason: 'not_initialized' };
    },
  });
  context = await createTestContext({ uploadMaxMb: 5 }, { optimizer });
  await ensureMigrated(context.pool);
  realOptimizer = createAttachmentOptimizer({
    concurrency: 2,
    tmpDir: context.config.processingTmpDir,
  });
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
  optimizer.current = realOptimizer;
});

afterEach(async () => {
  await assertTempDirectoryClean();
});

after(async () => {
  await disposeTestContext(context);
});

test('optimizes JPEG losslessly and records matching metadata, timestamp and audit', async () => {
  const original = await fixture('sample.jpg');
  const originalMeta = await sharp(original).metadata();
  const documentId = await createDocument('OPT-JPEG-1');
  const started = Date.now();

  const upload = await uploadFile(documentId, 'صورة-اختبار.jpg', 'image/jpeg', original);
  const finished = Date.now();
  assert.equal(upload.statusCode, 201, upload.body);
  const file = (upload.json() as {
    file: { id: string; originalName: string; mimeType: string; sizeBytes: number; checksumSha256: string };
  }).file;

  assert.equal(file.originalName, 'صورة-اختبار.jpg');
  assert.equal(file.mimeType, 'image/jpeg');
  assert.ok(file.sizeBytes < original.length, 'JPEG must become smaller');

  const { row, stored, downloaded } = await assertStoredMatchesDownload(file.id);
  assert.equal(Number(row.size_bytes), file.sizeBytes);
  assert.equal(row.checksum_sha256, file.checksumSha256);
  assert.equal(row.uploaded_by, employeeClient.user.id);
  assert.equal(row.original_name, 'صورة-اختبار.jpg');
  assert.equal(row.mime_type, 'image/jpeg');

  const downloadedMeta = await sharp(downloaded).metadata();
  assert.equal(downloadedMeta.format, 'jpeg');
  assert.equal(downloadedMeta.width, originalMeta.width);
  assert.equal(downloadedMeta.height, originalMeta.height);
  assert.equal(downloadedMeta.orientation, 6);
  assert.ok(originalMeta.icc && downloadedMeta.icc);
  assert.ok(originalMeta.icc.equals(downloadedMeta.icc), 'ICC profile must be byte-identical');
  assert.ok(originalMeta.exif && downloadedMeta.exif);
  const beforeExif = exifReader(originalMeta.exif);
  const afterExif = exifReader(downloadedMeta.exif);
  assert.equal(afterExif.Image?.Make, beforeExif.Image?.Make);
  assert.equal(afterExif.Image?.Model, beforeExif.Image?.Model);
  assert.equal(
    (afterExif.Image?.DateTime as Date | undefined)?.toISOString(),
    (beforeExif.Image?.DateTime as Date | undefined)?.toISOString(),
  );
  assert.ok((await rawPixels(downloaded)).equals(await rawPixels(original)), 'JPEG pixels must be identical');

  const createdAt = row.created_at.getTime();
  assert.ok(createdAt >= started - 2_000 && createdAt <= finished + 2_000, 'created_at must be the upload time');
  assert.ok(createdAt < finished, 'created_at must not be set after optimization completes');

  const audit = await context.pool.query<{ actor_user_id: string; details: { name: string; size: number; mimeType: string } }>(
    "SELECT actor_user_id, details FROM audit_log WHERE action = 'file.uploaded' ORDER BY id DESC LIMIT 1",
  );
  assert.equal(audit.rows[0]?.actor_user_id, employeeClient.user.id);
  assert.equal(audit.rows[0]?.details.name, 'صورة-اختبار.jpg');
  assert.equal(audit.rows[0]?.details.size, file.sizeBytes);
  assert.equal(audit.rows[0]?.details.mimeType, 'image/jpeg');
  assert.equal(stored.length, file.sizeBytes);
});

test('optimizes a transparent PNG losslessly and keeps alpha and metadata', async () => {
  const original = await fixture('sample.png');
  const originalMeta = await sharp(original).metadata();
  const documentId = await createDocument('OPT-PNG-1');

  const upload = await uploadFile(documentId, 'شفافة.png', 'image/png', original);
  assert.equal(upload.statusCode, 201, upload.body);
  const file = (upload.json() as { file: { id: string; sizeBytes: number } }).file;
  assert.ok(file.sizeBytes < original.length, 'PNG must become smaller');

  const { downloaded } = await assertStoredMatchesDownload(file.id);
  const meta = await sharp(downloaded).metadata();
  assert.equal(meta.format, 'png');
  assert.equal(meta.hasAlpha, true);
  assert.equal(meta.width, originalMeta.width);
  assert.equal(meta.height, originalMeta.height);
  assert.equal(meta.orientation, originalMeta.orientation);
  assert.ok(originalMeta.icc && meta.icc && originalMeta.icc.equals(meta.icc));

  const before = await rawPixels(original);
  const after = await rawPixels(downloaded);
  assert.ok(before.equals(after), 'PNG pixels and transparency must be identical');
  let transparentPixels = 0;
  for (let index = 3; index < after.length; index += 4) {
    if (after[index] === 0) transparentPixels += 1;
  }
  assert.ok(transparentPixels > 0, 'transparent pixels must survive optimization');
});

test('optimizes WebP and TIFF losslessly while preserving format and transparency', async () => {
  const webpOriginal = await fixture('sample.webp');
  const webpDocument = await createDocument('OPT-WEBP-1');
  const webpUpload = await uploadFile(webpDocument, 'صورة.webp', 'image/webp', webpOriginal);
  assert.equal(webpUpload.statusCode, 201, webpUpload.body);
  const webpFile = (webpUpload.json() as { file: { id: string; sizeBytes: number; mimeType: string } }).file;
  assert.equal(webpFile.mimeType, 'image/webp');
  assert.ok(webpFile.sizeBytes < webpOriginal.length, 'WebP must become smaller');
  const webpDownload = await assertStoredMatchesDownload(webpFile.id);
  const webpMeta = await sharp(webpDownload.downloaded).metadata();
  assert.equal(webpMeta.format, 'webp');
  assert.equal(webpMeta.hasAlpha, true);
  assert.ok((await rawPixels(webpDownload.downloaded)).equals(await rawPixels(webpOriginal)));

  const tiffOriginal = await fixture('sample.tiff');
  const tiffDocument = await createDocument('OPT-TIFF-1');
  const tiffUpload = await uploadFile(tiffDocument, 'مسح.tiff', 'image/tiff', tiffOriginal);
  assert.equal(tiffUpload.statusCode, 201, tiffUpload.body);
  const tiffFile = (tiffUpload.json() as { file: { id: string; sizeBytes: number; mimeType: string } }).file;
  assert.equal(tiffFile.mimeType, 'image/tiff');
  assert.ok(tiffFile.sizeBytes < tiffOriginal.length, 'TIFF must become smaller');
  const tiffDownload = await assertStoredMatchesDownload(tiffFile.id);
  const tiffMeta = await sharp(tiffDownload.downloaded).metadata();
  assert.equal(tiffMeta.format, 'tiff');
  assert.ok((await rawPixels(tiffDownload.downloaded)).equals(await rawPixels(tiffOriginal)));
});

test('optimizes a multipage Arabic PDF and preserves text, geometry, rotation and document info', async () => {
  const original = await fixture('sample.pdf');
  const documentId = await createDocument('OPT-PDF-1');
  const upload = await uploadFile(documentId, 'معاملة.pdf', 'application/pdf', original);
  assert.equal(upload.statusCode, 201, upload.body);
  const file = (upload.json() as { file: { id: string; sizeBytes: number; mimeType: string } }).file;
  assert.equal(file.mimeType, 'application/pdf');
  assert.ok(file.sizeBytes < original.length, 'PDF must become smaller');

  const { downloaded } = await assertStoredMatchesDownload(file.id);
  const beforeInfo = await withTempFile(original, 'pdf', (filePath) => pdfInfo(filePath));
  const afterInfo = await withTempFile(downloaded, 'pdf', async (filePath) => {
    await assertPdfValid(filePath);
    return pdfInfo(filePath);
  });

  assert.equal(afterInfo['Pages'], '2');
  assert.equal(afterInfo['Page    1 rot'], '0');
  assert.equal(afterInfo['Page    2 rot'], '90');
  assert.equal(afterInfo['Page size'], beforeInfo['Page size']);
  assert.equal(afterInfo['Title'], beforeInfo['Title']);
  assert.equal(afterInfo['Producer'], beforeInfo['Producer']);
  assert.equal(afterInfo['CreationDate'], beforeInfo['CreationDate']);
  assert.equal(afterInfo['ModDate'], beforeInfo['ModDate']);

  const beforeText = await withTempFile(original, 'pdf', (filePath) => pdfText(filePath));
  const afterText = await withTempFile(downloaded, 'pdf', (filePath) => pdfText(filePath));
  assert.equal(afterText, beforeText, 'PDF text extraction must be unchanged');
  assert.match(afterText, /TEST-2026-001/);
  assert.match(afterText, /الصفحة الثانية/);
});

test('retains original bytes when no safe smaller result exists', async () => {
  const jpegOriginal = await fixture('sample-optimized.jpg');
  const jpegDocument = await createDocument('OPT-NOGAIN-JPEG');
  const jpegUpload = await uploadFile(jpegDocument, 'محسّنة.jpg', 'image/jpeg', jpegOriginal);
  assert.equal(jpegUpload.statusCode, 201, jpegUpload.body);
  const jpegFile = (jpegUpload.json() as { file: { id: string; sizeBytes: number } }).file;
  assert.equal(jpegFile.sizeBytes, jpegOriginal.length);
  const jpegStored = await assertStoredMatchesDownload(jpegFile.id);
  assert.ok(jpegStored.stored.equals(jpegOriginal));

  const pdfOriginal = await fixture('sample-optimized.pdf');
  const pdfDocument = await createDocument('OPT-NOGAIN-PDF');
  const pdfUpload = await uploadFile(pdfDocument, 'محسّنة.pdf', 'application/pdf', pdfOriginal);
  assert.equal(pdfUpload.statusCode, 201, pdfUpload.body);
  const pdfFile = (pdfUpload.json() as { file: { id: string; sizeBytes: number } }).file;
  assert.equal(pdfFile.sizeBytes, pdfOriginal.length);
  const pdfStored = await assertStoredMatchesDownload(pdfFile.id);
  assert.ok(pdfStored.stored.equals(pdfOriginal));
});

test('leaves non-PDF/non-image and unsupported image files byte-for-byte unchanged', async () => {
  const cases: Array<{ name: string; mime: string }> = [
    { name: 'notes.txt', mime: 'text/plain' },
    { name: 'notes.csv', mime: 'text/csv' },
    { name: 'document.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    { name: 'tiny.gif', mime: 'image/gif' },
    { name: 'not-an-image.png', mime: 'image/png' },
  ];
  const tinyGif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  for (const [index, item] of cases.entries()) {
    const content = item.name === 'tiny.gif' ? tinyGif : await fixture(item.name);
    const documentId = await createDocument(`OPT-PLAIN-${index}`);
    const upload = await uploadFile(documentId, item.name, item.mime, content);
    assert.equal(upload.statusCode, 201, upload.body);
    const file = (upload.json() as { file: { id: string; sizeBytes: number; mimeType: string; originalName: string } }).file;
    assert.equal(file.sizeBytes, content.length);
    assert.equal(file.mimeType, item.mime);
    assert.equal(file.originalName, item.name);
    const { stored } = await assertStoredMatchesDownload(file.id);
    assert.ok(stored.equals(content), `${item.name} must remain byte-for-byte identical`);
  }
});

test('falls back safely when the optimizer fails, times out, disappears or returns corrupt/larger output', async () => {
  const original = await fixture('sample.jpg');
  const documentId = await createDocument('OPT-FAIL-1');

  const scenarios: Array<[string, AttachmentOptimizer]> = [
    [
      'timeout',
      {
        async produceCandidate() {
          throw new OptimizationError('timeout');
        },
      },
    ],
    [
      'tool_unavailable',
      {
        async produceCandidate() {
          return { produced: false, reason: 'tool_unavailable' };
        },
      },
    ],
    [
      'corrupt',
      {
        async produceCandidate(input) {
          await writeFile(input.outputPath, Buffer.from('this is not a jpeg'));
          return { produced: true };
        },
      },
    ],
    [
      'larger',
      {
        async produceCandidate(input) {
          const source = await readFile(input.sourcePath);
          await writeFile(input.outputPath, Buffer.concat([source, Buffer.alloc(1024, 7)]));
          return { produced: true };
        },
      },
    ],
  ];

  for (const [label, fake] of scenarios) {
    optimizer.current = fake;
    const upload = await uploadFile(documentId, `fallback-${label}.jpg`, 'image/jpeg', original);
    assert.equal(upload.statusCode, 201, `${label}: ${upload.body}`);
    const file = (upload.json() as { file: { id: string; sizeBytes: number } }).file;
    assert.equal(file.sizeBytes, original.length, `${label} must retain the original size`);
    const { stored } = await assertStoredMatchesDownload(file.id);
    assert.ok(stored.equals(original), `${label} must retain the original bytes`);
  }

  assert.equal(context.storage.objects.size, scenarios.length);
  const rows = await context.pool.query('SELECT 1 FROM document_files');
  assert.equal(rows.rows.length, scenarios.length);
});

test('keeps signed and encrypted PDFs unchanged', async () => {
  const signed = await fixture('signed-sample.pdf');
  const signedDocument = await createDocument('OPT-SIGNED-1');
  const signedUpload = await uploadFile(signedDocument, 'موقّع.pdf', 'application/pdf', signed);
  assert.equal(signedUpload.statusCode, 201, signedUpload.body);
  const signedFile = (signedUpload.json() as { file: { id: string; sizeBytes: number } }).file;
  assert.equal(signedFile.sizeBytes, signed.length);
  assert.ok((await assertStoredMatchesDownload(signedFile.id)).stored.equals(signed));

  const encrypted = await fixture('encrypted-sample.pdf');
  const encryptedDocument = await createDocument('OPT-ENCRYPTED-1');
  const encryptedUpload = await uploadFile(encryptedDocument, 'مشفّر.pdf', 'application/pdf', encrypted);
  assert.equal(encryptedUpload.statusCode, 201, encryptedUpload.body);
  const encryptedFile = (encryptedUpload.json() as { file: { id: string; sizeBytes: number } }).file;
  assert.equal(encryptedFile.sizeBytes, encrypted.length);
  assert.ok((await assertStoredMatchesDownload(encryptedFile.id)).stored.equals(encrypted));
});

test('cleans up when the client stream fails before storage', async () => {
  const documentId = await createDocument('OPT-STREAM-1');
  const disconnected = new Readable({
    read() {
      this.push(Buffer.from('partial upload bytes'));
      this.destroy(new Error('simulated client disconnect'));
    },
  });

  await assert.rejects(
    storeAttachment(
      {
        pool: context.pool,
        storage: context.storage,
        config: context.config,
        optimizer: realOptimizer,
      },
      {
        documentId,
        userId: employeeClient.user.id,
        access: { isAdmin: false, departmentId: employeeClient.user.departmentId },
        stream: disconnected,
        filename: 'interrupted.jpg',
        declaredMimeType: 'image/jpeg',
      },
    ),
    /simulated client disconnect/,
  );

  assert.equal(context.storage.objects.size, 0);
  const rows = await context.pool.query('SELECT 1 FROM document_files');
  assert.equal(rows.rows.length, 0);
  await assertTempDirectoryClean();
});

test('cleans up temporary files and compensating storage on storage or database failure', async () => {
  const documentId = await createDocument('OPT-FAILURE-1');
  const png = await fixture('sample.png');

  context.storage.failPut = true;
  const storageFailure = await uploadFile(documentId, 'storage.png', 'image/png', png);
  assert.equal(storageFailure.statusCode, 502, storageFailure.body);
  assert.equal(context.storage.objects.size, 0);
  let rows = await context.pool.query('SELECT 1 FROM document_files');
  assert.equal(rows.rows.length, 0);
  await assertTempDirectoryClean();
  context.storage.failPut = false;

  await context.pool.query(`
    CREATE OR REPLACE FUNCTION hlc_fail_file_insert() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'simulated document_files insert failure';
    END;
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER hlc_fail_file_insert_trigger
      BEFORE INSERT ON document_files
      FOR EACH ROW EXECUTE FUNCTION hlc_fail_file_insert();
  `);
  try {
    const databaseFailure = await uploadFile(documentId, 'database.png', 'image/png', png);
    assert.equal(databaseFailure.statusCode, 500, databaseFailure.body);
    assert.equal(context.storage.objects.size, 0, 'stored object must be removed when the DB insert fails');
    rows = await context.pool.query('SELECT 1 FROM document_files');
    assert.equal(rows.rows.length, 0);
    await assertTempDirectoryClean();
  } finally {
    await context.pool.query(`
      DROP TRIGGER IF EXISTS hlc_fail_file_insert_trigger ON document_files;
      DROP FUNCTION IF EXISTS hlc_fail_file_insert();
    `);
  }
});

test('oversized uploads are rejected without optimization, storage, rows or temporary leftovers', async () => {
  const documentId = await createDocument('OPT-OVERSIZE-1');
  const oversized = Buffer.alloc(context.config.uploadMaxMb * 1024 * 1024 + 128 * 1024, 1);
  const upload = await uploadFile(documentId, 'big.pdf', 'application/pdf', oversized);
  assert.equal(upload.statusCode, 413, upload.body);
  assert.equal(context.storage.objects.size, 0);
  const rows = await context.pool.query('SELECT 1 FROM document_files');
  assert.equal(rows.rows.length, 0);
  await assertTempDirectoryClean();
});

test('records the upload start time, not the optimization completion time', async () => {
  const original = await fixture('sample.jpg');
  const documentId = await createDocument('OPT-TIME-1');
  optimizer.current = {
    async produceCandidate(input) {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      return realOptimizer.produceCandidate(input);
    },
  };

  const started = Date.now();
  const upload = await uploadFile(documentId, 'time.jpg', 'image/jpeg', original);
  const finished = Date.now();
  assert.equal(upload.statusCode, 201, upload.body);
  const file = (upload.json() as { file: { id: string } }).file;
  const row = await fileRow(file.id);

  const created = row.created_at.getTime();
  assert.ok(created >= started - 2_000, 'created_at must not be in the past');
  assert.ok(created - started < 1_000, 'created_at must represent the upload start, not the delayed completion');
  assert.ok(finished - created >= 1_200, 'the optimizer delay must happen after the recorded upload time');
});

test('keeps department isolation on uploads and downloads after adding optimization', async () => {
  const departments = await context.pool.query<{ id: string }>(
    "INSERT INTO departments (name) VALUES ('إدارة أخرى للاختبار') RETURNING id",
  );
  const otherDepartmentId = departments.rows[0]!.id;
  await createTestUser(context.pool, {
    username: 'other-employee',
    departmentId: otherDepartmentId,
  });
  const otherClient = await loginClient(context.app, 'other-employee');

  const otherDocument = await createDocument('OPT-SCOPE-OTHER', otherDepartmentId);
  const uploaded = await uploadFile(otherDocument, 'other.jpg', 'image/jpeg', await fixture('sample.jpg'), otherClient);
  assert.equal(uploaded.statusCode, 201, uploaded.body);
  const otherFileId = (uploaded.json() as { file: { id: string } }).file.id;

  const crossDownload = await apiRequest(context.app, employeeClient, 'GET', `/files/${otherFileId}/download`);
  assert.equal(crossDownload.statusCode, 404);
  const crossUpload = await uploadFile(otherDocument, 'cross.jpg', 'image/jpeg', await fixture('sample.jpg'), employeeClient);
  assert.equal(crossUpload.statusCode, 404);
});
