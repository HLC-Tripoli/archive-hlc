import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';

/**
 * واجهة موحّدة للاستعلام تُقبل من الـ pool أو من عميل داخل معاملة،
 * حتى تعمل خدمات القراءة والكتابة في الحالتين دون تكرار.
 */
export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<R>>;
}

export function createPool(databaseUrl: string): Pool {
  return new Pool({
    connectionString: databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: 'archive-hlc',
  });
}

export async function withTransaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* تجاهل فشل التراجع؛ الخطأ الأصلي هو الأهم */
    }
    throw error;
  } finally {
    client.release();
  }
}
