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

test('production config rejects a missing S3 storage configuration', () => {
  assert.throws(
    () => loadConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgres://x/y' }),
    (error: unknown) => error instanceof ConfigError,
  );
});

test('partial S3 configuration is rejected', () => {
  assert.throws(
    () =>
      loadConfig({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgres://x/y',
        S3_ENDPOINT: 'http://localhost:9000',
      }),
    (error: unknown) => error instanceof ConfigError,
  );
});

test('schema is created from scratch, applied once, and migrations are idempotent', async () => {
  await pool.query('DROP SCHEMA public CASCADE');
  await pool.query('CREATE SCHEMA public');

  const first = await runMigrations(pool);
  assert.deepEqual(first.applied, ['0001_init.sql']);

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

  const second = await runMigrations(pool);
  assert.equal(second.applied.length, 0);
  assert.deepEqual(second.skipped, ['0001_init.sql']);
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
