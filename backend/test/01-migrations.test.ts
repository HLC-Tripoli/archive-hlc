import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { loadConfig } from '../src/config.js';
import { runMigrations } from '../src/db/migrate.js';
import { ConfigError } from '../src/lib/errors.js';
import { testDatabaseUrl } from './helpers.js';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../migrations',
);

let pool: Pool;

before(() => {
  pool = new Pool({ connectionString: testDatabaseUrl() });
});

after(async () => {
  await pool.end();
});

test('production config works without any S3 settings and defaults to the local uploads directory', () => {
  const config = loadConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgres://x/y' });
  assert.equal(config.uploadsDir, '/data/uploads');
});

test('UPLOADS_DIR is resolved to an absolute path and validated', () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://x/y',
    UPLOADS_DIR: './relative/uploads',
  });
  assert.equal(config.uploadsDir, path.resolve('./relative/uploads'));

  assert.throws(
    () => loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgres://x/y', UPLOADS_DIR: '/' }),
    (error: unknown) => error instanceof ConfigError,
  );
});

test('schema is created from scratch, applied once, and migrations are idempotent', async () => {
  await pool.query('DROP SCHEMA public CASCADE');
  await pool.query('CREATE SCHEMA public');

  const first = await runMigrations(pool);
  assert.deepEqual(first.applied, [
    '0001_init.sql',
    '0002_employee_number.sql',
    '0003_user_department.sql',
    '0004_document_sequence_number.sql',
    '0005_additional_document_types.sql',
  ]);

  const { rows } = await pool.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' ORDER BY table_name`,
  );
  const tableNames = rows.map((row) => row.table_name);
  for (const expected of [
    'users',
    'sessions',
    'departments',
    'documents',
    'document_files',
    'audit_log',
    'data_imports',
    'schema_migrations',
  ]) {
    assert.ok(tableNames.includes(expected), `missing table: ${expected}`);
  }

  const employeeColumn = await pool.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'employee_number'`,
  );
  assert.equal(employeeColumn.rows.length, 1, 'employee_number column is missing');

  const employeeIndex = await pool.query(
    `SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'users'
        AND indexname = 'users_employee_number_lower_uidx'`,
  );
  assert.equal(employeeIndex.rows.length, 1, 'employee-number unique index is missing');

  const departmentColumn = await pool.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'department_id'`,
  );
  assert.equal(departmentColumn.rows.length, 1, 'department_id column is missing');

  const departmentIndex = await pool.query(
    `SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'users'
        AND indexname = 'users_department_idx'`,
  );
  assert.equal(departmentIndex.rows.length, 1, 'users department index is missing');

  const sequenceColumn = await pool.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'documents' AND column_name = 'sequence_number'`,
  );
  assert.equal(sequenceColumn.rows.length, 1, 'sequence_number column is missing');

  const sequenceIndex = await pool.query(
    `SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'documents'
        AND indexname = 'documents_sequence_number_trgm_idx'`,
  );
  assert.equal(sequenceIndex.rows.length, 1, 'sequence-number search index is missing');

  const foreignKey = await pool.query<{ delete_rule: string }>(
    `SELECT rc.delete_rule
       FROM information_schema.table_constraints tc
       JOIN information_schema.referential_constraints rc
         ON rc.constraint_name = tc.constraint_name
        AND rc.constraint_schema = tc.constraint_schema
      WHERE tc.table_schema = 'public' AND tc.table_name = 'users'
        AND tc.constraint_type = 'FOREIGN KEY'
        AND tc.constraint_name LIKE '%department_id%'`,
  );
  assert.equal(foreignKey.rows[0]?.delete_rule, 'RESTRICT');

  const second = await runMigrations(pool);
  assert.equal(second.applied.length, 0);
  assert.deepEqual(second.skipped, [
    '0001_init.sql',
    '0002_employee_number.sql',
    '0003_user_department.sql',
    '0004_document_sequence_number.sql',
    '0005_additional_document_types.sql',
  ]);
});

test('employee-number migration preserves existing users and leaves their numbers unset', async () => {
  await pool.query('DROP SCHEMA public CASCADE');
  await pool.query('CREATE SCHEMA public');

  const directory = await mkdtemp(path.join(tmpdir(), 'hlc-migrations-'));
  try {
    // نطبّق الترحيل الأول وحده لمحاكاة قاعدة إنتاج قائمة قبل إضافة الرقم الوظيفي.
    const original = await readFile(path.join(MIGRATIONS_DIR, '0001_init.sql'), 'utf8');
    await writeFile(path.join(directory, '0001_init.sql'), original);
    const first = await runMigrations(pool, { migrationsDir: directory });
    assert.deepEqual(first.applied, ['0001_init.sql']);

    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO users (username, display_name, role, password_hash, created_at)
       VALUES ('legacy.user', 'مستخدم قديم', 'employee', 'legacy-hash', now() - interval '30 days')
       RETURNING id`,
    );
    const legacyId = inserted.rows[0]!.id;

    const second = await runMigrations(pool);
    assert.deepEqual(second.applied, [
      '0002_employee_number.sql',
      '0003_user_department.sql',
      '0004_document_sequence_number.sql',
      '0005_additional_document_types.sql',
    ]);

    const preserved = await pool.query<{
      username: string;
      display_name: string;
      role: string;
      password_hash: string;
      employee_number: string | null;
      department_id: string | null;
      is_active: boolean;
      created_at: Date;
    }>(
      `SELECT username, display_name, role, password_hash, employee_number, department_id, is_active, created_at
         FROM users WHERE id = $1`,
      [legacyId],
    );
    const row = preserved.rows[0]!;
    assert.equal(row.username, 'legacy.user');
    assert.equal(row.display_name, 'مستخدم قديم');
    assert.equal(row.role, 'employee');
    assert.equal(row.password_hash, 'legacy-hash');
    assert.equal(row.is_active, true);
    assert.equal(row.employee_number, null);
    assert.equal(row.department_id, null);
    assert.ok(row.created_at instanceof Date);

    // القيد الفريد على مستوى القاعدة يمنع التكرار ولو تجاهل التطبيق الفحص المسبق.
    await pool.query(
      `INSERT INTO users (username, display_name, role, password_hash, employee_number)
       VALUES ('emp.one', 'موظف أول', 'employee', 'hash', 'EMP-01')`,
    );
    await assert.rejects(
      () =>
        pool.query(
          `INSERT INTO users (username, display_name, role, password_hash, employee_number)
           VALUES ('emp.two', 'موظف ثانٍ', 'employee', 'hash', 'emp-01')`,
        ),
      (error: unknown) =>
        typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505',
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('department migration preserves existing departments, users, documents, and files without auto-assignment', async () => {
  await pool.query('DROP SCHEMA public CASCADE');
  await pool.query('CREATE SCHEMA public');

  const directory = await mkdtemp(path.join(tmpdir(), 'hlc-migrations-'));
  try {
    // قاعدة بيانات على المخطط السابق مباشرة: 0001 + 0002 فقط.
    for (const name of ['0001_init.sql', '0002_employee_number.sql']) {
      await writeFile(
        path.join(directory, name),
        await readFile(path.join(MIGRATIONS_DIR, name), 'utf8'),
      );
    }
    const before = await runMigrations(pool, { migrationsDir: directory });
    assert.deepEqual(before.applied, ['0001_init.sql', '0002_employee_number.sql']);

    const department = await pool.query<{ id: string }>(
      "INSERT INTO departments (name) VALUES ('إدارة قديمة') RETURNING id",
    );
    const departmentId = department.rows[0]!.id;
    const employee = await pool.query<{ id: string }>(
      `INSERT INTO users (username, display_name, role, password_hash, employee_number)
       VALUES ('legacy.emp', 'موظف قديم', 'employee', 'legacy-hash', 'LEG-7')
       RETURNING id`,
    );
    const employeeId = employee.rows[0]!.id;
    const document = await pool.query<{ id: string }>(
      `INSERT INTO documents (reference, title, doc_type, transaction_date, department_id, created_by)
       VALUES ('LEG-001', 'معاملة قديمة', 'incoming', '2025-01-15', $1, $2)
       RETURNING id`,
      [departmentId, employeeId],
    );
    const documentId = document.rows[0]!.id;
    await pool.query(
      `INSERT INTO document_files
         (document_id, original_name, mime_type, size_bytes, storage_provider, storage_key)
       VALUES ($1, 'old.pdf', 'application/pdf', 4, 'local', 'legacy/old.pdf')`,
      [documentId],
    );

    const after = await runMigrations(pool);
    assert.deepEqual(after.applied, [
      '0003_user_department.sql',
      '0004_document_sequence_number.sql',
      '0005_additional_document_types.sql',
    ]);

    const preserved = await pool.query<{
      department_id: string | null;
      employee_number: string | null;
      role: string;
    }>('SELECT department_id, employee_number, role FROM users WHERE id = $1', [employeeId]);
    assert.deepEqual(preserved.rows[0], {
      department_id: null,
      employee_number: 'LEG-7',
      role: 'employee',
    });

    const counts = await pool.query<{
      departments: number;
      users: number;
      documents: number;
      files: number;
    }>(
      `SELECT
         (SELECT count(*)::int FROM departments) AS departments,
         (SELECT count(*)::int FROM users) AS users,
         (SELECT count(*)::int FROM documents) AS documents,
         (SELECT count(*)::int FROM document_files) AS files`,
    );
    assert.deepEqual(counts.rows[0], { departments: 1, users: 1, documents: 1, files: 1 });

    // القيد يمنع حذف إدارة ما زالت مرتبطة بمستخدم أو مستند.
    await assert.rejects(
      () => pool.query('DELETE FROM departments WHERE id = $1', [departmentId]),
      /violates RESTRICT setting of foreign key constraint/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('sequence-number migration preserves existing documents and files and leaves the new value NULL', async () => {
  await pool.query('DROP SCHEMA public CASCADE');
  await pool.query('CREATE SCHEMA public');

  const directory = await mkdtemp(path.join(tmpdir(), 'hlc-migrations-'));
  try {
    // قاعدة بيانات على المخطط السابق مباشرة: 0001 + 0002 + 0003 فقط.
    for (const name of ['0001_init.sql', '0002_employee_number.sql', '0003_user_department.sql']) {
      await writeFile(
        path.join(directory, name),
        await readFile(path.join(MIGRATIONS_DIR, name), 'utf8'),
      );
    }
    const before = await runMigrations(pool, { migrationsDir: directory });
    assert.deepEqual(before.applied, [
      '0001_init.sql',
      '0002_employee_number.sql',
      '0003_user_department.sql',
    ]);

    const department = await pool.query<{ id: string }>(
      "INSERT INTO departments (name) VALUES ('إدارة المراسلات') RETURNING id",
    );
    const departmentId = department.rows[0]!.id;
    const employee = await pool.query<{ id: string }>(
      `INSERT INTO users (username, display_name, role, password_hash, employee_number, department_id)
       VALUES ('seq.emp', 'موظف تسلسل', 'employee', 'hash', 'SEQ-1', $1)
       RETURNING id`,
      [departmentId],
    );
    const employeeId = employee.rows[0]!.id;
    const document = await pool.query<{ id: string }>(
      `INSERT INTO documents
         (reference, title, doc_type, transaction_date, sender, recipient, department_id,
          status, notes, created_by, updated_by)
       VALUES ('SEQ-OLD-1', 'مراسلة قديمة', 'incoming', '2025-03-01', 'جهة', 'هاتف ليبيا', $1,
               'completed', 'ملاحظة قديمة', $2, $2)
       RETURNING id`,
      [departmentId, employeeId],
    );
    const documentId = document.rows[0]!.id;
    await pool.query(
      `INSERT INTO document_files
         (document_id, original_name, mime_type, size_bytes, storage_provider, storage_key)
       VALUES ($1, 'old.pdf', 'application/pdf', 8, 'local', 'legacy/old-seq.pdf')`,
      [documentId],
    );

    const after = await runMigrations(pool);
    assert.deepEqual(after.applied, [
      '0004_document_sequence_number.sql',
      '0005_additional_document_types.sql',
    ]);

    const preserved = await pool.query<{
      reference: string;
      sequence_number: string | null;
      status: string;
      notes: string;
    }>('SELECT reference, sequence_number, status, notes FROM documents WHERE id = $1', [documentId]);
    assert.deepEqual(preserved.rows[0], {
      reference: 'SEQ-OLD-1',
      sequence_number: null,
      status: 'completed',
      notes: 'ملاحظة قديمة',
    });

    const counts = await pool.query<{ documents: number; files: number }>(
      `SELECT
         (SELECT count(*)::int FROM documents) AS documents,
         (SELECT count(*)::int FROM document_files) AS files`,
    );
    assert.deepEqual(counts.rows[0], { documents: 1, files: 1 });

    // القيد يسمح بالأصفار البادئة والحروف، ويمنع السلسلة الفارغة.
    await pool.query("UPDATE documents SET sequence_number = '0012/A' WHERE id = $1", [documentId]);
    await assert.rejects(
      () => pool.query("UPDATE documents SET sequence_number = '' WHERE id = $1", [documentId]),
      /violates check constraint/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a migration file modified after being applied is rejected (drift protection)', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'hlc-migrations-'));
  try {
    const original = await readFile(path.join(MIGRATIONS_DIR, '0001_init.sql'), 'utf8');
    await writeFile(path.join(directory, '0001_init.sql'), original);
    await runMigrations(pool, { migrationsDir: directory });

    await writeFile(path.join(directory, '0001_init.sql'), `${original}\n-- tampered\n`);
    await assert.rejects(
      () => runMigrations(pool, { migrationsDir: directory }),
      (error: unknown) => error instanceof ConfigError && /changed after/.test(error.message),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a failing migration rolls back and is not recorded', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'hlc-migrations-'));
  try {
    const original = await readFile(path.join(MIGRATIONS_DIR, '0001_init.sql'), 'utf8');
    await writeFile(path.join(directory, '0001_init.sql'), original);
    await writeFile(path.join(directory, '0002_broken.sql'), 'CREATE TABLE broken (;');

    await assert.rejects(
      () => runMigrations(pool, { migrationsDir: directory }),
      (error: unknown) =>
        error instanceof ConfigError && /0002_broken\.sql failed/.test(error.message),
    );

    const recorded = await pool.query(
      "SELECT 1 FROM schema_migrations WHERE name = '0002_broken.sql'",
    );
    assert.equal(recorded.rows.length, 0);
    const table = await pool.query(
      "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'broken'",
    );
    assert.equal(table.rows.length, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
