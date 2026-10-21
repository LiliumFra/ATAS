import { randomUUID } from 'node:crypto';
import type { MatchEvent, Ruleset } from '../src/domain/types.js';

export function event(
  overrides: Partial<MatchEvent> & Pick<MatchEvent, 'kind' | 'startUs'>,
): MatchEvent {
  const eventId = overrides.eventId ?? randomUUID();
  return {
    recordId: overrides.recordId ?? randomUUID(),
    sequence: overrides.sequence ?? 1,
    eventId,
    matchId: overrides.matchId ?? '00000000-0000-4000-8000-000000000001',
    period: overrides.period ?? 'SECOND_HALF',
    revision: overrides.revision ?? 1,
    kind: overrides.kind,
    source: overrides.source ?? 'OPERATOR',
    status: overrides.status ?? 'CONFIRMED',
    startUs: overrides.startUs,
    ...(overrides.endUs === undefined ? {} : { endUs: overrides.endUs }),
    confidence: overrides.confidence ?? 1,
    evidence: overrides.evidence ?? {},
    createdBy: overrides.createdBy ?? 'test',
    ...(overrides.supersedesRecordId === undefined
      ? {}
      : { supersedesRecordId: overrides.supersedesRecordId }),
    previousHash: overrides.previousHash ?? '0'.repeat(64),
    eventHash: overrides.eventHash ?? '1'.repeat(64),
    createdAt: overrides.createdAt ?? new Date(0).toISOString(),
  };
}

export function shortRuleset(base: Ruleset): Ruleset {
  return {
    ...base,
    nominalPeriodUs: {
      FIRST_HALF: 2_700_000_000,
      SECOND_HALF: 2_700_000_000,
      ET_FIRST: 900_000_000,
      ET_SECOND: 900_000_000,
    },
  };
}
