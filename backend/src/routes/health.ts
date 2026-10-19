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
   * فحص الجاهزية: قاعدة البيانات شرط أساسي للجاهزية؛
   * حالة التخزين تُعاد كمعلومة إضافية دون أن تُفشل الفحص
   * (يبقى النظام قادراً على خدمة بقية الوظائف إذا تعطّل التخزين).
   */
  app.get('/ready', async (request, reply) => {
    let databaseOk = false;
    try {
      await deps.pool.query('SELECT 1');
      databaseOk = true;
    } catch (error) {
      request.log.error({ err: error }, 'readiness: database check failed');
    }

    let storageOk: boolean | null = null;
    if (deps.storage.name !== 'disabled') {
      try {
        storageOk = await deps.storage.health();
      } catch {
        storageOk = false;
      }
    }

    if (!databaseOk) reply.code(503);
    return {
      status: databaseOk ? 'ready' : 'not_ready',
      database: databaseOk,
      storage: storageOk,
    };
  });
}
