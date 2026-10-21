import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Database } from './pool.js';

export async function expectedMigrations(
  directory = resolve('migrations'),
): Promise<{ filename: string; checksum: string }[]> {
  const files = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
  return Promise.all(
    files.map(async (filename) => ({
      filename,
      checksum: createHash('sha256')
        .update(await readFile(resolve(directory, filename), 'utf8'))
        .digest('hex'),
    })),
  );
}

export async function assertSchemaCurrent(pool: Database): Promise<void> {
  const expected = await expectedMigrations();
  let stored: { filename: string; checksum: string }[];
  try {
    const result = await pool.query<{ filename: string; checksum: string }>(
      'SELECT filename, checksum FROM schema_migrations ORDER BY filename',
    );
    stored = result.rows;
  } catch (error) {
    throw new Error('Database schema is not initialised; run npm run db:migrate', { cause: error });
  }

  const expectedNames = new Set(expected.map((migration) => migration.filename));
  const unexpected = stored.find((migration) => !expectedNames.has(migration.filename));
  if (unexpected !== undefined) {
    throw new Error(
      `Database contains a migration unsupported by this release: ${unexpected.filename}`,
    );
  }

  const storedByName = new Map(stored.map((migration) => [migration.filename, migration.checksum]));
  for (const migration of expected) {
    const checksum = storedByName.get(migration.filename);
    if (checksum === undefined) {
      throw new Error(`Required database migration is missing: ${migration.filename}`);
    }
    if (checksum !== migration.checksum) {
      throw new Error(`Database migration checksum mismatch: ${migration.filename}`);
    }
  }
}
