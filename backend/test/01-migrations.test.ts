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
  assert.deepEqual(first.applied, ['0001_init.sql', '0002_employee_number.sql']);

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

  const second = await runMigrations(pool);
  assert.equal(second.applied.length, 0);
  assert.deepEqual(second.skipped, ['0001_init.sql', '0002_employee_number.sql']);
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
    assert.deepEqual(second.applied, ['0002_employee_number.sql']);

    const preserved = await pool.query<{
      username: string;
      display_name: string;
      role: string;
      password_hash: string;
      employee_number: string | null;
      is_active: boolean;
      created_at: Date;
    }>(
      `SELECT username, display_name, role, password_hash, employee_number, is_active, created_at
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
