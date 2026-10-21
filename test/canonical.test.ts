import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../src/domain/canonical.js';

describe('canonical JSON', () => {
  it('sorts keys by fixed ordinal order rather than environment locale', () => {
    expect(canonicalJson({ ä: 1, z: 2, A: 3, a: 4 })).toBe('{"A":3,"a":4,"z":2,"ä":1}');
  });

  it('normalises nested objects while preserving array order', () => {
    expect(canonicalJson({ b: [{ z: 1, a: 2 }], a: true })).toBe('{"a":true,"b":[{"a":2,"z":1}]}');
  });
});
