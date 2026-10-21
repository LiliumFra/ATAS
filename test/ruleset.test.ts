import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { loadRuleset } from '../src/domain/ruleset.js';

describe('ruleset loading', () => {
  it('accepts the expected raw-file SHA-256', async () => {
    const raw = await readFile('rulesets/ifab-2026-27.json', 'utf8');
    const digest = createHash('sha256').update(raw).digest('hex');
    const ruleset = await loadRuleset('rulesets/ifab-2026-27.json', digest);
    expect(ruleset.id).toBe('ifab-2026-27-reference');
  });

  it('rejects a mismatched digest', async () => {
    await expect(loadRuleset('rulesets/ifab-2026-27.json', '0'.repeat(64))).rejects.toThrow(
      'Ruleset SHA-256 mismatch',
    );
  });
});
