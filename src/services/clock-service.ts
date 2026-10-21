import type { AppConfig } from '../config.js';
import type { Database } from '../db/pool.js';
import { lockMatch, type DbClient, withTransaction } from '../db/tx.js';
import { ConflictError, NotFoundError } from '../domain/errors.js';
import { assertBoundedJsonObject } from '../domain/json-limits.js';
import type { Period } from '../domain/types.js';
import type { AuditRepository } from '../repositories/audit.js';
import type { AppendClockSampleInput, ClockRepository } from '../repositories/clock.js';

export class ClockService {
  public constructor(
    private readonly pool: Database,
    private readonly clocks: ClockRepository,
    private readonly audit: AuditRepository,
    private readonly config: AppConfig,
  ) {}

  public async append(input: AppendClockSampleInput) {
    assertBoundedJsonObject(input.evidence, 'clock evidence');
    if (!this.config.clockSourceSubjects.includes(input.sourceId)) {
      throw new ConflictError('The authenticated subject is not an authorised clock source');
    }

    return withTransaction(this.pool, async (client) => {
      await lockMatch(client, input.matchId);
      await this.requireRunningPeriod(client, input.matchId, input.period);
      await this.rejectImplausibleAdvance(client, input);
      const result = await this.clocks.append(client, input);
      if (result.created) {
        await this.audit.append(client, {
          matchId: input.matchId,
          actor: input.sourceId,
          action: 'CLOCK_SAMPLE_ACCEPTED',
          payload: {
            period: input.period,
            sourceSequence: input.sourceSequence,
            elapsedUs: input.elapsedUs,
          },
        });
      }
      return result.sample;
    });
  }

  private async requireRunningPeriod(
    client: DbClient,
    matchId: string,
    period: Period,
  ): Promise<void> {
    const result = await client.query<{ match_status: string; period_status: string }>(
      `SELECT m.status AS match_status, p.status AS period_status
       FROM matches m JOIN periods p ON p.match_id = m.id
       WHERE m.id = $1 AND p.period = $2`,
      [matchId, period],
    );
    const current = result.rows[0];
    if (current === undefined) throw new NotFoundError('Match or period not found');
    if (current.match_status !== 'LIVE' || current.period_status !== 'RUNNING') {
      throw new ConflictError('Clock samples are accepted only for the running period');
    }
  }

  /**
   * Rejects a source that advances farther than real time plus a small transport/clock-skew
   * allowance. This blocks stale devices and compromised feeds from jumping the authoritative
   * clock forward by minutes while still allowing delayed or bursty delivery.
   */
  private async rejectImplausibleAdvance(
    client: DbClient,
    input: AppendClockSampleInput,
  ): Promise<void> {
    const result = await client.query<{
      server_now: Date;
      started_at: Date;
      latest_elapsed_us: number | null;
      latest_received_at: Date | null;
    }>(
      `SELECT
         clock_timestamp() AS server_now,
         p.started_at,
         latest.elapsed_us AS latest_elapsed_us,
         latest.received_at AS latest_received_at
       FROM periods p
       LEFT JOIN LATERAL (
         SELECT elapsed_us, received_at
         FROM match_clock_samples
         WHERE match_id = p.match_id AND period = p.period AND source_id = $3
         ORDER BY source_sequence DESC
         LIMIT 1
       ) latest ON true
       WHERE p.match_id = $1 AND p.period = $2`,
      [input.matchId, input.period, input.sourceId],
    );
    const state = result.rows[0];
    if (state === undefined) {
      throw new ConflictError('The period does not have a valid start time');
    }

    const baselineElapsedUs = state.latest_elapsed_us ?? 0;
    const baselineAt = state.latest_received_at ?? state.started_at;
    const wallAdvanceUs = Math.max(0, state.server_now.getTime() - baselineAt.getTime()) * 1_000;
    const maximumElapsedUs = baselineElapsedUs + wallAdvanceUs + this.config.clockMaxAdvanceSkewUs;

    if (input.elapsedUs > maximumElapsedUs) {
      throw new ConflictError(
        'Clock sample advances faster than real time beyond the configured skew allowance',
      );
    }
  }
}
