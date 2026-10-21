import { describe, expect, it } from 'vitest';
import { parsePostgresInt8 } from '../src/db/pool.js';

describe('parsePostgresInt8', () => {
  it('parses safe PostgreSQL int8 values exactly', () => {
    expect(parsePostgresInt8('86400000000')).toBe(86_400_000_000);
    expect(parsePostgresInt8('0')).toBe(0);
  });

  it('rejects int8 values that would lose JavaScript precision', () => {
    expect(() => parsePostgresInt8('9007199254740992')).toThrow(/safe integer range/);
  });

  it('rejects malformed values instead of partially parsing them', () => {
    expect(() => parsePostgresInt8('123abc')).toThrow(/Invalid PostgreSQL int8/);
  });
});
