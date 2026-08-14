import { Pool } from 'pg';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (pool) return pool;
  const conn = process.env.DATABASE_URL;
  if (!conn) throw new Error('DATABASE_URL not configured');
  pool = new Pool({ connectionString: conn });
  return pool;
}

export async function closePool(): Promise<void> {
  if (!pool) return;
  await pool.end();
  pool = null;
}
