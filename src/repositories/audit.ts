import type { DbClient } from '../db/tx.js';
import { chainHash, GENESIS_HASH, verifyChain } from '../domain/hash.js';

export type AuditRecord = {
  sequence: number;
  matchId?: string;
  actor: string;
  action: string;
  payload: Record<string, unknown>;
  previousHash: string;
  auditHash: string;
  createdAt: string;
};

export class AuditRepository {
  public constructor(private readonly secret: string) {}

  public async append(
    client: DbClient,
    input: {
      matchId?: string;
      actor: string;
      action: string;
      payload: Record<string, unknown>;
    },
  ): Promise<AuditRecord> {
    const previous = await client.query<{ audit_hash: string }>(
      `SELECT audit_hash FROM audit_log
       WHERE match_id IS NOT DISTINCT FROM $1::uuid
       ORDER BY sequence DESC LIMIT 1 FOR UPDATE`,
      [input.matchId ?? null],
    );
    const previousHash = previous.rows[0]?.audit_hash ?? GENESIS_HASH;
    const hashPayload = {
      matchId: input.matchId ?? null,
      actor: input.actor,
      action: input.action,
      payload: input.payload,
    };
    const auditHash = chainHash(previousHash, hashPayload, this.secret);

    const inserted = await client.query<{
      sequence: number;
      match_id: string | null;
      actor: string;
      action: string;
      payload: Record<string, unknown>;
      previous_hash: string;
      audit_hash: string;
      created_at: Date;
    }>(
      `INSERT INTO audit_log(match_id, actor, action, payload, previous_hash, audit_hash)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6)
       RETURNING *`,
      [
        input.matchId ?? null,
        input.actor,
        input.action,
        JSON.stringify(input.payload),
        previousHash,
        auditHash,
      ],
    );

    const row = inserted.rows[0];
    if (row === undefined) throw new Error('Failed to append audit record');
    return {
      sequence: row.sequence,
      ...(row.match_id === null ? {} : { matchId: row.match_id }),
      actor: row.actor,
      action: row.action,
      payload: row.payload,
      previousHash: row.previous_hash,
      auditHash: row.audit_hash,
      createdAt: row.created_at.toISOString(),
    };
  }

  public async verify(
    client: DbClient,
    matchId: string,
  ): Promise<{ valid: boolean; invalidIndex?: number }> {
    const result = await client.query<{
      match_id: string | null;
      actor: string;
      action: string;
      payload: Record<string, unknown>;
      previous_hash: string;
      audit_hash: string;
    }>(
      `SELECT match_id, actor, action, payload, previous_hash, audit_hash
       FROM audit_log WHERE match_id = $1 ORDER BY sequence`,
      [matchId],
    );

    return verifyChain(
      result.rows.map((row) => ({
        previousHash: row.previous_hash,
        hash: row.audit_hash,
        payload: {
          matchId: row.match_id,
          actor: row.actor,
          action: row.action,
          payload: row.payload,
        },
      })),
      this.secret,
    );
  }
}
