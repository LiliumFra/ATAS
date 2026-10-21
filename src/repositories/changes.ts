import type { Database } from '../db/pool.js';

export type ChangeRecord = {
  id: number;
  type: string;
  matchId: string;
  payload: Record<string, unknown>;
  createdAt: string;
  publishedAt?: string;
};

type ChangeRow = {
  id: number;
  topic: string;
  aggregate_id: string;
  payload: Record<string, unknown>;
  created_at: Date;
  published_at: Date | null;
};

export type ChangeCursorState = {
  latestId: number;
  retainedAfterId: number;
};

export class ChangeRepository {
  public constructor(private readonly pool: Database) {}

  public async list(matchId: string, afterId: number, limit: number): Promise<ChangeRecord[]> {
    const result = await this.pool.query<ChangeRow>(
      `SELECT id, topic, aggregate_id, payload, created_at, published_at
       FROM outbox
       WHERE aggregate_id = $1 AND id > $2
       ORDER BY id
       LIMIT $3`,
      [matchId, afterId, limit],
    );
    return result.rows.map(mapChange);
  }

  public async cursorState(matchId: string): Promise<ChangeCursorState> {
    const result = await this.pool.query<{
      latest_id: number | null;
      retained_after_id: number | null;
    }>(
      `SELECT
         (SELECT max(id) FROM outbox WHERE aggregate_id = $1) AS latest_id,
         (SELECT through_id FROM outbox_retention_watermarks WHERE aggregate_id = $1) AS retained_after_id`,
      [matchId],
    );
    const latestId = result.rows[0]?.latest_id ?? 0;
    const retainedAfterId = result.rows[0]?.retained_after_id ?? 0;
    return {
      latestId: Math.max(latestId, retainedAfterId),
      retainedAfterId,
    };
  }

  public async latestId(matchId: string): Promise<number> {
    return (await this.cursorState(matchId)).latestId;
  }
}

function mapChange(row: ChangeRow): ChangeRecord {
  return {
    id: row.id,
    type: row.topic,
    matchId: row.aggregate_id,
    payload: row.payload,
    createdAt: row.created_at.toISOString(),
    ...(row.published_at === null ? {} : { publishedAt: row.published_at.toISOString() }),
  };
}
