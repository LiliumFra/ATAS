import type { Database } from '../db/pool.js';
import type { DbClient } from '../db/tx.js';
import { canonicalJson } from '../domain/canonical.js';
import { ConflictError, ValidationError, NotFoundError } from '../domain/errors.js';
import { chainHash, GENESIS_HASH, verifyChain } from '../domain/hash.js';
import type { EventKind, EventSource, EventStatus, MatchEvent, Period } from '../domain/types.js';

export type CreateEventInput = {
  eventId: string;
  matchId: string;
  period: Period;
  kind: EventKind;
  source: EventSource;
  status: EventStatus;
  startUs: number;
  endUs?: number;
  confidence: number;
  evidence: Record<string, unknown>;
  createdBy: string;
};

export type AppendEventResult = { event: MatchEvent; created: boolean };
export type ReviseEventResult = { event: MatchEvent; created: boolean };

export type ReviseEventInput = {
  matchId: string;
  eventId: string;
  status: 'CONFIRMED' | 'REJECTED' | 'CORRECTED';
  actor: string;
  corrections?: Partial<
    Pick<CreateEventInput, 'kind' | 'source' | 'startUs' | 'endUs' | 'confidence' | 'evidence'>
  >;
};

type EventRow = {
  record_id: string;
  sequence: number;
  event_id: string;
  match_id: string;
  period: Period;
  revision: number;
  kind: EventKind;
  source: EventSource;
  status: EventStatus;
  start_us: number;
  end_us: number | null;
  confidence: number;
  evidence: Record<string, unknown>;
  created_by: string;
  supersedes_record_id: string | null;
  previous_hash: string;
  event_hash: string;
  created_at: Date;
};

export class EventRepository {
  public constructor(
    private readonly pool: Database,
    private readonly secret: string,
  ) {}

  public async append(client: DbClient, input: CreateEventInput): Promise<AppendEventResult> {
    const eventId = input.eventId;

    {
      const existingResult = await client.query<EventRow>(
        `SELECT * FROM match_events WHERE match_id = $1 AND event_id = $2
         ORDER BY revision ASC FOR UPDATE`,
        [input.matchId, eventId],
      );
      const first = existingResult.rows[0];
      if (first !== undefined) {
        const expected = eventPayload({
          ...input,
          eventId,
          revision: 1,
          supersedesRecordId: undefined,
        });
        const actual = eventPayload({
          eventId: first.event_id,
          matchId: first.match_id,
          period: first.period,
          revision: first.revision,
          kind: first.kind,
          source: first.source,
          status: first.status,
          startUs: first.start_us,
          ...(first.end_us === null ? {} : { endUs: first.end_us }),
          confidence: first.confidence,
          evidence: first.evidence,
          createdBy: first.created_by,
        });
        if (canonicalJson(expected) !== canonicalJson(actual)) {
          throw new ConflictError('eventId was already used with different event content');
        }
        const latest = existingResult.rows.at(-1);
        if (latest === undefined) throw new Error('Existing event revision could not be loaded');
        return { event: mapEvent(latest), created: false };
      }
    }

    const previousResult = await client.query<{ event_hash: string }>(
      `SELECT event_hash FROM match_events
       WHERE match_id = $1 ORDER BY sequence DESC LIMIT 1 FOR UPDATE`,
      [input.matchId],
    );
    const previousHash = previousResult.rows[0]?.event_hash ?? GENESIS_HASH;
    const payload = eventPayload({ ...input, eventId, revision: 1, supersedesRecordId: undefined });
    const eventHash = chainHash(previousHash, payload, this.secret);

    const inserted = await client.query<EventRow>(
      `INSERT INTO match_events(
        event_id, match_id, period, revision, kind, source, status,
        start_us, end_us, confidence, evidence, created_by,
        previous_hash, event_hash
      ) VALUES ($1,$2,$3,1,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13)
      RETURNING *`,
      [
        eventId,
        input.matchId,
        input.period,
        input.kind,
        input.source,
        input.status,
        input.startUs,
        input.endUs ?? null,
        input.confidence,
        JSON.stringify(input.evidence),
        input.createdBy,
        previousHash,
        eventHash,
      ],
    );
    const row = inserted.rows[0];
    if (row === undefined) throw new Error('Failed to append event');
    await appendOutbox(client, 'match.event.changed', input.matchId, { eventId, revision: 1 });
    return { event: mapEvent(row), created: true };
  }

  public async revise(client: DbClient, input: ReviseEventInput): Promise<ReviseEventResult> {
    const latest = await client.query<EventRow>(
      `SELECT * FROM match_events WHERE match_id = $1 AND event_id = $2
       ORDER BY revision DESC LIMIT 1 FOR UPDATE`,
      [input.matchId, input.eventId],
    );
    const current = latest.rows[0];
    if (current === undefined) throw new NotFoundError('Event not found');

    const previousResult = await client.query<{ event_hash: string }>(
      `SELECT event_hash FROM match_events
       WHERE match_id = $1 ORDER BY sequence DESC LIMIT 1 FOR UPDATE`,
      [input.matchId],
    );
    const previousHash = previousResult.rows[0]?.event_hash ?? GENESIS_HASH;
    const revision = current.revision + 1;
    const corrections = input.corrections ?? {};
    const nextStartUs = corrections.startUs ?? current.start_us;
    const nextEndUs = corrections.endUs ?? current.end_us ?? undefined;
    if (nextEndUs !== undefined && nextEndUs <= nextStartUs) {
      throw new ValidationError('endUs must be greater than startUs');
    }

    const nextKind = corrections.kind ?? current.kind;
    const nextSource = corrections.source ?? current.source;
    const nextConfidence = corrections.confidence ?? current.confidence;
    const nextEvidence = corrections.evidence ?? current.evidence;

    const alreadyApplied =
      current.status === input.status &&
      current.kind === nextKind &&
      current.source === nextSource &&
      current.start_us === nextStartUs &&
      (current.end_us ?? undefined) === nextEndUs &&
      current.confidence === nextConfidence &&
      canonicalJson(current.evidence) === canonicalJson(nextEvidence);
    if (alreadyApplied) return { event: mapEvent(current), created: false };

    const eventData = {
      eventId: current.event_id,
      matchId: current.match_id,
      period: current.period,
      revision,
      kind: nextKind,
      source: nextSource,
      status: input.status,
      startUs: nextStartUs,
      ...(nextEndUs === undefined ? {} : { endUs: nextEndUs }),
      confidence: nextConfidence,
      evidence: nextEvidence,
      createdBy: input.actor,
      supersedesRecordId: current.record_id,
    };
    const eventHash = chainHash(previousHash, eventPayload(eventData), this.secret);

    const inserted = await client.query<EventRow>(
      `INSERT INTO match_events(
        event_id, match_id, period, revision, kind, source, status,
        start_us, end_us, confidence, evidence, created_by,
        supersedes_record_id, previous_hash, event_hash
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15)
      RETURNING *`,
      [
        eventData.eventId,
        eventData.matchId,
        eventData.period,
        eventData.revision,
        eventData.kind,
        eventData.source,
        eventData.status,
        eventData.startUs,
        eventData.endUs ?? null,
        eventData.confidence,
        JSON.stringify(eventData.evidence),
        eventData.createdBy,
        eventData.supersedesRecordId,
        previousHash,
        eventHash,
      ],
    );
    const row = inserted.rows[0];
    if (row === undefined) throw new Error('Failed to revise event');
    await appendOutbox(client, 'match.event.changed', input.matchId, {
      eventId: input.eventId,
      revision,
    });
    return { event: mapEvent(row), created: true };
  }

  public async listLatest(matchId: string, period?: Period): Promise<MatchEvent[]> {
    const values: unknown[] = [matchId];
    const periodClause = period === undefined ? '' : 'AND period = $2';
    if (period !== undefined) values.push(period);

    const result = await this.pool.query<EventRow>(
      `SELECT DISTINCT ON (event_id) * FROM match_events
       WHERE match_id = $1 ${periodClause}
       ORDER BY event_id, revision DESC`,
      values,
    );
    return result.rows.map(mapEvent).sort((left, right) => left.startUs - right.startUs);
  }

  public async verify(
    client: DbClient,
    matchId: string,
  ): Promise<{ valid: boolean; invalidIndex?: number }> {
    const result = await client.query<EventRow>(
      `SELECT * FROM match_events WHERE match_id = $1 ORDER BY sequence`,
      [matchId],
    );

    return verifyChain(
      result.rows.map((row) => {
        const event = mapEvent(row);
        return {
          previousHash: event.previousHash,
          hash: event.eventHash,
          payload: eventPayload({
            eventId: event.eventId,
            matchId: event.matchId,
            period: event.period,
            revision: event.revision,
            kind: event.kind,
            source: event.source,
            status: event.status,
            startUs: event.startUs,
            ...(event.endUs === undefined ? {} : { endUs: event.endUs }),
            confidence: event.confidence,
            evidence: event.evidence,
            createdBy: event.createdBy,
            ...(event.supersedesRecordId === undefined
              ? {}
              : { supersedesRecordId: event.supersedesRecordId }),
          }),
        };
      }),
      this.secret,
    );
  }
}

function eventPayload(input: {
  eventId: string;
  matchId: string;
  period: Period;
  revision: number;
  kind: EventKind;
  source: EventSource;
  status: EventStatus;
  startUs: number;
  endUs?: number;
  confidence: number;
  evidence: Record<string, unknown>;
  createdBy: string;
  supersedesRecordId?: string;
}): Record<string, unknown> {
  return {
    eventId: input.eventId,
    matchId: input.matchId,
    period: input.period,
    revision: input.revision,
    kind: input.kind,
    source: input.source,
    status: input.status,
    startUs: input.startUs,
    ...(input.endUs === undefined ? {} : { endUs: input.endUs }),
    confidence: input.confidence,
    evidence: input.evidence,
    createdBy: input.createdBy,
    ...(input.supersedesRecordId === undefined
      ? {}
      : { supersedesRecordId: input.supersedesRecordId }),
  };
}

function mapEvent(row: EventRow): MatchEvent {
  return {
    recordId: row.record_id,
    sequence: row.sequence,
    eventId: row.event_id,
    matchId: row.match_id,
    period: row.period,
    revision: row.revision,
    kind: row.kind,
    source: row.source,
    status: row.status,
    startUs: row.start_us,
    ...(row.end_us === null ? {} : { endUs: row.end_us }),
    confidence: row.confidence,
    evidence: row.evidence,
    createdBy: row.created_by,
    ...(row.supersedes_record_id === null ? {} : { supersedesRecordId: row.supersedes_record_id }),
    previousHash: row.previous_hash,
    eventHash: row.event_hash,
    createdAt: row.created_at.toISOString(),
  };
}

async function appendOutbox(
  client: DbClient,
  topic: string,
  aggregateId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `INSERT INTO outbox(topic, aggregate_id, payload) VALUES ($1, $2, $3::jsonb)`,
    [topic, aggregateId, JSON.stringify(payload)],
  );
}
