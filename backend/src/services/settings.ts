import type { Pool } from 'pg';

export async function getSetting(pool: Pool, key: string, defaultValue: string): Promise<string> {
  const { rows } = await pool.query<{ value: string }>(
    'SELECT value FROM system_settings WHERE key = $1',
    [key],
  );
  return rows[0]?.value ?? defaultValue;
}

export async function setSetting(pool: Pool, key: string, value: string): Promise<void> {
  await pool.query(
    `INSERT INTO system_settings (key, value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, value],
  );
}

export async function getUploadMaxMb(pool: Pool, fallbackMb: number): Promise<number> {
  try {
    const raw = await getSetting(pool, 'upload_max_mb', String(fallbackMb));
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackMb;
  } catch {
    return fallbackMb;
  }
}
