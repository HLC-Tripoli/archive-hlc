import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { StorageProvider } from '../services/storage/types.js';

export function registerHealthRoutes(
  app: FastifyInstance,
  deps: { pool: Pool; storage: StorageProvider },
): void {
  /** فحص الحياة: لا يعتمد على أي خدمة خارجية. */
  app.get('/health', async () => ({
    status: 'ok',
    service: 'archive-hlc-api',
    time: new Date().toISOString(),
  }));

  /**
   * فحص الجاهزية: قاعدة البيانات ومجلد تخزين المرفقات المحلي شرطان أساسيان
   * لخدمة الأرشيف كاملاً؛ فشل أحدهما يعني 503 كي تكتشف المراقبة المشكلة فوراً.
   */
  app.get('/ready', async (request, reply) => {
    let databaseOk = false;
    try {
      await deps.pool.query('SELECT 1');
      databaseOk = true;
    } catch (error) {
      request.log.error({ err: error }, 'readiness: database check failed');
    }

    let storageOk = false;
    try {
      storageOk = await deps.storage.health();
    } catch {
      storageOk = false;
    }

    const ready = databaseOk && storageOk;
    if (!ready) reply.code(503);
    return {
      status: ready ? 'ready' : 'not_ready',
      database: databaseOk,
      storage: storageOk,
    };
  });
}
