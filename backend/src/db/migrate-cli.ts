import { loadConfig } from '../config.js';
import { createPool } from './pool.js';
import { runMigrations } from './migrate.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  try {
    const result = await runMigrations(pool, { log: (message) => console.log(message) });
    console.log(
      `الترحيلات مكتملة: ${result.applied.length} مطبَّق، ${result.skipped.length} محدَّث مسبقاً.`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
