import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool, PoolClient } from 'pg';
import { ConfigError } from '../lib/errors.js';

/**
 * مشغّل ترحيلات بسيط ومُحكم:
 *   * كل ترحيل ملف SQL واحد في مجلد migrations بأسماء مرقّمة (0001_xxx.sql).
 *   * يُنفَّذ كل ملف داخل معاملة واحدة، ويسجَّل اسمه وبصمته (SHA-256) في schema_migrations.
 *   * قفل استشاري (advisory lock) يمنع تشغيل نسختين متزامنتين.
 *   * أي تعديل لاحق على ملف سبق تطبيقه يُرفض (حماية من الانحراف) بدل تطبيقه بصمت.
 */

const MIGRATION_FILE_PATTERN = /^\d{4,}_[A-Za-z0-9._-]+\.sql$/;
const MIGRATION_ADVISORY_LOCK_KEY = 732174001;

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

export function resolveMigrationsDir(explicit?: string): string {
  const candidates: string[] = [];
  if (explicit) candidates.push(explicit);
  const fromEnv = (process.env.MIGRATIONS_DIR ?? '').trim();
  if (fromEnv) candidates.push(fromEnv);
  candidates.push(path.resolve(process.cwd(), 'migrations'));
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  candidates.push(path.resolve(moduleDir, '../../migrations'));
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate) && statSync(candidate).isDirectory()) return candidate;
    } catch {
      /* تابع البحث */
    }
  }
  throw new ConfigError(`Migrations directory not found. Tried: ${candidates.join(', ')}`);
}

async function ensureMigrationsTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       text PRIMARY KEY,
      checksum   text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
}

export async function runMigrations(
  pool: Pool,
  options: { migrationsDir?: string; log?: (message: string) => void } = {},
): Promise<MigrationResult> {
  const log = options.log ?? (() => {});
  const directory = resolveMigrationsDir(options.migrationsDir);
  const files = (await readdir(directory))
    .filter((file) => MIGRATION_FILE_PATTERN.test(file))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));

  if (files.length === 0) {
    throw new ConfigError(`No migration files (NNNN_name.sql) found in ${directory}`);
  }

  const client = await pool.connect();
  const applied: string[] = [];
  const skipped: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_ADVISORY_LOCK_KEY]);
    await ensureMigrationsTable(client);

    const existing = await client.query<{ name: string; checksum: string }>(
      'SELECT name, checksum FROM schema_migrations',
    );
    const existingChecksums = new Map(existing.rows.map((row) => [row.name, row.checksum]));

    for (const file of files) {
      const sql = await readFile(path.join(directory, file), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const priorChecksum = existingChecksums.get(file);

      if (priorChecksum !== undefined) {
        if (priorChecksum !== checksum) {
          throw new ConfigError(
            `Migration ${file} was changed after it had been applied. ` +
              'Applied migrations are immutable; add a new migration file instead.',
          );
        }
        skipped.push(file);
        continue;
      }

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [
          file,
          checksum,
        ]);
        await client.query('COMMIT');
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch {
          /* تجاهل */
        }
        throw new ConfigError(`Migration ${file} failed: ${(error as Error).message}`);
      }
      applied.push(file);
      log(`applied migration: ${file}`);
    }
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_ADVISORY_LOCK_KEY]);
    } catch {
      /* تجاهل: سيُحرَّر القفل بإغلاق الاتصال على أي حال */
    }
    client.release();
  }

  return { applied, skipped };
}
