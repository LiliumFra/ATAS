import type { Database } from '../db/pool.js';
import type { DbClient } from '../db/tx.js';
import { ConflictError } from '../domain/errors.js';
import { canonicalJson } from '../domain/canonical.js';
import { chainHash, GENESIS_HASH, verifyChain } from '../domain/hash.js';
import type { ClockSample, Period } from '../domain/types.js';

export type AppendClockSampleResult = { sample: ClockSample; created: boolean };

export type AppendClockSampleInput = {
  matchId: string;
  period: Period;
  sourceId: string;
  sourceSequence: number;
  elapsedUs: number;
  sourceTimestamp?: string;
  evidence: Record<string, unknown>;
};

type ClockRow = {
  sequence: number;
  match_id: string;
  period: Period;
  source_id: string;
  source_sequence: number;
  elapsed_us: number;
  source_timestamp: Date | null;
  evidence: Record<string, unknown>;
  previous_hash: string;
  sample_hash: string;
  received_at: Date;
};

type ClockRowWithAge = ClockRow & {
  age_ms: number;
  period_wall_elapsed_us: number;
};

export type ObservedClockSample = ClockSample & {
  ageMs: number;
  periodWallElapsedUs: number;
};

export class ClockRepository {
  public constructor(
    private readonly pool: Database,
    private readonly secret: string,
  ) {}

  public async append(
    client: DbClient,
    input: AppendClockSampleInput,
  ): Promise<AppendClockSampleResult> {
    const existingResult = await client.query<ClockRow>(
      `SELECT * FROM match_clock_samples
       WHERE match_id = $1 AND period = $2 AND source_id = $3 AND source_sequence = $4
       FOR UPDATE`,
      [input.matchId, input.period, input.sourceId, input.sourceSequence],
    );
    const existing = existingResult.rows[0];
    if (existing !== undefined) {
      if (canonicalJson(clockInputPayload(input)) !== canonicalJson(clockRowPayload(existing))) {
        throw new ConflictError('Clock sample sequence was already used with different content');
      }
      return { sample: mapClock(existing), created: false };
    }

    const latestSource = await client.query<ClockRow>(
      `SELECT * FROM match_clock_samples
       WHERE match_id = $1 AND period = $2 AND source_id = $3
       ORDER BY source_sequence DESC LIMIT 1 FOR UPDATE`,
      [input.matchId, input.period, input.sourceId],
    );
    const latest = latestSource.rows[0];
    if (latest !== undefined) {
      if (input.sourceSequence <= latest.source_sequence) {
        throw new ConflictError('Clock source sequence must increase monotonically');
      }
      if (input.elapsedUs < latest.elapsed_us) {
        throw new ConflictError('Clock elapsed time cannot move backwards');
      }
    }

    const previousResult = await client.query<{ sample_hash: string }>(
      `SELECT sample_hash FROM match_clock_samples
       WHERE match_id = $1 ORDER BY sequence DESC LIMIT 1 FOR UPDATE`,
      [input.matchId],
    );
    const previousHash = previousResult.rows[0]?.sample_hash ?? GENESIS_HASH;
    const payload = clockInputPayload(input);
    const sampleHash = chainHash(previousHash, payload, this.secret);

    const inserted = await client.query<ClockRow>(
      `INSERT INTO match_clock_samples(
        match_id, period, source_id, source_sequence, elapsed_us,
        source_timestamp, evidence, previous_hash, sample_hash, received_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,clock_timestamp()) RETURNING *`,
      [
        input.matchId,
        input.period,
        input.sourceId,
        input.sourceSequence,
        input.elapsedUs,
        input.sourceTimestamp ?? null,
        JSON.stringify(input.evidence),
        previousHash,
        sampleHash,
      ],
    );
    const row = inserted.rows[0];
    if (row === undefined) throw new Error('Failed to append clock sample');

    await client.query(
      `INSERT INTO outbox(topic, aggregate_id, payload)
       VALUES ('match.clock.changed', $1, $2::jsonb)`,
      [
        input.matchId,
        JSON.stringify({
          period: input.period,
          sourceId: input.sourceId,
          sourceSequence: input.sourceSequence,
          elapsedUs: input.elapsedUs,
        }),
      ],
    );
    return { sample: mapClock(row), created: true };
  }

  public async latest(
    matchId: string,
    period: Period,
    sourceId: string,
  ): Promise<ObservedClockSample | undefined> {
    const result = await this.pool.query<ClockRowWithAge>(
      `SELECT samples.*,
              GREATEST(0, EXTRACT(EPOCH FROM (statement_timestamp() - samples.received_at)) * 1000)::double precision AS age_ms,
              GREATEST(0, EXTRACT(EPOCH FROM (statement_timestamp() - periods.started_at)) * 1000000)::bigint AS period_wall_elapsed_us
       FROM match_clock_samples samples
       JOIN periods ON periods.match_id = samples.match_id AND periods.period = samples.period
       WHERE samples.match_id = $1 AND samples.period = $2 AND samples.source_id = $3
       ORDER BY samples.source_sequence DESC LIMIT 1`,
      [matchId, period, sourceId],
    );
    const row = result.rows[0];
    return row === undefined
      ? undefined
      : {
          ...mapClock(row),
          ageMs: row.age_ms,
          periodWallElapsedUs: row.period_wall_elapsed_us,
        };
  }

  public async latestMany(
    matchId: string,
    period: Period,
    sourceIds: readonly string[],
  ): Promise<ObservedClockSample[]> {
    if (sourceIds.length === 0) return [];
    const result = await this.pool.query<ClockRowWithAge>(
      `SELECT DISTINCT ON (samples.source_id) samples.*,
              GREATEST(0, EXTRACT(EPOCH FROM (statement_timestamp() - samples.received_at)) * 1000)::double precision AS age_ms,
              GREATEST(0, EXTRACT(EPOCH FROM (statement_timestamp() - periods.started_at)) * 1000000)::bigint AS period_wall_elapsed_us
       FROM match_clock_samples samples
       JOIN periods ON periods.match_id = samples.match_id AND periods.period = samples.period
       WHERE samples.match_id = $1 AND samples.period = $2 AND samples.source_id = ANY($3::text[])
       ORDER BY samples.source_id, samples.source_sequence DESC`,
      [matchId, period, sourceIds],
    );
    return result.rows.map((row) => ({
      ...mapClock(row),
      ageMs: row.age_ms,
      periodWallElapsedUs: row.period_wall_elapsed_us,
    }));
  }

  public async verify(
    client: DbClient,
    matchId: string,
  ): Promise<{ valid: boolean; invalidIndex?: number }> {
    const result = await client.query<ClockRow>(
      'SELECT * FROM match_clock_samples WHERE match_id = $1 ORDER BY sequence',
      [matchId],
    );
    return verifyChain(
      result.rows.map((row) => ({
        previousHash: row.previous_hash,
        hash: row.sample_hash,
        payload: clockRowPayload(row),
      })),
      this.secret,
    );
  }
}

function clockInputPayload(input: AppendClockSampleInput): Record<string, unknown> {
  return {
    matchId: input.matchId,
    period: input.period,
    sourceId: input.sourceId,
    sourceSequence: input.sourceSequence,
    elapsedUs: input.elapsedUs,
    sourceTimestamp: normaliseTimestamp(input.sourceTimestamp),
    evidence: input.evidence,
  };
}

function clockRowPayload(row: ClockRow): Record<string, unknown> {
  return {
    matchId: row.match_id,
    period: row.period,
    sourceId: row.source_id,
    sourceSequence: row.source_sequence,
    elapsedUs: row.elapsed_us,
    sourceTimestamp: row.source_timestamp?.toISOString() ?? null,
    evidence: row.evidence,
  };
}

function mapClock(row: ClockRow): ClockSample {
  return {
    sequence: row.sequence,
    matchId: row.match_id,
    period: row.period,
    sourceId: row.source_id,
    sourceSequence: row.source_sequence,
    elapsedUs: row.elapsed_us,
    ...(row.source_timestamp === null
      ? {}
      : { sourceTimestamp: row.source_timestamp.toISOString() }),
    evidence: row.evidence,
    previousHash: row.previous_hash,
    sampleHash: row.sample_hash,
    receivedAt: row.received_at.toISOString(),
  };
}

function normaliseTimestamp(value: string | undefined): string | null {
  if (value === undefined) return null;
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) throw new ConflictError('Invalid clock source timestamp');
  return timestamp.toISOString();
}
