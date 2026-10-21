import { describe, expect, it, vi } from 'vitest';
import { assertSchemaCurrent, expectedMigrations } from '../src/db/schema.js';

async function storedMigrations() {
  return expectedMigrations();
}

function database(rows: { filename: string; checksum: string }[]) {
  return { query: vi.fn().mockResolvedValue({ rows }) } as never;
}

describe('database schema compatibility gate', () => {
  it('accepts exactly the migrations supported by this release', async () => {
    await expect(assertSchemaCurrent(database(await storedMigrations()))).resolves.toBeUndefined();
  });

  it('rejects a missing migration', async () => {
    const rows = await storedMigrations();
    rows.pop();
    await expect(assertSchemaCurrent(database(rows))).rejects.toThrow(/migration is missing/);
  });

  it('rejects a changed applied migration', async () => {
    const rows = await storedMigrations();
    const first = rows[0];
    if (first === undefined) throw new Error('Expected migrations');
    first.checksum = '0'.repeat(64);
    await expect(assertSchemaCurrent(database(rows))).rejects.toThrow(/checksum mismatch/);
  });

  it('rejects a database migrated beyond the running release', async () => {
    const rows = await storedMigrations();
    rows.push({ filename: '999_future.sql', checksum: 'f'.repeat(64) });
    await expect(assertSchemaCurrent(database(rows))).rejects.toThrow(
      /unsupported by this release/,
    );
  });
});
