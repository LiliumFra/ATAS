import type { AppConfig } from '../config.js';
import type { Database } from '../db/pool.js';
import { withTransaction } from '../db/tx.js';
import { calculateAddedTime } from '../domain/engine.js';
import { ConflictError, NotFoundError, ServiceUnavailableError } from '../domain/errors.js';
import type { Period, Ruleset } from '../domain/types.js';
import type { AuditRepository } from '../repositories/audit.js';
import type { ClockRepository } from '../repositories/clock.js';
import type { EventRepository } from '../repositories/events.js';
import type { MatchRepository, MatchRecord, PeriodRecord } from '../repositories/matches.js';
import type { RulesetRepository } from '../repositories/rulesets.js';
import type { StoppageRepository } from '../repositories/stoppages.js';

export class EngineService {
  public constructor(
    private readonly pool: Database,
    private readonly matches: MatchRepository,
    private readonly events: EventRepository,
    private readonly stoppages: StoppageRepository,
    private readonly clocks: ClockRepository,
    private readonly rulesets: RulesetRepository,
    private readonly audit: AuditRepository,
    private readonly config: AppConfig,
  ) {}

  /** Diagnostic/replay calculation using an explicit match-relative clock value. */
  public async calculate(matchId: string, period: Period, nowUs: number) {
    const context = await this.loadContext(matchId, period);
    return this.calculateFromContext(context, nowUs, context.match.clockIntegrityOk);
  }

  /** Operational calculation driven by the configured primary clock and monitored against redundant sources. */
  public async calculateLive(matchId: string, period: Period) {
    const [context, clockSamples] = await Promise.all([
      this.loadContext(matchId, period),
      this.clocks.latestMany(matchId, period, this.config.clockSourceSubjects),
    ]);
    const primaryClock = clockSamples.find(
      (sample) => sample.sourceId === this.config.primaryClockSource,
    );
    if (primaryClock === undefined) {
      throw new ServiceUnavailableError(
        'No primary authoritative clock sample is available for this period',
      );
    }
    if (context.periodRecord.status !== 'RUNNING') {
      throw new ConflictError('Live estimates are available only while the period is running');
    }

    // All samples are projected to the same server-observed instant. Comparing raw samples
    // received at different times would incorrectly report transport delay as clock drift.
    const projectedSamples = clockSamples.map((sample) => {
      const projectionAgeMs = Math.min(sample.ageMs, this.config.clockMaxSampleAgeMs);
      const projectedElapsedUs = sample.elapsedUs + Math.round(projectionAgeMs * 1_000);
      return {
        ...sample,
        projectedElapsedUs,
        fresh: sample.ageMs <= this.config.clockMaxSampleAgeMs,
      };
    });
    const projectedPrimary = projectedSamples.find(
      (sample) => sample.sourceId === this.config.primaryClockSource,
    );
    if (projectedPrimary === undefined) {
      throw new ServiceUnavailableError('Primary clock projection could not be calculated');
    }

    const freshSamples = projectedSamples.filter((sample) => sample.fresh);
    const sourceStates = projectedSamples.map((sample) => {
      const residualUs = Math.abs(sample.projectedElapsedUs - projectedPrimary.projectedElapsedUs);
      return {
        sourceId: sample.sourceId,
        sourceSequence: sample.sourceSequence,
        elapsedUs: sample.elapsedUs,
        projectedElapsedUs: sample.projectedElapsedUs,
        residualToPrimaryUs: residualUs,
        consistent: sample.fresh && residualUs <= this.config.clockMaxSourceDriftUs,
        sampleAgeMs: Math.round(sample.ageMs),
        fresh: sample.fresh,
        receivedAt: sample.receivedAt,
        ...(sample.sourceTimestamp === undefined
          ? {}
          : { sourceTimestamp: sample.sourceTimestamp }),
      };
    });
    const consistentFreshSources = sourceStates.filter((sample) => sample.consistent).length;
    const sourceDriftUs = sourceStates
      .filter((sample) => sample.fresh)
      .reduce((maximum, sample) => Math.max(maximum, sample.residualToPrimaryUs), 0);
    const maxObservedSourceDriftUs = sourceStates.reduce(
      (maximum, sample) => Math.max(maximum, sample.residualToPrimaryUs),
      0,
    );
    const quorumMet = consistentFreshSources >= this.config.clockMinimumFreshSources;
    const primaryFresh = projectedPrimary.fresh;
    const sourcesConsistent = quorumMet;
    const wallClockDriftUs = Math.abs(
      projectedPrimary.projectedElapsedUs - projectedPrimary.periodWallElapsedUs,
    );
    const wallClockConsistent = wallClockDriftUs <= this.config.clockMaxWallDriftUs;

    const result = this.calculateFromContext(
      context,
      projectedPrimary.projectedElapsedUs,
      context.match.clockIntegrityOk && primaryFresh && wallClockConsistent,
      context.match.sourceIntegrityOk && quorumMet,
    );
    return {
      ...result,
      clock: {
        sourceId: projectedPrimary.sourceId,
        sourceSequence: projectedPrimary.sourceSequence,
        elapsedUs: projectedPrimary.elapsedUs,
        projectedElapsedUs: projectedPrimary.projectedElapsedUs,
        sampleAgeMs: Math.round(projectedPrimary.ageMs),
        maxSampleAgeMs: this.config.clockMaxSampleAgeMs,
        fresh: primaryFresh,
        receivedAt: projectedPrimary.receivedAt,
        ...(projectedPrimary.sourceTimestamp === undefined
          ? {}
          : { sourceTimestamp: projectedPrimary.sourceTimestamp }),
        wallClock: {
          periodWallElapsedUs: projectedPrimary.periodWallElapsedUs,
          driftUs: wallClockDriftUs,
          maxDriftUs: this.config.clockMaxWallDriftUs,
          consistent: wallClockConsistent,
        },
        consensus: {
          freshSources: freshSamples.length,
          consistentFreshSources,
          minimumFreshSources: this.config.clockMinimumFreshSources,
          quorumMet,
          sourceDriftUs,
          maxObservedSourceDriftUs,
          maxSourceDriftUs: this.config.clockMaxSourceDriftUs,
          sourcesConsistent,
          sources: sourceStates,
        },
      },
    };
  }

  public async verifyAudit(matchId: string) {
    return withTransaction(this.pool, async (client) => {
      const [audit, events, stoppages, clocks] = await Promise.all([
        this.audit.verify(client, matchId),
        this.events.verify(client, matchId),
        this.stoppages.verify(client, matchId),
        this.clocks.verify(client, matchId),
      ]);
      return {
        valid: audit.valid && events.valid && stoppages.valid && clocks.valid,
        audit,
        events,
        stoppages,
        clocks,
      };
    });
  }

  private async loadContext(
    matchId: string,
    period: Period,
  ): Promise<{
    match: MatchRecord;
    periodRecord: PeriodRecord;
    ruleset: Ruleset;
    events: Awaited<ReturnType<EventRepository['listLatest']>>;
    stoppages: Awaited<ReturnType<StoppageRepository['listLatest']>>;
  }> {
    const match = await this.matches.get(matchId);
    if (match === undefined) throw new NotFoundError('Match not found');

    const [periodRecord, ruleset, events, stoppages] = await Promise.all([
      this.matches.getPeriod(matchId, period),
      this.rulesets.get(match.rulesetId),
      this.events.listLatest(matchId, period),
      this.stoppages.listLatest(matchId, period),
    ]);
    if (periodRecord === undefined) throw new NotFoundError('Period not found');
    if (ruleset === undefined) {
      throw new Error(`Ruleset ${match.rulesetId} bound to match ${matchId} was not found`);
    }
    return { match, periodRecord, ruleset, events, stoppages };
  }

  private calculateFromContext(
    context: Awaited<ReturnType<EngineService['loadContext']>>,
    nowUs: number,
    clockIntegrityOk: boolean,
    sourceIntegrityOk = context.match.sourceIntegrityOk,
  ) {
    return calculateAddedTime({
      period: context.periodRecord.period,
      nowUs,
      ruleset: context.ruleset,
      events: context.events,
      allPlayStoppages: [
        ...context.stoppages
          .filter(
            (stoppage) =>
              (stoppage.status === 'CONFIRMED' || stoppage.status === 'CORRECTED') &&
              stoppage.startUs <= nowUs,
          )
          .map(({ startUs, endUs }) => ({ startUs, endUs: Math.min(endUs ?? nowUs, nowUs) })),
        // Every confirmed delay event is itself evidence that play was stopped. Including
        // its raw interval prevents a missing duplicate stoppage record from misclassifying
        // an interruption that crosses the nominal 45/90-minute boundary.
        ...context.events
          .filter(
            (event) =>
              (event.status === 'CONFIRMED' || event.status === 'CORRECTED') &&
              event.startUs <= nowUs,
          )
          .map(({ startUs, endUs }) => ({ startUs, endUs: Math.min(endUs ?? nowUs, nowUs) })),
      ].filter((interval) => interval.endUs > interval.startUs),
      ...(context.periodRecord.announcedMinutes === undefined
        ? {}
        : { announcedMinutes: context.periodRecord.announcedMinutes }),
      clockIntegrityOk,
      sourceIntegrityOk,
    });
  }
}
