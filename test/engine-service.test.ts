import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../src/config.js';
import { SECOND_US } from '../src/domain/engine.js';
import type { Ruleset } from '../src/domain/types.js';
import { EngineService } from '../src/services/engine-service.js';
import { event } from './fixtures.js';

const baseRuleset: Ruleset = {
  id: 'ruleset-bound-to-match',
  version: 'test',
  effectiveFrom: '2026-07-01',
  description: 'test',
  nominalPeriodUs: {
    FIRST_HALF: 2_700 * SECOND_US,
    SECOND_HALF: 2_700 * SECOND_US,
    ET_FIRST: 900 * SECOND_US,
    ET_SECOND: 900 * SECOND_US,
  },
  policies: {
    SUBSTITUTION: { mode: 'FULL', graceUs: 0, description: 'test' },
    INJURY: { mode: 'FULL', graceUs: 0, description: 'test' },
    PLAYER_REMOVAL: { mode: 'FULL', graceUs: 0, description: 'test' },
    TIME_WASTING: { mode: 'MANUAL', graceUs: 0, description: 'test' },
    DISCIPLINARY_DELAY: { mode: 'FULL', graceUs: 0, description: 'test' },
    MEDICAL_BREAK: { mode: 'FULL', graceUs: 0, description: 'test' },
    VAR_CHECK: { mode: 'FULL', graceUs: 0, description: 'test' },
    VAR_REVIEW: { mode: 'FULL', graceUs: 0, description: 'test' },
    GOAL_CELEBRATION: { mode: 'FULL', graceUs: 0, description: 'test' },
    EXTERNAL_INTERFERENCE: { mode: 'FULL', graceUs: 0, description: 'test' },
    THROW_IN_RESTART: { mode: 'EXCESS', graceUs: 15 * SECOND_US, description: 'test' },
    GOAL_KICK_RESTART: { mode: 'EXCESS', graceUs: 20 * SECOND_US, description: 'test' },
    FREE_KICK_RESTART: { mode: 'EXCESS', graceUs: 20 * SECOND_US, description: 'test' },
    CORNER_RESTART: { mode: 'EXCESS', graceUs: 20 * SECOND_US, description: 'test' },
    OTHER_SIGNIFICANT_DELAY: { mode: 'MANUAL', graceUs: 0, description: 'test' },
  },
  boardPolicy: { suggestion: 'FLOOR_AND_CEIL', refereeApprovalRequired: true },
};

function createService(options?: {
  clockAgeMs?: number;
  primaryClockAgeMs?: number;
  backupClockAgeMs?: number;
  primaryElapsedUs?: number;
  backupElapsedUs?: number;
  omitPrimary?: boolean;
  periodWallElapsedUs?: number;
  ruleset?: Ruleset;
  events?: ReturnType<typeof event>[];
}) {
  const ruleset = options?.ruleset ?? baseRuleset;
  const matches = {
    get: vi.fn().mockResolvedValue({
      id: '00000000-0000-4000-8000-000000000001',
      competition: 'Test',
      homeTeam: 'Home',
      awayTeam: 'Away',
      rulesetId: ruleset.id,
      status: 'LIVE',
      clockIntegrityOk: true,
      sourceIntegrityOk: true,
      metadata: {},
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    }),
    getPeriod: vi.fn().mockResolvedValue({
      matchId: '00000000-0000-4000-8000-000000000001',
      period: 'SECOND_HALF',
      status: 'RUNNING',
      nominalDurationUs: 2_700 * SECOND_US,
    }),
  };
  const events = {
    listLatest: vi
      .fn()
      .mockResolvedValue(
        options?.events ?? [
          event({ kind: 'INJURY', startUs: 10 * SECOND_US, endUs: 40 * SECOND_US }),
        ],
      ),
    verify: vi.fn(),
  };
  const stoppages = { listLatest: vi.fn().mockResolvedValue([]), verify: vi.fn() };
  const clockBase = {
    sequence: 1,
    matchId: '00000000-0000-4000-8000-000000000001',
    period: 'SECOND_HALF' as const,
    sourceSequence: 9,
    evidence: {},
    previousHash: '0'.repeat(64),
    sampleHash: '1'.repeat(64),
    receivedAt: new Date().toISOString(),
    periodWallElapsedUs: options?.periodWallElapsedUs ?? 100_100_000,
  };
  const clockSamples = [
    ...(options?.omitPrimary === true
      ? []
      : [
          {
            ...clockBase,
            sourceId: 'clock-primary',
            elapsedUs: options?.primaryElapsedUs ?? 100 * SECOND_US,
            ageMs: options?.primaryClockAgeMs ?? options?.clockAgeMs ?? 100,
          },
        ]),
    {
      ...clockBase,
      sequence: 2,
      sourceId: 'clock-backup',
      elapsedUs: options?.backupElapsedUs ?? 100 * SECOND_US,
      ageMs: options?.backupClockAgeMs ?? options?.clockAgeMs ?? 100,
    },
  ];
  const clocks = {
    latestMany: vi.fn().mockResolvedValue(clockSamples),
    verify: vi.fn(),
  };
  const rulesets = { get: vi.fn().mockResolvedValue(ruleset) };
  const config = {
    primaryClockSource: 'clock-primary',
    clockMaxSampleAgeMs: 2_000,
    clockSourceSubjects: ['clock-primary', 'clock-backup'],
    clockMinimumFreshSources: 2,
    clockMaxSourceDriftUs: 100_000,
    clockMaxWallDriftUs: 2_000_000,
  } as AppConfig;

  const service = new EngineService(
    {} as never,
    matches as never,
    events as never,
    stoppages as never,
    clocks as never,
    rulesets as never,
    {} as never,
    config,
  );
  return { service, rulesets };
}

describe('EngineService', () => {
  it('loads the immutable ruleset bound to the match', async () => {
    const { service, rulesets } = createService();
    const result = await service.calculateLive(
      '00000000-0000-4000-8000-000000000001',
      'SECOND_HALF',
    );

    expect(rulesets.get).toHaveBeenCalledWith('ruleset-bound-to-match');
    expect(result.initialAllowanceUs).toBe(30 * SECOND_US);
  });

  it('fails closed with service unavailable when the primary clock is absent', async () => {
    const { service } = createService({ omitPrimary: true });

    await expect(
      service.calculateLive('00000000-0000-4000-8000-000000000001', 'SECOND_HALF'),
    ).rejects.toMatchObject({ statusCode: 503, code: 'SERVICE_UNAVAILABLE' });
  });

  it('withholds an operational recommendation when the primary clock sample is stale', async () => {
    const { service } = createService({ clockAgeMs: 2_001 });
    const result = await service.calculateLive(
      '00000000-0000-4000-8000-000000000001',
      'SECOND_HALF',
    );

    expect(result.clock.fresh).toBe(false);
    expect(result.integrity).toBe('UNSAFE');
    expect(result.operationalRecommendation).toBe('WITHHELD');
  });
  it('requires human review when fresh authoritative sources disagree beyond the drift limit', async () => {
    const { service } = createService({ backupElapsedUs: 101 * SECOND_US });
    const result = await service.calculateLive(
      '00000000-0000-4000-8000-000000000001',
      'SECOND_HALF',
    );

    expect(result.clock.consensus.sourcesConsistent).toBe(false);
    expect(result.integrity).toBe('DEGRADED');
    expect(result.operationalRecommendation).toBe('REVIEW_REQUIRED');
  });

  it('projects asynchronous clock samples to a common instant before comparing drift', async () => {
    const { service } = createService({
      primaryElapsedUs: 100 * SECOND_US,
      primaryClockAgeMs: 1_000,
      backupElapsedUs: 100_800_000,
      backupClockAgeMs: 200,
    });
    const result = await service.calculateLive(
      '00000000-0000-4000-8000-000000000001',
      'SECOND_HALF',
    );

    expect(result.nowUs).toBe(101 * SECOND_US);
    expect(result.clock.consensus.quorumMet).toBe(true);
    expect(result.clock.consensus.sourceDriftUs).toBe(0);
    expect(result.operationalRecommendation).toBe('VALID');
  });

  it('reports operational drift from fresh sources while retaining stale drift as diagnostics', async () => {
    const { service } = createService({
      primaryElapsedUs: 100 * SECOND_US,
      primaryClockAgeMs: 100,
      backupElapsedUs: 500 * SECOND_US,
      backupClockAgeMs: 5_000,
    });
    const result = await service.calculateLive(
      '00000000-0000-4000-8000-000000000001',
      'SECOND_HALF',
    );

    expect(result.clock.consensus.sourceDriftUs).toBe(0);
    expect(result.clock.consensus.maxObservedSourceDriftUs).toBeGreaterThan(300 * SECOND_US);
    expect(result.clock.consensus.quorumMet).toBe(false);
  });

  it('withholds when redundant clocks freeze together relative to the official period start', async () => {
    const { service } = createService({
      primaryElapsedUs: 100 * SECOND_US,
      backupElapsedUs: 100 * SECOND_US,
      periodWallElapsedUs: 110 * SECOND_US,
    });
    const result = await service.calculateLive(
      '00000000-0000-4000-8000-000000000001',
      'SECOND_HALF',
    );

    expect(result.clock.consensus.quorumMet).toBe(true);
    expect(result.clock.wallClock.consistent).toBe(false);
    expect(result.integrity).toBe('UNSAFE');
    expect(result.operationalRecommendation).toBe('WITHHELD');
  });

  it('uses confirmed event intervals as stoppage evidence at the regulation boundary', async () => {
    const crossingEvent = event({
      kind: 'INJURY',
      startUs: 2_690 * SECOND_US,
      endUs: 2_750 * SECOND_US,
    });
    const { service } = createService({
      primaryElapsedUs: 2_800 * SECOND_US,
      backupElapsedUs: 2_800 * SECOND_US,
      events: [crossingEvent],
    });
    const result = await service.calculateLive(
      '00000000-0000-4000-8000-000000000001',
      'SECOND_HALF',
    );

    expect(result.initialAllowanceUs).toBe(10 * SECOND_US);
    expect(result.addedTimeStartUs).toBe(2_750 * SECOND_US);
    expect(result.exactTargetEndUs).toBe(2_760 * SECOND_US);
  });
});
