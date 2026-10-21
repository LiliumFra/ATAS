import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expectedMigrations } from './schema.js';

const { Pool } = pg;

function databaseUrl(): string {
  const value = process.env.DATABASE_URL?.trim();
  if (value !== undefined && value !== '') return value;
  if ((process.env.NODE_ENV ?? 'development') === 'production') {
    throw new Error('Missing required environment variable: DATABASE_URL');
  }
  return 'postgres://atas:atas@localhost:5432/atas';
}

export async function migrate(): Promise<void> {
  const pool = new Pool({
    connectionString: databaseUrl(),
    max: 1,
    connectionTimeoutMillis: 5_000,
    application_name: 'atas-schema-migrator',
  });
  const client = await pool.connect();
  const directory = resolve('migrations');

  try {
    await client.query("SELECT pg_advisory_lock(hashtext('atas_schema_migrations'))");
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename text PRIMARY KEY,
        checksum char(64) NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await client.query('ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum char(64)');

    for (const { filename, checksum } of await expectedMigrations(directory)) {
      const existing = await client.query<{ checksum: string | null }>(
        'SELECT checksum FROM schema_migrations WHERE filename = $1',
        [filename],
      );
      const stored = existing.rows[0];
      if (stored !== undefined) {
        if (stored.checksum !== checksum) {
          throw new Error(`Applied migration ${filename} has changed on disk`);
        }
        continue;
      }

      const sql = await readFile(resolve(directory, filename), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations(filename, checksum) VALUES ($1, $2)', [
          filename,
          checksum,
        ]);
        await client.query('COMMIT');
        process.stdout.write(`Applied ${filename}\n`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    await client
      .query("SELECT pg_advisory_unlock(hashtext('atas_schema_migrations'))")
      .catch(() => undefined);
    client.release();
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}
