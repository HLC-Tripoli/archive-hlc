import { loadConfig } from './config.js';
import { createPool } from './db/pool.js';
import { buildApp } from './app.js';
import { purgeExpiredSessions } from './services/sessions.js';
import { LocalFilesystemStorageProvider } from './services/storage/local.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  const storage = new LocalFilesystemStorageProvider(config.uploadsDir);
  const app = await buildApp({ config, pool, storage });

  // تهيئة مجلد المرفقات عند الإقلاع: إنشاؤه إن لزم والتحقق من قابلية الكتابة.
  // لا نُسقط الخادم عند الفشل: بقية الوظائف تبقى متاحة، وفحص الجاهزية يكشف المشكلة.
  try {
    await storage.init();
    app.log.info({ uploadsDir: config.uploadsDir }, 'local attachment storage initialized');
  } catch (error) {
    app.log.error(
      { err: error, uploadsDir: config.uploadsDir },
      'local attachment storage is not usable; uploads and downloads will fail until it is fixed',
    );
  }

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
