import type { AppConfig } from '../config.js';
import type { Database } from '../db/pool.js';
import { lockMatch, type DbClient, withTransaction } from '../db/tx.js';
import { ConflictError, NotFoundError, ServiceUnavailableError } from '../domain/errors.js';
import { assertBoundedJsonObject } from '../domain/json-limits.js';
import type { Period } from '../domain/types.js';
import type { AuditRepository } from '../repositories/audit.js';
import type {
  CreateEventInput,
  EventRepository,
  ReviseEventInput,
} from '../repositories/events.js';
import type { StoppageRepository } from '../repositories/stoppages.js';

export class EventService {
  public constructor(
    private readonly pool: Database,
    private readonly events: EventRepository,
    private readonly stoppages: StoppageRepository,
    private readonly audit: AuditRepository,
    private readonly config: AppConfig,
  ) {}

  public async createEvent(input: CreateEventInput) {
    assertBoundedJsonObject(input.evidence, 'event evidence');
    return withTransaction(this.pool, async (client) => {
      await lockMatch(client, input.matchId);
      await this.requireRunningPeriod(client, input.matchId, input.period);
      const result = await this.events.append(client, input);
      if (result.created) {
        await this.validateTimesAgainstAuthoritativeClock(client, input.matchId, input.period, [
          input.startUs,
          ...(input.endUs === undefined ? [] : [input.endUs]),
        ]);
        await this.audit.append(client, {
          matchId: input.matchId,
          actor: input.createdBy,
          action: 'EVENT_APPENDED',
          payload: {
            eventId: result.event.eventId,
            revision: result.event.revision,
            kind: result.event.kind,
            status: result.event.status,
          },
        });
      }
      return result;
    });
  }

  public async reviseEvent(input: ReviseEventInput) {
    if (input.corrections?.evidence !== undefined) {
      assertBoundedJsonObject(input.corrections.evidence, 'event correction evidence');
    }
    return withTransaction(this.pool, async (client) => {
      await lockMatch(client, input.matchId);
      const current = await client.query<{
        period: Period;
        start_us: number;
        end_us: number | null;
      }>(
        `SELECT period, start_us, end_us FROM match_events
         WHERE match_id = $1 AND event_id = $2
         ORDER BY revision DESC LIMIT 1`,
        [input.matchId, input.eventId],
      );
      const row = current.rows[0];
      if (row === undefined) throw new NotFoundError('Event not found');
      await this.requireRunningPeriod(client, input.matchId, row.period);
      const result = await this.events.revise(client, input);
      if (result.created) {
        await this.validateTimesAgainstAuthoritativeClock(client, input.matchId, row.period, [
          result.event.startUs,
          ...(result.event.endUs === undefined ? [] : [result.event.endUs]),
        ]);
        await this.audit.append(client, {
          matchId: input.matchId,
          actor: input.actor,
          action: 'EVENT_REVISED',
          payload: {
            eventId: result.event.eventId,
            revision: result.event.revision,
            status: result.event.status,
          },
        });
      }
      return result;
    });
  }

  public async closeStoppage(input: Parameters<StoppageRepository['close']>[1]) {
    return withTransaction(this.pool, async (client) => {
      await lockMatch(client, input.matchId);
      const current = await client.query<{ period: Period }>(
        `SELECT period FROM play_stoppages
         WHERE match_id = $1 AND stoppage_id = $2
         ORDER BY revision DESC LIMIT 1`,
        [input.matchId, input.stoppageId],
      );
      const period = current.rows[0]?.period;
      if (period === undefined) throw new NotFoundError('Stoppage not found');
      await this.requireRunningPeriod(client, input.matchId, period);
      const result = await this.stoppages.close(client, input);
      if (result.created) {
        await this.validateTimesAgainstAuthoritativeClock(client, input.matchId, period, [
          input.endUs,
        ]);
        await this.audit.append(client, {
          matchId: input.matchId,
          actor: input.actor,
          action: 'PLAY_STOPPAGE_CLOSED',
          payload: {
            stoppageId: result.stoppage.stoppageId,
            revision: result.stoppage.revision,
            endUs: result.stoppage.endUs ?? null,
            status: result.stoppage.status,
          },
        });
      }
      return result;
    });
  }

  public async createStoppage(input: Parameters<StoppageRepository['append']>[1]) {
    assertBoundedJsonObject(input.evidence, 'stoppage evidence');
    return withTransaction(this.pool, async (client) => {
      await lockMatch(client, input.matchId);
      await this.requireRunningPeriod(client, input.matchId, input.period);
      const result = await this.stoppages.append(client, input);
      if (result.created) {
        await this.validateTimesAgainstAuthoritativeClock(client, input.matchId, input.period, [
          input.startUs,
          ...(input.endUs === undefined ? [] : [input.endUs]),
        ]);
        await this.audit.append(client, {
          matchId: input.matchId,
          actor: input.createdBy,
          action: 'PLAY_STOPPAGE_APPENDED',
          payload: {
            stoppageId: result.stoppage.stoppageId,
            period: result.stoppage.period,
            startUs: result.stoppage.startUs,
            endUs: result.stoppage.endUs,
          },
        });
      }
      return result;
    });
  }

  private async requireRunningPeriod(
    client: DbClient,
    matchId: string,
    period: Period,
  ): Promise<void> {
    const state = await client.query<{ match_status: string; period_status: string }>(
      `SELECT m.status AS match_status, p.status AS period_status
       FROM matches m
       JOIN periods p ON p.match_id = m.id
       WHERE m.id = $1 AND p.period = $2`,
      [matchId, period],
    );
    const current = state.rows[0];
    if (current === undefined) throw new NotFoundError('Match or period not found');
    if (current.match_status !== 'LIVE' || current.period_status !== 'RUNNING') {
      throw new ConflictError('Events may only be changed while the selected period is running');
    }
  }

  private async validateTimesAgainstAuthoritativeClock(
    client: DbClient,
    matchId: string,
    period: Period,
    values: number[],
  ): Promise<void> {
    const latest = await client.query<{
      elapsed_us: number | null;
      age_ms: number | null;
      clock_integrity_ok: boolean;
    }>(
      `SELECT latest.elapsed_us,
              GREATEST(0, EXTRACT(EPOCH FROM (clock_timestamp() - latest.received_at)) * 1000)::double precision AS age_ms,
              m.clock_integrity_ok
       FROM matches m
       LEFT JOIN LATERAL (
         SELECT elapsed_us, received_at
         FROM match_clock_samples
         WHERE match_id = m.id AND period = $2 AND source_id = $3
         ORDER BY source_sequence DESC LIMIT 1
       ) latest ON true
       WHERE m.id = $1`,
      [matchId, period, this.config.primaryClockSource],
    );
    const state = latest.rows[0];
    if (state === undefined) throw new NotFoundError('Match not found');

    if (state.elapsed_us === null || state.age_ms === null) {
      if (state.clock_integrity_ok) {
        throw new ServiceUnavailableError(
          'A primary authoritative clock sample is required before accepting timed evidence',
        );
      }
      return;
    }

    if (state.age_ms > this.config.clockMaxSampleAgeMs) {
      if (state.clock_integrity_ok) {
        throw new ServiceUnavailableError(
          'The primary authoritative clock is stale; mark clock integrity unsafe or restore the feed',
        );
      }
      return;
    }

    const projectedElapsedUs = state.elapsed_us + Math.round(state.age_ms * 1_000);
    const maximumAcceptedUs = projectedElapsedUs + this.config.clockFutureToleranceUs;
    if (values.some((value) => value > maximumAcceptedUs)) {
      throw new ConflictError(
        'Event time is ahead of the projected authoritative clock beyond the configured tolerance',
      );
    }
  }
}
