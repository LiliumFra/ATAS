import type {
  EngineInput,
  EngineResult,
  ExcludedEvent,
  Interval,
  MatchEvent,
  Ruleset,
} from './types.js';

export const SECOND_US = 1_000_000;
export const MINUTE_US = 60 * SECOND_US;

export function assertSafeUs(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${field} must be a non-negative safe integer in microseconds`);
  }
}

export function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  const ordered = intervals
    .filter((interval) => interval.endUs > interval.startUs)
    .map((interval) => ({ ...interval }))
    .sort((left, right) => left.startUs - right.startUs || left.endUs - right.endUs);

  const first = ordered[0];
  if (first === undefined) return [];

  const merged: Interval[] = [first];

  for (let index = 1; index < ordered.length; index += 1) {
    const current = ordered[index];
    const previous = merged.at(-1);
    if (current === undefined || previous === undefined) continue;

    if (current.startUs <= previous.endUs) {
      previous.endUs = Math.max(previous.endUs, current.endUs);
    } else {
      merged.push(current);
    }
  }

  return merged;
}

export function intervalDuration(intervals: readonly Interval[]): number {
  return intervals.reduce((total, interval) => total + interval.endUs - interval.startUs, 0);
}

export function intersectInterval(
  interval: Interval,
  rangeStartUs: number,
  rangeEndUs: number,
): Interval | undefined {
  const startUs = Math.max(interval.startUs, rangeStartUs);
  const endUs = Math.min(interval.endUs, rangeEndUs);
  return endUs > startUs ? { startUs, endUs } : undefined;
}

function evaluateEvent(
  event: MatchEvent,
  nowUs: number,
  ruleset: Ruleset,
): { interval?: Interval; exclusion?: ExcludedEvent } {
  if (event.status !== 'CONFIRMED' && event.status !== 'CORRECTED') {
    return {
      exclusion: {
        eventId: event.eventId,
        kind: event.kind,
        status: event.status,
        reason: 'STATUS_NOT_CONFIRMED',
      },
    };
  }

  const policy = ruleset.policies[event.kind];
  if (policy.mode === 'NONE') {
    return {
      exclusion: {
        eventId: event.eventId,
        kind: event.kind,
        status: event.status,
        reason: 'POLICY_NONE',
      },
    };
  }

  assertSafeUs(event.startUs, `event ${event.eventId} startUs`);
  if (event.endUs !== undefined) assertSafeUs(event.endUs, `event ${event.eventId} endUs`);
  if (event.startUs > nowUs) {
    return {
      exclusion: {
        eventId: event.eventId,
        kind: event.kind,
        status: event.status,
        reason: 'NOT_YET_STARTED',
      },
    };
  }

  const endUs = Math.min(event.endUs ?? nowUs, nowUs);
  const startUs = policy.mode === 'EXCESS' ? event.startUs + policy.graceUs : event.startUs;
  if (endUs <= startUs) {
    return {
      exclusion: {
        eventId: event.eventId,
        kind: event.kind,
        status: event.status,
        reason: policy.mode === 'EXCESS' ? 'WITHIN_GRACE' : 'NO_COMPENSABLE_DURATION',
      },
    };
  }

  return { interval: { startUs, endUs } };
}

function eventInterval(event: MatchEvent, nowUs: number, ruleset: Ruleset): Interval | undefined {
  return evaluateEvent(event, nowUs, ruleset).interval;
}

export function compensableIntervals(
  events: readonly MatchEvent[],
  nowUs: number,
  ruleset: Ruleset,
): { intervals: Interval[]; includedEventIds: string[] } {
  const intervals: Interval[] = [];
  const includedEventIds: string[] = [];

  for (const event of events) {
    const interval = eventInterval(event, nowUs, ruleset);
    if (interval !== undefined) {
      intervals.push(interval);
      includedEventIds.push(event.eventId);
    }
  }

  return { intervals: mergeIntervals(intervals), includedEventIds };
}

export function findAddedTimeStartUs(
  nominalBoundaryUs: number,
  allPlayStoppages: readonly Interval[],
): number {
  const crossing = mergeIntervals(allPlayStoppages).find(
    (interval) => interval.startUs < nominalBoundaryUs && interval.endUs > nominalBoundaryUs,
  );
  return crossing?.endUs ?? nominalBoundaryUs;
}

export function calculateAddedTime(input: EngineInput): EngineResult {
  assertSafeUs(input.nowUs, 'nowUs');

  const nominalBoundaryUs = input.ruleset.nominalPeriodUs[input.period];
  assertSafeUs(nominalBoundaryUs, 'nominalBoundaryUs');

  const addedTimeStartUs = findAddedTimeStartUs(nominalBoundaryUs, input.allPlayStoppages);
  const evaluations = input.events.map((event) => ({
    event,
    ...evaluateEvent(event, input.nowUs, input.ruleset),
  }));
  const eventIntervals = evaluations.filter(
    (entry): entry is { event: MatchEvent; interval: Interval; exclusion?: undefined } =>
      entry.interval !== undefined,
  );
  const excludedEvents = evaluations
    .map((entry) => entry.exclusion)
    .filter((entry): entry is ExcludedEvent => entry !== undefined);
  const compensable = mergeIntervals(eventIntervals.map((entry) => entry.interval));
  const includedEventIds = eventIntervals.map((entry) => entry.event.eventId);

  const regulationIntervals = compensable
    .map((interval) => intersectInterval(interval, 0, nominalBoundaryUs))
    .filter((interval): interval is Interval => interval !== undefined);

  const initialAllowanceUs = intervalDuration(mergeIntervals(regulationIntervals));
  const announcedAllowanceUs = (input.announcedMinutes ?? 0) * MINUTE_US;
  const effectiveBaseAllowanceUs = Math.max(initialAllowanceUs, announcedAllowanceUs);
  const baseTargetEndUs = addedTimeStartUs + effectiveBaseAllowanceUs;

  let exactTargetEndUs = baseTargetEndUs;
  const maxIterations = Math.max(8, input.events.length + 2);

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const addedIntervals = compensable
      .map((interval) => intersectInterval(interval, addedTimeStartUs, input.nowUs))
      .filter((interval): interval is Interval => interval !== undefined)
      .filter((interval) => interval.startUs < exactTargetEndUs);

    const lossDuringAddedTimeUs = intervalDuration(mergeIntervals(addedIntervals));
    const nextTargetUs = baseTargetEndUs + lossDuringAddedTimeUs;

    if (nextTargetUs === exactTargetEndUs) break;
    exactTargetEndUs = nextTargetUs;
  }

  const lossDuringAddedTimeUs = Math.max(0, exactTargetEndUs - baseTargetEndUs);
  const activeEventIds = input.events
    .filter(
      (event) =>
        (event.status === 'CONFIRMED' || event.status === 'CORRECTED') &&
        event.startUs <= input.nowUs &&
        event.endUs === undefined,
    )
    .map((event) => event.eventId);

  const countedIntervalsByEvent = eventIntervals.map(({ event, interval }) => {
    const regulation = intersectInterval(interval, 0, nominalBoundaryUs);
    const added =
      interval.startUs < exactTargetEndUs
        ? intersectInterval(interval, addedTimeStartUs, input.nowUs)
        : undefined;
    return {
      event,
      intervals: mergeIntervals(
        [regulation, added].filter((item): item is Interval => item !== undefined),
      ),
      regulationUs: regulation === undefined ? 0 : intervalDuration([regulation]),
      addedTimeUs: added === undefined ? 0 : intervalDuration([added]),
    };
  });

  const eventContributions = countedIntervalsByEvent.map((entry, index) => {
    const otherIntervals = mergeIntervals(
      countedIntervalsByEvent
        .filter((_other, otherIndex) => otherIndex !== index)
        .flatMap((other) => other.intervals),
    );
    const sharedIntervals = entry.intervals.flatMap((own) =>
      otherIntervals
        .map((other) => intersectInterval(own, other.startUs, other.endUs))
        .filter((item): item is Interval => item !== undefined),
    );
    const totalRawUs = entry.regulationUs + entry.addedTimeUs;
    const sharedUs = intervalDuration(mergeIntervals(sharedIntervals));
    return {
      eventId: entry.event.eventId,
      kind: entry.event.kind,
      policyMode: input.ruleset.policies[entry.event.kind].mode,
      regulationUs: entry.regulationUs,
      addedTimeUs: entry.addedTimeUs,
      totalRawUs,
      exclusiveUs: Math.max(0, totalRawUs - sharedUs),
      sharedUs,
    };
  });
  const rawCompensableUs = eventContributions.reduce(
    (total, contribution) => total + contribution.totalRawUs,
    0,
  );
  const deduplicatedCompensableUs = initialAllowanceUs + lossDuringAddedTimeUs;
  const overlapDeductedUs = Math.max(0, rawCompensableUs - deduplicatedCompensableUs);

  const boardEvidenceUs =
    input.announcedMinutes === undefined ? initialAllowanceUs : announcedAllowanceUs;

  const integrity = !input.clockIntegrityOk
    ? 'UNSAFE'
    : !input.sourceIntegrityOk
      ? 'DEGRADED'
      : 'OK';

  const operationalRecommendation =
    integrity === 'OK' ? 'VALID' : integrity === 'DEGRADED' ? 'REVIEW_REQUIRED' : 'WITHHELD';

  return {
    period: input.period,
    nowUs: input.nowUs,
    nominalBoundaryUs,
    addedTimeStartUs,
    initialAllowanceUs,
    announcedAllowanceUs,
    effectiveBaseAllowanceUs,
    lossDuringAddedTimeUs,
    exactTargetEndUs,
    remainingUs: Math.max(0, exactTargetEndUs - input.nowUs),
    boardFloorMinutes: Math.floor(boardEvidenceUs / MINUTE_US),
    boardCeilMinutes: Math.ceil(boardEvidenceUs / MINUTE_US),
    activeEventIds,
    includedEventIds,
    eventContributions,
    excludedEvents,
    rawCompensableUs,
    overlapDeductedUs,
    integrity,
    operationalRecommendation,
    decisionRequired: input.announcedMinutes === undefined,
  };
}
