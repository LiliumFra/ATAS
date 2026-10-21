import type { Database } from '../db/pool.js';
import type { DbClient } from '../db/tx.js';
import { canonicalJson } from '../domain/canonical.js';
import { ConflictError, NotFoundError } from '../domain/errors.js';
import type { Interval, Period, Ruleset } from '../domain/types.js';

export type MatchRecord = {
  id: string;
  competition: string;
  homeTeam: string;
  awayTeam: string;
  rulesetId: string;
  status: 'SCHEDULED' | 'LIVE' | 'FINISHED' | 'ABANDONED';
  clockIntegrityOk: boolean;
  sourceIntegrityOk: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type PeriodRecord = {
  matchId: string;
  period: Period;
  status: 'NOT_STARTED' | 'RUNNING' | 'ENDED';
  nominalDurationUs: number;
  announcedMinutes?: number;
  startedAt?: string;
  endedAt?: string;
};

type PeriodRow = {
  match_id: string;
  period: Period;
  status: PeriodRecord['status'];
  nominal_duration_us: number;
  announced_minutes: number | null;
  started_at: Date | null;
  ended_at: Date | null;
};

const PREVIOUS_PERIOD: Partial<Record<Period, Period>> = {
  SECOND_HALF: 'FIRST_HALF',
  ET_FIRST: 'SECOND_HALF',
  ET_SECOND: 'ET_FIRST',
};

export class MatchRepository {
  public constructor(private readonly pool: Database) {}

  public async create(
    client: DbClient,
    input: {
      matchId: string;
      competition: string;
      homeTeam: string;
      awayTeam: string;
      ruleset: Ruleset;
      metadata: Record<string, unknown>;
    },
  ): Promise<{ match: MatchRecord; created: boolean }> {
    const result = await client.query<Parameters<typeof mapMatch>[0]>(
      `INSERT INTO matches(id, competition, home_team, away_team, ruleset_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       ON CONFLICT (id) DO NOTHING
       RETURNING *`,
      [
        input.matchId,
        input.competition,
        input.homeTeam,
        input.awayTeam,
        input.ruleset.id,
        JSON.stringify(input.metadata),
      ],
    );
    const inserted = result.rows[0];
    if (inserted !== undefined) {
      for (const [period, nominalDurationUs] of Object.entries(input.ruleset.nominalPeriodUs)) {
        await client.query(
          `INSERT INTO periods(match_id, period, nominal_duration_us) VALUES ($1, $2, $3)`,
          [inserted.id, period, nominalDurationUs],
        );
      }
      return { match: mapMatch(inserted), created: true };
    }

    const existingResult = await client.query<Parameters<typeof mapMatch>[0]>(
      'SELECT * FROM matches WHERE id = $1 FOR UPDATE',
      [input.matchId],
    );
    const existingRow = existingResult.rows[0];
    if (existingRow === undefined) throw new Error('Failed to resolve idempotent match creation');
    const existing = mapMatch(existingRow);
    const exactReplay =
      existing.competition === input.competition &&
      existing.homeTeam === input.homeTeam &&
      existing.awayTeam === input.awayTeam &&
      existing.rulesetId === input.ruleset.id &&
      canonicalJson(existing.metadata) === canonicalJson(input.metadata);
    if (!exactReplay) {
      throw new ConflictError('Match ID was already used with different creation content');
    }
    return { match: existing, created: false };
  }

  public async get(id: string): Promise<MatchRecord | undefined> {
    const result = await this.pool.query<Parameters<typeof mapMatch>[0]>(
      'SELECT * FROM matches WHERE id = $1',
      [id],
    );
    return result.rows[0] === undefined ? undefined : mapMatch(result.rows[0]);
  }

  public async listPeriods(matchId: string): Promise<PeriodRecord[]> {
    const result = await this.pool.query<PeriodRow>(
      `SELECT * FROM periods WHERE match_id = $1
       ORDER BY CASE period
         WHEN 'FIRST_HALF' THEN 1
         WHEN 'SECOND_HALF' THEN 2
         WHEN 'ET_FIRST' THEN 3
         WHEN 'ET_SECOND' THEN 4
       END`,
      [matchId],
    );
    return result.rows.map(mapPeriod);
  }

  public async getPeriod(matchId: string, period: Period): Promise<PeriodRecord | undefined> {
    const result = await this.pool.query<PeriodRow>(
      'SELECT * FROM periods WHERE match_id = $1 AND period = $2',
      [matchId, period],
    );
    return result.rows[0] === undefined ? undefined : mapPeriod(result.rows[0]);
  }

  public async setIntegrity(
    client: DbClient,
    matchId: string,
    input: { clockIntegrityOk?: boolean; sourceIntegrityOk?: boolean },
  ): Promise<boolean> {
    const currentResult = await client.query<{
      clock_integrity_ok: boolean;
      source_integrity_ok: boolean;
    }>('SELECT clock_integrity_ok, source_integrity_ok FROM matches WHERE id = $1 FOR UPDATE', [
      matchId,
    ]);
    const current = currentResult.rows[0];
    if (current === undefined) throw new NotFoundError('Match not found');
    const nextClock = input.clockIntegrityOk ?? current.clock_integrity_ok;
    const nextSource = input.sourceIntegrityOk ?? current.source_integrity_ok;
    if (nextClock === current.clock_integrity_ok && nextSource === current.source_integrity_ok) {
      return false;
    }

    await client.query(
      `UPDATE matches SET
         clock_integrity_ok = $2,
         source_integrity_ok = $3,
         updated_at = clock_timestamp(),
         version = version + 1
       WHERE id = $1`,
      [matchId, nextClock, nextSource],
    );
    return true;
  }

  public async setStatus(
    client: DbClient,
    matchId: string,
    status: 'FINISHED' | 'ABANDONED',
  ): Promise<boolean> {
    const result = await client.query<{ status: MatchRecord['status'] }>(
      'SELECT status FROM matches WHERE id = $1 FOR UPDATE',
      [matchId],
    );
    const current = result.rows[0]?.status;
    if (current === undefined) throw new NotFoundError('Match not found');
    if (current === status) return false;

    if (status === 'FINISHED') {
      if (current !== 'LIVE') throw new ConflictError('Only a live match can be finished');
      const periodStates = await client.query<{ period: Period; status: PeriodRecord['status'] }>(
        'SELECT period, status FROM periods WHERE match_id = $1',
        [matchId],
      );
      const states = new Map(periodStates.rows.map((row) => [row.period, row.status]));
      if ([...states.values()].includes('RUNNING')) {
        throw new ConflictError('End the running period before finishing the match');
      }
      if (states.get('SECOND_HALF') !== 'ENDED') {
        throw new ConflictError('The second half must be ended before finishing the match');
      }
      if (states.get('ET_FIRST') !== 'NOT_STARTED' && states.get('ET_SECOND') !== 'ENDED') {
        throw new ConflictError('Both extra-time periods must be ended before finishing the match');
      }
    } else if (current !== 'SCHEDULED' && current !== 'LIVE') {
      throw new ConflictError('A terminal match cannot be abandoned again');
    }

    await client.query(
      `UPDATE matches SET status = $2, updated_at = clock_timestamp(), version = version + 1 WHERE id = $1`,
      [matchId, status],
    );
    return true;
  }

  public async setPeriodStatus(
    client: DbClient,
    matchId: string,
    period: Period,
    status: 'RUNNING' | 'ENDED',
  ): Promise<boolean> {
    const matchResult = await client.query<{ status: MatchRecord['status'] }>(
      'SELECT status FROM matches WHERE id = $1 FOR UPDATE',
      [matchId],
    );
    const matchStatus = matchResult.rows[0]?.status;
    if (matchStatus === undefined) throw new NotFoundError('Match not found');
    if (matchStatus === 'FINISHED' || matchStatus === 'ABANDONED') {
      throw new ConflictError('A terminal match cannot change period state');
    }

    const periodResult = await client.query<{ status: PeriodRecord['status'] }>(
      'SELECT status FROM periods WHERE match_id = $1 AND period = $2 FOR UPDATE',
      [matchId, period],
    );
    const currentStatus = periodResult.rows[0]?.status;
    if (currentStatus === undefined) throw new NotFoundError('Period not found');
    if (currentStatus === status) return false;

    if (status === 'RUNNING') {
      if (currentStatus !== 'NOT_STARTED') {
        throw new ConflictError('Only a not-started period can be started');
      }
      const alreadyRunning = await client.query(
        `SELECT 1 FROM periods WHERE match_id = $1 AND status = 'RUNNING' LIMIT 1`,
        [matchId],
      );
      if (alreadyRunning.rowCount !== 0) {
        throw new ConflictError('Another period is already running');
      }

      const previous = PREVIOUS_PERIOD[period];
      if (previous !== undefined) {
        const previousResult = await client.query<{ status: PeriodRecord['status'] }>(
          'SELECT status FROM periods WHERE match_id = $1 AND period = $2',
          [matchId, previous],
        );
        if (previousResult.rows[0]?.status !== 'ENDED') {
          throw new ConflictError(`Period ${previous} must be ended before ${period} starts`);
        }
      } else if (matchStatus !== 'SCHEDULED') {
        throw new ConflictError('The first half can only start from a scheduled match');
      }

      await client.query(
        `UPDATE periods SET status = 'RUNNING', started_at = clock_timestamp(), version = version + 1
         WHERE match_id = $1 AND period = $2`,
        [matchId, period],
      );
      await client.query(
        `UPDATE matches SET status = 'LIVE', updated_at = clock_timestamp(), version = version + 1 WHERE id = $1`,
        [matchId],
      );
      return true;
    }

    if (currentStatus !== 'RUNNING') {
      throw new ConflictError('Only a running period can be ended');
    }
    const openRecords = await client.query(
      `SELECT 1 FROM (
         SELECT DISTINCT ON (event_id) status, end_us
         FROM match_events
         WHERE match_id = $1 AND period = $2
         ORDER BY event_id, revision DESC
       ) events
       WHERE events.status IN ('CONFIRMED','CORRECTED') AND events.end_us IS NULL
       UNION ALL
       SELECT 1 FROM (
         SELECT DISTINCT ON (stoppage_id) status, end_us
         FROM play_stoppages
         WHERE match_id = $1 AND period = $2
         ORDER BY stoppage_id, revision DESC
       ) stoppages
       WHERE stoppages.status IN ('CONFIRMED','CORRECTED') AND stoppages.end_us IS NULL
       LIMIT 1`,
      [matchId, period],
    );
    if (openRecords.rowCount !== 0) {
      throw new ConflictError(
        'Close all confirmed active events and stoppages before ending the period',
      );
    }
    await client.query(
      `UPDATE periods SET status = 'ENDED', ended_at = clock_timestamp(), version = version + 1
       WHERE match_id = $1 AND period = $2`,
      [matchId, period],
    );
    return true;
  }

  public async announce(
    client: DbClient,
    matchId: string,
    period: Period,
    minutes: number,
  ): Promise<boolean> {
    const result = await client.query<{
      status: PeriodRecord['status'];
      announced_minutes: number | null;
    }>(
      `SELECT status, announced_minutes FROM periods
       WHERE match_id = $1 AND period = $2 FOR UPDATE`,
      [matchId, period],
    );
    const current = result.rows[0];
    if (current === undefined) throw new NotFoundError('Period not found');
    if (current.status !== 'RUNNING') {
      throw new ConflictError('Added time can only be announced for a running period');
    }
    if (current.announced_minutes === minutes) return false;
    if (current.announced_minutes !== null && minutes < current.announced_minutes) {
      throw new ConflictError('Announced added time is a minimum and cannot be reduced');
    }

    await client.query(
      `UPDATE periods SET announced_minutes = $3, version = version + 1
       WHERE match_id = $1 AND period = $2`,
      [matchId, period, minutes],
    );
    return true;
  }

  public async listStoppages(matchId: string, period: Period): Promise<Interval[]> {
    const result = await this.pool.query<{ start_us: number; end_us: number | null }>(
      `SELECT DISTINCT ON (stoppage_id) start_us, end_us
       FROM play_stoppages
       WHERE match_id = $1 AND period = $2
       ORDER BY stoppage_id, revision DESC`,
      [matchId, period],
    );

    return result.rows
      .filter((row): row is { start_us: number; end_us: number } => row.end_us !== null)
      .map((row) => ({ startUs: row.start_us, endUs: row.end_us }));
  }
}

function mapPeriod(row: PeriodRow): PeriodRecord {
  return {
    matchId: row.match_id,
    period: row.period,
    status: row.status,
    nominalDurationUs: row.nominal_duration_us,
    ...(row.announced_minutes === null ? {} : { announcedMinutes: row.announced_minutes }),
    ...(row.started_at === null ? {} : { startedAt: row.started_at.toISOString() }),
    ...(row.ended_at === null ? {} : { endedAt: row.ended_at.toISOString() }),
  };
}

function mapMatch(row: {
  id: string;
  competition: string;
  home_team: string;
  away_team: string;
  ruleset_id: string;
  status: MatchRecord['status'];
  clock_integrity_ok: boolean;
  source_integrity_ok: boolean;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}): MatchRecord {
  return {
    id: row.id,
    competition: row.competition,
    homeTeam: row.home_team,
    awayTeam: row.away_team,
    rulesetId: row.ruleset_id,
    status: row.status,
    clockIntegrityOk: row.clock_integrity_ok,
    sourceIntegrityOk: row.source_integrity_ok,
    metadata: row.metadata,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
