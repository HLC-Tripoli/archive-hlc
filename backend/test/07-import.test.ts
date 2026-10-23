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

const LEGACY_PAYLOAD = {
  source: 'hl_archive_data_v1',
  departments: [
    { legacyId: 'd1', name: 'الإدارة العامة' },
    { legacyId: 'd2', name: 'إدارة الشؤون المالية' },
  ],
  documents: [
    {
      legacyId: 'doc-1',
      reference: 'LEG-001',
      title: 'معاملة قديمة أولى',
      type: 'incoming',
      date: '2024-05-01',
      sender: 'جهة أ',
      recipient: 'هاتف ليبيا',
      sequenceNumber: '  0042/B  ',
      departmentLegacyId: 'd1',
      status: 'جديدة',
      notes: '',
      createdAt: '2024-05-01T10:00:00.000Z',
      updatedAt: '2024-05-02T10:00:00.000Z',
    },
    {
      legacyId: 'doc-2',
      reference: 'LEG-002',
      title: 'معاملة قديمة ثانية',
      type: 'outgoing',
      date: '2024-06-15',
      departmentLegacyId: 'd2',
      status: 'قيد الإجراء',
    },
    {
      legacyId: 'doc-3',
      reference: 'LEG-001',
      title: 'نسخة مكررة',
      type: 'incoming',
      date: '2024-07-01',
    },
    { reference: 'LEG-003', title: 'تاريخ خاطئ', type: 'incoming', date: '2024-13-40' },
    { reference: 'LEG-004', type: 'incoming', date: '2024-08-01' },
  ],
};

interface ImportOutcomeBody {
  summary: {
    documentsImported: number;
    departmentsCreated: number;
    duplicates: number;
    rejected: number;
  };
  results: Array<{ index: number; status: string; reason?: string }>;
  warnings: string[];
}

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
});

after(async () => {
  await disposeTestContext(context);
});

test('legacy import validates records, maps statuses and departments, and reports outcomes per record', async () => {
  const response = await apiRequest(context.app, adminClient, 'POST', '/imports/legacy', {
    payload: LEGACY_PAYLOAD,
  });
  assert.equal(response.statusCode, 200, response.body);
  const outcome = response.json() as ImportOutcomeBody;

  assert.deepEqual(outcome.summary, {
    documentsImported: 2,
    departmentsCreated: 2,
    duplicates: 1,
    rejected: 2,
  });
  assert.deepEqual(
    outcome.results.map((result) => result.status),
    ['imported', 'imported', 'duplicate', 'rejected', 'rejected'],
  );
  assert.match(outcome.results[3]!.reason ?? '', /تاريخ/);
  assert.match(outcome.results[4]!.reason ?? '', /موضوع الرسالة/);

  const documents = await context.pool.query<{
    reference: string;
    status: string;
    sequence_number: string | null;
  }>('SELECT reference, status, sequence_number FROM documents ORDER BY reference');
  assert.deepEqual(
    documents.rows.map((row) => `${row.reference}:${row.status}:${row.sequence_number ?? ''}`),
    ['LEG-001:new:0042/B', 'LEG-002:in_progress:'],
  );

  const department = await context.pool.query<{ name: string }>(
    `SELECT dep.name FROM documents doc JOIN departments dep ON dep.id = doc.department_id
      WHERE doc.reference = 'LEG-001'`,
  );
  assert.equal(department.rows[0]!.name, 'الإدارة العامة');

  const imports = await context.pool.query<{ kind: string; stats: unknown }>('SELECT kind, stats FROM data_imports');
  assert.equal(imports.rows.length, 1);
  assert.equal(imports.rows[0]!.kind, 'legacy_browser');

  const audit = await context.pool.query("SELECT 1 FROM audit_log WHERE action = 'import.legacy'");
  assert.equal(audit.rows.length, 1);
});

test('legacy import is idempotent: rerunning imports nothing new', async () => {
  await apiRequest(context.app, adminClient, 'POST', '/imports/legacy', { payload: LEGACY_PAYLOAD });

  const rerun = await apiRequest(context.app, adminClient, 'POST', '/imports/legacy', {
    payload: LEGACY_PAYLOAD,
  });
  assert.equal(rerun.statusCode, 200);
  const outcome = rerun.json() as ImportOutcomeBody;
  assert.deepEqual(outcome.summary, {
    documentsImported: 0,
    departmentsCreated: 0,
    duplicates: 3,
    rejected: 2,
  });

  const count = await context.pool.query<{ count: number }>('SELECT count(*)::int AS count FROM documents');
  assert.equal(count.rows[0]!.count, 2);
});

test('employees cannot run imports or export backups', async () => {
  const legacy = await apiRequest(context.app, employeeClient, 'POST', '/imports/legacy', {
    payload: LEGACY_PAYLOAD,
  });
  assert.equal(legacy.statusCode, 403);

  const backupImport = await apiRequest(context.app, employeeClient, 'POST', '/imports/backup', {
    payload: { formatVersion: 1, documents: [] },
  });
  assert.equal(backupImport.statusCode, 403);

  const backupExport = await apiRequest(context.app, employeeClient, 'GET', '/exports/backup');
  assert.equal(backupExport.statusCode, 403);
});

test('backup export contains the metadata of active documents and departments', async () => {
  await apiRequest(context.app, adminClient, 'POST', '/imports/legacy', { payload: LEGACY_PAYLOAD });

  const response = await apiRequest(context.app, adminClient, 'GET', '/exports/backup');
  assert.equal(response.statusCode, 200);
  assert.match(String(response.headers['content-disposition']), /archive-hlc-backup-/);

  const backup = response.json() as {
    formatVersion: number;
    app: string;
    departments: Array<{ name: string }>;
    documents: Array<{ reference: string; sequenceNumber: string | null; status?: unknown }>;
  };
  assert.equal(backup.formatVersion, 1);
  assert.equal(backup.app, 'archive-hlc');
  const exported = backup.documents.find((document) => document.reference === 'LEG-001');
  assert.equal(exported?.sequenceNumber, '0042/B');
  assert.ok(backup.documents.every((document) => document.status === undefined));
  // إدارة الاختبار الافتراضية + إدارتان من الترحيل.
  assert.equal(backup.departments.length, 3);
  assert.deepEqual(
    backup.documents.map((document) => document.reference).sort(),
    ['LEG-001', 'LEG-002'],
  );
});

test('backup import adds new documents, skips duplicates, and warns about attachments', async () => {
  await apiRequest(context.app, adminClient, 'POST', '/imports/legacy', { payload: LEGACY_PAYLOAD });

  const response = await apiRequest(context.app, adminClient, 'POST', '/imports/backup', {
    payload: {
      formatVersion: 1,
      departments: [
        { name: 'الإدارة العامة', isActive: true },
        { name: 'إدارة جديدة', isActive: true },
      ],
      documents: [
        {
          reference: 'BAK-001',
          title: 'من نسخة احتياطية',
          type: 'incoming',
          date: '2025-02-01',
          sequenceNumber: '  0009  ',
          departmentName: 'إدارة جديدة',
          status: 'مكتملة',
          files: [{ name: 'attachment.pdf' }],
        },
        {
          reference: 'BAK-002',
          title: 'نسخة قديمة بلا رقم تسلسل',
          type: 'outgoing',
          date: '2025-02-03',
        },
        {
          reference: 'leg-001',
          title: 'مكرر من المستورد',
          type: 'incoming',
          date: '2025-02-02',
        },
      ],
    },
  });
  assert.equal(response.statusCode, 200, response.body);
  const outcome = response.json() as ImportOutcomeBody;
  assert.deepEqual(outcome.summary, {
    documentsImported: 2,
    departmentsCreated: 1,
    duplicates: 1,
    rejected: 0,
  });
  assert.ok(outcome.warnings.some((warning) => warning.includes('مرفق')));

  const imported = await context.pool.query<{
    reference: string;
    status: string;
    sequence_number: string | null;
    department: string | null;
  }>(
    `SELECT doc.reference, doc.status, doc.sequence_number, dep.name AS department
       FROM documents doc
       LEFT JOIN departments dep ON dep.id = doc.department_id
      WHERE doc.reference IN ('BAK-001', 'BAK-002')
      ORDER BY doc.reference`,
  );
  // الحالة القديمة تُحفظ في قاعدة البيانات ولا تُعرض في الواجهة أو التصدير.
  assert.equal(imported.rows[0]!.status, 'completed');
  assert.equal(imported.rows[0]!.sequence_number, '0009');
  assert.equal(imported.rows[0]!.department, 'إدارة جديدة');
  // نسخة احتياطية قديمة بلا الحقل تُستورد بقيمة NULL وتظل قابلة للعرض.
  assert.equal(imported.rows[1]!.sequence_number, null);
  assert.equal(imported.rows[1]!.department, null);

  const kinds = await context.pool.query<{ kind: string }>('SELECT kind FROM data_imports');
  assert.deepEqual(
    kinds.rows.map((row) => row.kind).sort(),
    ['json_backup', 'legacy_browser'],
  );
});
