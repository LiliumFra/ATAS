import { describe, expect, it, vi } from 'vitest';
import type { Ruleset } from '../src/domain/types.js';
import { MatchService } from '../src/services/match-service.js';

const ruleset = {
  id: 'test-ruleset',
  nominalPeriodUs: {},
} as unknown as Ruleset;

function createHarness(created: boolean) {
  const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
  const release = vi.fn();
  const client = { query, release };
  const pool = { connect: vi.fn().mockResolvedValue(client) };
  const match = {
    id: '00000000-0000-4000-8000-000000000123',
    competition: 'Competition',
    homeTeam: 'Home',
    awayTeam: 'Away',
    rulesetId: ruleset.id,
    status: 'SCHEDULED',
    clockIntegrityOk: true,
    sourceIntegrityOk: true,
    metadata: {},
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  } as const;
  const matches = { create: vi.fn().mockResolvedValue({ match, created }) };
  const audit = { append: vi.fn().mockResolvedValue(undefined) };
  const service = new MatchService(
    pool as never,
    matches as never,
    {} as never,
    audit as never,
    ruleset,
  );
  return { service, query, release, matches, audit, match };
}

describe('MatchService creation idempotency', () => {
  it('does not emit another audit or outbox message for an exact retry', async () => {
    const harness = createHarness(false);
    const result = await harness.service.create({
      matchId: harness.match.id,
      competition: ' Competition ',
      homeTeam: ' Home ',
      awayTeam: ' Away ',
      metadata: {},
      actor: 'admin',
    });

    expect(result).toEqual({ match: harness.match, created: false });
    expect(harness.audit.append).not.toHaveBeenCalled();
    expect(harness.query).toHaveBeenCalledTimes(2);
    expect(harness.query).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(harness.query).toHaveBeenNthCalledWith(2, 'COMMIT');
    expect(harness.release).toHaveBeenCalledOnce();
  });

  it('emits creation side effects exactly once for a new match', async () => {
    const harness = createHarness(true);
    const result = await harness.service.create({
      matchId: harness.match.id,
      competition: 'Competition',
      homeTeam: 'Home',
      awayTeam: 'Away',
      metadata: {},
      actor: 'admin',
    });

    expect(result.created).toBe(true);
    expect(harness.audit.append).toHaveBeenCalledOnce();
    expect(harness.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO outbox'),
      expect.any(Array),
    );
  });
});
