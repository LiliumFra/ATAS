import type { Database } from '../db/pool.js';
import type { DbClient } from '../db/tx.js';
import { canonicalJson } from '../domain/canonical.js';
import { ConflictError, NotFoundError, ValidationError } from '../domain/errors.js';
import { chainHash, GENESIS_HASH, verifyChain } from '../domain/hash.js';
import type { EventSource, EventStatus, Period } from '../domain/types.js';

export type StoppageRecord = {
  recordId: string;
  sequence: number;
  stoppageId: string;
  matchId: string;
  period: Period;
  revision: number;
  status: EventStatus;
  startUs: number;
  endUs?: number;
  source: EventSource;
  createdBy: string;
  evidence: Record<string, unknown>;
  supersedesRecordId?: string;
  previousHash: string;
  recordHash: string;
  createdAt: string;
};

export type AppendStoppageInput = {
  stoppageId: string;
  matchId: string;
  period: Period;
  startUs: number;
  endUs?: number;
  source: EventSource;
  status: EventStatus;
  createdBy: string;
  evidence: Record<string, unknown>;
};

export type AppendStoppageResult = { stoppage: StoppageRecord; created: boolean };

export type CloseStoppageInput = {
  matchId: string;
  stoppageId: string;
  endUs: number;
  status: 'CONFIRMED' | 'CORRECTED';
  actor: string;
};

export type CloseStoppageResult = { stoppage: StoppageRecord; created: boolean };

type StoppageRow = {
  record_id: string;
  sequence: number;
  stoppage_id: string;
  match_id: string;
  period: Period;
  revision: number;
  status: EventStatus;
  start_us: number;
  end_us: number | null;
  source: EventSource;
  created_by: string;
  evidence: Record<string, unknown>;
  supersedes_record_id: string | null;
  previous_hash: string;
  record_hash: string;
  created_at: Date;
};

export class StoppageRepository {
  public constructor(
    private readonly pool: Database,
    private readonly secret: string,
  ) {}

  public async append(client: DbClient, input: AppendStoppageInput): Promise<AppendStoppageResult> {
    const existingResult = await client.query<StoppageRow>(
      `SELECT * FROM play_stoppages
       WHERE match_id = $1 AND stoppage_id = $2
       ORDER BY revision ASC FOR UPDATE`,
      [input.matchId, input.stoppageId],
    );
    const first = existingResult.rows[0];
    if (first !== undefined) {
      const expected = stoppagePayload({ revision: 1, ...input });
      const actual = stoppagePayload({
        stoppageId: first.stoppage_id,
        matchId: first.match_id,
        period: first.period,
        revision: first.revision,
        status: first.status,
        startUs: first.start_us,
        ...(first.end_us === null ? {} : { endUs: first.end_us }),
        source: first.source,
        createdBy: first.created_by,
        evidence: first.evidence,
      });
      if (canonicalJson(expected) !== canonicalJson(actual)) {
        throw new ConflictError('stoppageId was already used with different stoppage content');
      }
      const latest = existingResult.rows.at(-1);
      if (latest === undefined) throw new Error('Existing stoppage revision could not be loaded');
      return { stoppage: mapStoppage(latest), created: false };
    }

    const previousHash = await this.lastHash(client, input.matchId);
    const payload = stoppagePayload({ revision: 1, ...input });
    const recordHash = chainHash(previousHash, payload, this.secret);

    const result = await client.query<StoppageRow>(
      `INSERT INTO play_stoppages(
        stoppage_id, match_id, period, revision, status, start_us, end_us,
        source, created_by, evidence, previous_hash, record_hash
      ) VALUES ($1,$2,$3,1,$4,$5,$6,$7,$8,$9::jsonb,$10,$11) RETURNING *`,
      [
        input.stoppageId,
        input.matchId,
        input.period,
        input.status,
        input.startUs,
        input.endUs ?? null,
        input.source,
        input.createdBy,
        JSON.stringify(input.evidence),
        previousHash,
        recordHash,
      ],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('Failed to append stoppage');
    await appendOutbox(client, input.matchId, input.stoppageId, 1);
    return { stoppage: mapStoppage(row), created: true };
  }

  public async close(client: DbClient, input: CloseStoppageInput): Promise<CloseStoppageResult> {
    const latest = await client.query<StoppageRow>(
      `SELECT * FROM play_stoppages
       WHERE match_id = $1 AND stoppage_id = $2
       ORDER BY revision DESC LIMIT 1 FOR UPDATE`,
      [input.matchId, input.stoppageId],
    );
    const current = latest.rows[0];
    if (current === undefined) throw new NotFoundError('Stoppage not found');
    if (input.endUs <= current.start_us) {
      throw new ValidationError('endUs must be greater than startUs');
    }

    if (current.end_us === input.endUs && current.status === input.status) {
      return { stoppage: mapStoppage(current), created: false };
    }
    if (current.end_us !== null && input.status !== 'CORRECTED') {
      throw new ConflictError('Changing a closed stoppage requires status CORRECTED');
    }

    const previousHash = await this.lastHash(client, input.matchId);
    const revision = current.revision + 1;
    const payload = stoppagePayload({
      stoppageId: current.stoppage_id,
      matchId: current.match_id,
      period: current.period,
      revision,
      status: input.status,
      startUs: current.start_us,
      endUs: input.endUs,
      source: current.source,
      createdBy: input.actor,
      evidence: current.evidence,
      supersedesRecordId: current.record_id,
    });
    const recordHash = chainHash(previousHash, payload, this.secret);

    const result = await client.query<StoppageRow>(
      `INSERT INTO play_stoppages(
        stoppage_id, match_id, period, revision, status, start_us, end_us,
        source, created_by, evidence, supersedes_record_id, previous_hash, record_hash
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13) RETURNING *`,
      [
        current.stoppage_id,
        current.match_id,
        current.period,
        revision,
        input.status,
        current.start_us,
        input.endUs,
        current.source,
        input.actor,
        JSON.stringify(current.evidence),
        current.record_id,
        previousHash,
        recordHash,
      ],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('Failed to close stoppage');
    await appendOutbox(client, input.matchId, input.stoppageId, revision);
    return { stoppage: mapStoppage(row), created: true };
  }

  public async listLatest(matchId: string, period: Period): Promise<StoppageRecord[]> {
    const result = await this.pool.query<StoppageRow>(
      `SELECT DISTINCT ON (stoppage_id) * FROM play_stoppages
       WHERE match_id = $1 AND period = $2
       ORDER BY stoppage_id, revision DESC`,
      [matchId, period],
    );
    return result.rows.map(mapStoppage).sort((left, right) => left.startUs - right.startUs);
  }

  public async verify(
    client: DbClient,
    matchId: string,
  ): Promise<{ valid: boolean; invalidIndex?: number }> {
    const result = await client.query<StoppageRow>(
      `SELECT * FROM play_stoppages WHERE match_id = $1 ORDER BY sequence`,
      [matchId],
    );

    return verifyChain(
      result.rows.map((row) => {
        const stoppage = mapStoppage(row);
        return {
          previousHash: stoppage.previousHash,
          hash: stoppage.recordHash,
          payload: stoppagePayload({
            stoppageId: stoppage.stoppageId,
            matchId: stoppage.matchId,
            period: stoppage.period,
            revision: stoppage.revision,
            status: stoppage.status,
            startUs: stoppage.startUs,
            ...(stoppage.endUs === undefined ? {} : { endUs: stoppage.endUs }),
            source: stoppage.source,
            createdBy: stoppage.createdBy,
            evidence: stoppage.evidence,
            ...(stoppage.supersedesRecordId === undefined
              ? {}
              : { supersedesRecordId: stoppage.supersedesRecordId }),
          }),
        };
      }),
      this.secret,
    );
  }

  private async lastHash(client: DbClient, matchId: string): Promise<string> {
    const previous = await client.query<{ record_hash: string }>(
      `SELECT record_hash FROM play_stoppages WHERE match_id = $1
       ORDER BY sequence DESC LIMIT 1 FOR UPDATE`,
      [matchId],
    );
    return previous.rows[0]?.record_hash ?? GENESIS_HASH;
  }
}

function stoppagePayload(input: {
  stoppageId: string;
  matchId: string;
  period: Period;
  revision: number;
  status: EventStatus;
  startUs: number;
  endUs?: number;
  source: EventSource;
  createdBy: string;
  evidence: Record<string, unknown>;
  supersedesRecordId?: string;
}): Record<string, unknown> {
  return {
    stoppageId: input.stoppageId,
    matchId: input.matchId,
    period: input.period,
    revision: input.revision,
    status: input.status,
    startUs: input.startUs,
    ...(input.endUs === undefined ? {} : { endUs: input.endUs }),
    source: input.source,
    createdBy: input.createdBy,
    evidence: input.evidence,
    ...(input.supersedesRecordId === undefined
      ? {}
      : { supersedesRecordId: input.supersedesRecordId }),
  };
}

function mapStoppage(row: StoppageRow): StoppageRecord {
  return {
    recordId: row.record_id,
    sequence: row.sequence,
    stoppageId: row.stoppage_id,
    matchId: row.match_id,
    period: row.period,
    revision: row.revision,
    status: row.status,
    startUs: row.start_us,
    ...(row.end_us === null ? {} : { endUs: row.end_us }),
    source: row.source,
    createdBy: row.created_by,
    evidence: row.evidence,
    ...(row.supersedes_record_id === null ? {} : { supersedesRecordId: row.supersedes_record_id }),
    previousHash: row.previous_hash,
    recordHash: row.record_hash,
    createdAt: row.created_at.toISOString(),
  };
}

async function appendOutbox(
  client: DbClient,
  matchId: string,
  stoppageId: string,
  revision: number,
): Promise<void> {
  await client.query(
    `INSERT INTO outbox(topic, aggregate_id, payload)
     VALUES ('match.stoppage.changed', $1, $2::jsonb)`,
    [matchId, JSON.stringify({ stoppageId, revision })],
  );
}
