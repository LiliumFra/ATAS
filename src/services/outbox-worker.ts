import type { FastifyBaseLogger } from 'fastify';
import type { Database } from '../db/pool.js';
import { withTransaction } from '../db/tx.js';

export class OutboxWorker {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private lastSuccessAtMs = 0;
  private lastErrorAtMs = 0;
  private lastCleanupAtMs = 0;
  private deletedRows = 0;

  public constructor(
    private readonly pool: Database,
    private readonly logger: FastifyBaseLogger,
    private readonly retentionDays: number,
    private readonly cleanupIntervalMs: number,
    private readonly cleanupBatchSize: number,
  ) {}

  public async start(): Promise<void> {
    if (this.timer !== undefined) return;
    await this.tick();
    this.timer = setInterval(() => void this.tick(), 250);
    this.timer.unref();
  }

  public async stop(): Promise<void> {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    while (this.running) await new Promise((resolve) => setTimeout(resolve, 10));
  }

  public health(maxStaleMs = 5_000): {
    ready: boolean;
    running: boolean;
    lastSuccessAt?: string;
    lastErrorAt?: string;
    lastCleanupAt?: string;
    deletedRows: number;
  } {
    const ready = this.lastSuccessAtMs > 0 && Date.now() - this.lastSuccessAtMs <= maxStaleMs;
    return {
      ready,
      running: this.running,
      ...(this.lastSuccessAtMs === 0
        ? {}
        : { lastSuccessAt: new Date(this.lastSuccessAtMs).toISOString() }),
      ...(this.lastErrorAtMs === 0
        ? {}
        : { lastErrorAt: new Date(this.lastErrorAtMs).toISOString() }),
      ...(this.lastCleanupAtMs === 0
        ? {}
        : { lastCleanupAt: new Date(this.lastCleanupAtMs).toISOString() }),
      deletedRows: this.deletedRows,
    };
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await withTransaction(this.pool, async (client) => {
        const result = await client.query<{
          id: number;
          topic: string;
          aggregate_id: string | null;
          payload: Record<string, unknown>;
          created_at: Date;
        }>(
          `SELECT id, topic, aggregate_id, payload, created_at
           FROM outbox WHERE published_at IS NULL
           ORDER BY id LIMIT 100 FOR UPDATE SKIP LOCKED`,
        );

        for (const message of result.rows) {
          const fullNotification = {
            changeId: message.id,
            type: message.topic,
            matchId: message.aggregate_id,
            payload: message.payload,
            createdAt: message.created_at.toISOString(),
          };
          let notification = JSON.stringify(fullNotification);
          if (Buffer.byteLength(notification, 'utf8') > 7_500) {
            // NOTIFY is only a wake-up signal. The durable /changes endpoint remains the source
            // of truth, so an oversized payload is safely replaced by a compact cursor message.
            notification = JSON.stringify({
              changeId: message.id,
              type: message.topic,
              matchId: message.aggregate_id,
              payloadOmitted: true,
              createdAt: message.created_at.toISOString(),
            });
          }
          await client.query('SELECT pg_notify($1, $2)', ['atas_realtime', notification]);
        }

        if (result.rows.length > 0) {
          await client.query(
            `UPDATE outbox SET published_at = now() WHERE id = ANY($1::bigint[])`,
            [result.rows.map((row) => row.id)],
          );
        }
      });

      const now = Date.now();
      if (now - this.lastCleanupAtMs >= this.cleanupIntervalMs) {
        this.deletedRows += await this.cleanupPublishedChanges();
        this.lastCleanupAtMs = now;
      }
      this.lastSuccessAtMs = Date.now();
    } catch (error) {
      this.lastErrorAtMs = Date.now();
      this.logger.error({ err: error }, 'Outbox polling failed');
    } finally {
      this.running = false;
    }
  }

  private async cleanupPublishedChanges(): Promise<number> {
    return withTransaction(this.pool, async (client) => {
      const lockResult = await client.query<{ acquired: boolean }>(
        `SELECT pg_try_advisory_xact_lock(hashtextextended('atas:outbox-cleanup', 0)) AS acquired`,
      );
      if (lockResult.rows[0]?.acquired !== true) return 0;

      const result = await client.query<{ deleted_count: number; affected_matches: number }>(
        `WITH candidates AS (
           SELECT id
           FROM outbox
           WHERE published_at IS NOT NULL
             AND published_at < now() - make_interval(days => $1)
           ORDER BY id
           LIMIT $2
           FOR UPDATE SKIP LOCKED
         ), deleted AS (
           DELETE FROM outbox target
           USING candidates
           WHERE target.id = candidates.id
           RETURNING target.aggregate_id, target.id
         ), watermarks AS (
           SELECT aggregate_id, max(id)::bigint AS through_id
           FROM deleted
           WHERE aggregate_id IS NOT NULL
           GROUP BY aggregate_id
         ), upserted AS (
           INSERT INTO outbox_retention_watermarks(aggregate_id, through_id, updated_at)
           SELECT aggregate_id, through_id, now() FROM watermarks
           ON CONFLICT (aggregate_id) DO UPDATE
             SET through_id = GREATEST(outbox_retention_watermarks.through_id, EXCLUDED.through_id),
                 updated_at = now()
           RETURNING aggregate_id
         )
         SELECT
           (SELECT count(*)::bigint FROM deleted) AS deleted_count,
           (SELECT count(*)::bigint FROM upserted) AS affected_matches`,
        [this.retentionDays, this.cleanupBatchSize],
      );
      const summary = result.rows[0] ?? { deleted_count: 0, affected_matches: 0 };
      if (summary.deleted_count > 0) {
        this.logger.info(
          {
            deletedRows: summary.deleted_count,
            affectedMatches: summary.affected_matches,
            retentionDays: this.retentionDays,
            batchSize: this.cleanupBatchSize,
          },
          'Expired published realtime changes',
        );
      }
      return summary.deleted_count;
    });
  }
}
