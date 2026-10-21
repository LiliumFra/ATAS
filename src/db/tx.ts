import type pg from 'pg';
import type { Database } from './pool.js';

export type DbClient = pg.PoolClient;

export async function withTransaction<T>(
  pool: Database,
  operation: (client: DbClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function lockMatch(client: DbClient, matchId: string): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [matchId]);
}
