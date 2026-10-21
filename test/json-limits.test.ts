import { describe, expect, it } from 'vitest';
import { assertBoundedJsonObject } from '../src/domain/json-limits.js';

describe('bounded JSON evidence', () => {
  it('accepts ordinary structured evidence', () => {
    expect(() =>
      assertBoundedJsonObject({ device: 'clock-a', quality: { locked: true } }, 'evidence'),
    ).not.toThrow();
  });

  it('rejects a deeply nested object before recursive canonicalisation', () => {
    const root: Record<string, unknown> = {};
    let cursor = root;
    for (let index = 0; index < 20; index += 1) {
      const next: Record<string, unknown> = {};
      cursor.next = next;
      cursor = next;
    }
    expect(() => assertBoundedJsonObject(root, 'evidence')).toThrow(/depth limit/);
  });

  it('rejects non-finite and non-JSON values', () => {
    expect(() => assertBoundedJsonObject({ value: Number.POSITIVE_INFINITY }, 'evidence')).toThrow(
      /non-JSON/,
    );
    expect(() => assertBoundedJsonObject([], 'evidence')).toThrow(/JSON object/);
  });
});
