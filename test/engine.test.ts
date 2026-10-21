import { beforeAll, describe, expect, it } from 'vitest';
import { calculateAddedTime, mergeIntervals, SECOND_US } from '../src/domain/engine.js';
import { loadRuleset } from '../src/domain/ruleset.js';
import type { Ruleset } from '../src/domain/types.js';
import { event, shortRuleset } from './fixtures.js';

let ruleset: Ruleset;

beforeAll(async () => {
  ruleset = shortRuleset(await loadRuleset('rulesets/ifab-2026-27.json'));
});

describe('mergeIntervals', () => {
  it('merges overlapping and touching intervals without double counting', () => {
    expect(
      mergeIntervals([
        { startUs: 10, endUs: 20 },
        { startUs: 15, endUs: 30 },
        { startUs: 30, endUs: 40 },
      ]),
    ).toEqual([{ startUs: 10, endUs: 40 }]);
  });
});

describe('calculateAddedTime', () => {
  it('does not double count overlapping compensable events', () => {
    const result = calculateAddedTime({
      period: 'SECOND_HALF',
      nowUs: 1_000 * SECOND_US,
      ruleset,
      events: [
        event({ kind: 'INJURY', startUs: 100 * SECOND_US, endUs: 200 * SECOND_US }),
        event({ kind: 'VAR_REVIEW', startUs: 150 * SECOND_US, endUs: 250 * SECOND_US }),
      ],
      allPlayStoppages: [],
      clockIntegrityOk: true,
      sourceIntegrityOk: true,
    });

    expect(result.initialAllowanceUs).toBe(150 * SECOND_US);
  });

  it('reports raw event contributions and overlap removed from the final total', () => {
    const result = calculateAddedTime({
      period: 'SECOND_HALF',
      nowUs: 1_000 * SECOND_US,
      ruleset,
      events: [
        event({ kind: 'INJURY', startUs: 100 * SECOND_US, endUs: 200 * SECOND_US }),
        event({ kind: 'VAR_REVIEW', startUs: 150 * SECOND_US, endUs: 250 * SECOND_US }),
      ],
      allPlayStoppages: [],
      clockIntegrityOk: true,
      sourceIntegrityOk: true,
    });

    expect(result.rawCompensableUs).toBe(200 * SECOND_US);
    expect(result.overlapDeductedUs).toBe(50 * SECOND_US);
    expect(result.eventContributions).toHaveLength(2);
    expect(result.eventContributions.map((item) => item.sharedUs)).toEqual([
      50 * SECOND_US,
      50 * SECOND_US,
    ]);
    expect(result.eventContributions.map((item) => item.exclusiveUs)).toEqual([
      50 * SECOND_US,
      50 * SECOND_US,
    ]);
  });

  it('handles a stoppage crossing the regulation boundary', () => {
    const result = calculateAddedTime({
      period: 'SECOND_HALF',
      nowUs: 2_800 * SECOND_US,
      ruleset,
      events: [event({ kind: 'INJURY', startUs: 2_690 * SECOND_US, endUs: 2_750 * SECOND_US })],
      allPlayStoppages: [{ startUs: 2_690 * SECOND_US, endUs: 2_750 * SECOND_US }],
      clockIntegrityOk: true,
      sourceIntegrityOk: true,
    });

    expect(result.initialAllowanceUs).toBe(10 * SECOND_US);
    expect(result.addedTimeStartUs).toBe(2_750 * SECOND_US);
    expect(result.exactTargetEndUs).toBe(2_760 * SECOND_US);
  });

  it('extends the target for a new interruption during added time', () => {
    const result = calculateAddedTime({
      period: 'SECOND_HALF',
      nowUs: 2_750 * SECOND_US,
      ruleset,
      events: [
        event({ kind: 'INJURY', startUs: 2_600 * SECOND_US, endUs: 2_660 * SECOND_US }),
        event({ kind: 'VAR_CHECK', startUs: 2_720 * SECOND_US, endUs: 2_740 * SECOND_US }),
      ],
      allPlayStoppages: [],
      clockIntegrityOk: true,
      sourceIntegrityOk: true,
    });

    expect(result.initialAllowanceUs).toBe(60 * SECOND_US);
    expect(result.lossDuringAddedTimeUs).toBe(20 * SECOND_US);
    expect(result.exactTargetEndUs).toBe(2_780 * SECOND_US);
  });

  it('uses the announced amount as a minimum after approval', () => {
    const result = calculateAddedTime({
      period: 'SECOND_HALF',
      nowUs: 2_700 * SECOND_US,
      ruleset,
      events: [event({ kind: 'INJURY', startUs: 2_650 * SECOND_US, endUs: 2_680 * SECOND_US })],
      allPlayStoppages: [],
      announcedMinutes: 2,
      clockIntegrityOk: true,
      sourceIntegrityOk: true,
    });

    expect(result.initialAllowanceUs).toBe(30 * SECOND_US);
    expect(result.effectiveBaseAllowanceUs).toBe(120 * SECOND_US);
    expect(result.boardFloorMinutes).toBe(2);
    expect(result.boardCeilMinutes).toBe(2);
  });

  it('keeps the displayed board fixed after an official announcement even when measured loss is higher', () => {
    const result = calculateAddedTime({
      period: 'SECOND_HALF',
      nowUs: 2_700 * SECOND_US,
      ruleset,
      events: [event({ kind: 'INJURY', startUs: 2_500 * SECOND_US, endUs: 2_680 * SECOND_US })],
      allPlayStoppages: [],
      announcedMinutes: 2,
      clockIntegrityOk: true,
      sourceIntegrityOk: true,
    });

    expect(result.initialAllowanceUs).toBe(180 * SECOND_US);
    expect(result.effectiveBaseAllowanceUs).toBe(180 * SECOND_US);
    expect(result.boardFloorMinutes).toBe(2);
    expect(result.boardCeilMinutes).toBe(2);
  });

  it('applies grace only to EXCESS policies', () => {
    const result = calculateAddedTime({
      period: 'SECOND_HALF',
      nowUs: 100 * SECOND_US,
      ruleset,
      events: [event({ kind: 'THROW_IN_RESTART', startUs: 10 * SECOND_US, endUs: 35 * SECOND_US })],
      allPlayStoppages: [],
      clockIntegrityOk: true,
      sourceIntegrityOk: true,
    });

    expect(result.initialAllowanceUs).toBe(10 * SECOND_US);
  });

  it('ignores proposed events until an official confirms them', () => {
    const result = calculateAddedTime({
      period: 'SECOND_HALF',
      nowUs: 100 * SECOND_US,
      ruleset,
      events: [
        event({
          kind: 'INJURY',
          startUs: 10 * SECOND_US,
          endUs: 80 * SECOND_US,
          status: 'PROPOSED',
        }),
      ],
      allPlayStoppages: [],
      clockIntegrityOk: true,
      sourceIntegrityOk: true,
    });

    expect(result.initialAllowanceUs).toBe(0);
  });

  it('keeps an active stoppage crossing the boundary outside added-time play', () => {
    const result = calculateAddedTime({
      period: 'SECOND_HALF',
      nowUs: 2_720 * SECOND_US,
      ruleset,
      events: [event({ kind: 'INJURY', startUs: 2_690 * SECOND_US })],
      allPlayStoppages: [{ startUs: 2_690 * SECOND_US, endUs: 2_720 * SECOND_US }],
      clockIntegrityOk: true,
      sourceIntegrityOk: true,
    });

    expect(result.initialAllowanceUs).toBe(10 * SECOND_US);
    expect(result.addedTimeStartUs).toBe(2_720 * SECOND_US);
    expect(result.exactTargetEndUs).toBe(2_730 * SECOND_US);
  });

  it('includes corrected records as confirmed evidence', () => {
    const result = calculateAddedTime({
      period: 'SECOND_HALF',
      nowUs: 100 * SECOND_US,
      ruleset,
      events: [
        event({
          kind: 'INJURY',
          startUs: 10 * SECOND_US,
          endUs: 50 * SECOND_US,
          status: 'CORRECTED',
        }),
      ],
      allPlayStoppages: [],
      clockIntegrityOk: true,
      sourceIntegrityOk: true,
    });

    expect(result.initialAllowanceUs).toBe(40 * SECOND_US);
  });

  it('fails closed when clock integrity is lost', () => {
    const result = calculateAddedTime({
      period: 'SECOND_HALF',
      nowUs: 100 * SECOND_US,
      ruleset,
      events: [],
      allPlayStoppages: [],
      clockIntegrityOk: false,
      sourceIntegrityOk: true,
    });

    expect(result.integrity).toBe('UNSAFE');
    expect(result.operationalRecommendation).toBe('WITHHELD');
  });

  it('does not report an event that starts in the future as active', () => {
    const result = calculateAddedTime({
      period: 'SECOND_HALF',
      nowUs: 100 * SECOND_US,
      ruleset,
      events: [event({ kind: 'INJURY', startUs: 120 * SECOND_US })],
      allPlayStoppages: [],
      clockIntegrityOk: true,
      sourceIntegrityOk: true,
    });

    expect(result.activeEventIds).toEqual([]);
    expect(result.initialAllowanceUs).toBe(0);
  });

  it('requires human review when source integrity is degraded', () => {
    const result = calculateAddedTime({
      period: 'SECOND_HALF',
      nowUs: 100 * SECOND_US,
      ruleset,
      events: [],
      allPlayStoppages: [],
      clockIntegrityOk: true,
      sourceIntegrityOk: false,
    });

    expect(result.integrity).toBe('DEGRADED');
    expect(result.operationalRecommendation).toBe('REVIEW_REQUIRED');
  });

  it('treats a stoppage beginning exactly at the boundary as added-time loss', () => {
    const result = calculateAddedTime({
      period: 'SECOND_HALF',
      nowUs: 2_730 * SECOND_US,
      ruleset,
      events: [
        event({
          kind: 'INJURY',
          startUs: 2_700 * SECOND_US,
          endUs: 2_720 * SECOND_US,
        }),
      ],
      allPlayStoppages: [{ startUs: 2_700 * SECOND_US, endUs: 2_720 * SECOND_US }],
      announcedMinutes: 1,
      clockIntegrityOk: true,
      sourceIntegrityOk: true,
    });

    expect(result.addedTimeStartUs).toBe(2_700 * SECOND_US);
    expect(result.initialAllowanceUs).toBe(0);
    expect(result.lossDuringAddedTimeUs).toBe(20 * SECOND_US);
    expect(result.exactTargetEndUs).toBe(2_780 * SECOND_US);
  });
});
