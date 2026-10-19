import { loadConfig } from './config.js';
import { createPool } from './db/pool.js';
import { buildApp } from './app.js';
import { purgeExpiredSessions } from './services/sessions.js';
import { DisabledStorageProvider } from './services/storage/disabled.js';
import { S3StorageProvider } from './services/storage/s3.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  const storage = config.s3 ? new S3StorageProvider(config.s3) : new DisabledStorageProvider();
  const app = await buildApp({ config, pool, storage });

  const purgeTimer = setInterval(
    () => {
      purgeExpiredSessions(pool).catch((error: unknown) => {
        app.log.warn({ err: error }, 'failed to purge expired sessions');
      });
    },
    10 * 60 * 1000,
  );
  purgeTimer.unref();

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'shutting down');
    clearInterval(purgeTimer);
    app
      .close()
      .then(() => pool.end())
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        app.log.error({ err: error }, 'shutdown failed');
        process.exit(1);
      });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  await app.listen({ port: config.port, host: '0.0.0.0' });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
