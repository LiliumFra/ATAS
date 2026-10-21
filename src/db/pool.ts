import pg from 'pg';
import type { AppConfig } from '../config.js';

const { Pool } = pg;

/** PostgreSQL int8 values are strings by default; reject precision loss instead of silently rounding. */
export function parsePostgresInt8(value: string): number {
  if (!/^-?\d+$/.test(value)) throw new RangeError(`Invalid PostgreSQL int8 value: ${value}`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new RangeError(
      `PostgreSQL int8 value is outside JavaScript's safe integer range: ${value}`,
    );
  }
  return parsed;
}

pg.types.setTypeParser(20, parsePostgresInt8);

export type Database = InstanceType<typeof Pool>;

export function createPool(config: AppConfig): Database {
  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: config.databasePoolMax,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    allowExitOnIdle: config.nodeEnv === 'test',
    application_name: 'atas-api',
  });

  pool.on('error', (error) => {
    process.stderr.write(`Unexpected PostgreSQL pool error: ${error.message}\n`);
  });

  return pool;
}
