import { createHash } from 'node:crypto';
import type { Database } from '../db/pool.js';
import { canonicalJson } from '../domain/canonical.js';
import type { Ruleset } from '../domain/types.js';

export class RulesetRepository {
  public constructor(private readonly pool: Database) {}

  public async ensure(ruleset: Ruleset): Promise<void> {
    const sha256 = createHash('sha256').update(canonicalJson(ruleset)).digest('hex');
    await this.pool.query(
      `INSERT INTO rulesets(id, version, effective_from, body, sha256)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       ON CONFLICT (id) DO NOTHING`,
      [ruleset.id, ruleset.version, ruleset.effectiveFrom, JSON.stringify(ruleset), sha256],
    );

    const stored = await this.pool.query<{ sha256: string; version: string }>(
      'SELECT sha256, version FROM rulesets WHERE id = $1',
      [ruleset.id],
    );
    const row = stored.rows[0];
    if (row === undefined) throw new Error('Ruleset persistence failed');
    if (row.sha256 !== sha256 || row.version !== ruleset.version) {
      throw new Error(
        `Ruleset ${ruleset.id} is immutable and its stored digest/version does not match the file`,
      );
    }
  }

  public async get(id: string): Promise<Ruleset | undefined> {
    const result = await this.pool.query<{ body: Ruleset }>(
      'SELECT body FROM rulesets WHERE id = $1',
      [id],
    );
    return result.rows[0]?.body;
  }
}
