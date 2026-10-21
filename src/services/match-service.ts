import type { Database } from '../db/pool.js';
import { ValidationError } from '../domain/errors.js';
import { assertBoundedJsonObject } from '../domain/json-limits.js';
import { lockMatch, withTransaction } from '../db/tx.js';
import type { Period, Ruleset } from '../domain/types.js';
import type { AuditRepository } from '../repositories/audit.js';
import type { MatchRepository } from '../repositories/matches.js';
import type { RulesetRepository } from '../repositories/rulesets.js';

export class MatchService {
  public constructor(
    private readonly pool: Database,
    private readonly matches: MatchRepository,
    private readonly rulesets: RulesetRepository,
    private readonly audit: AuditRepository,
    private readonly defaultRuleset: Ruleset,
  ) {}

  public async initialise(): Promise<void> {
    await this.rulesets.ensure(this.defaultRuleset);
  }

  public async create(input: {
    matchId: string;
    competition: string;
    homeTeam: string;
    awayTeam: string;
    metadata: Record<string, unknown>;
    actor: string;
  }) {
    assertBoundedJsonObject(input.metadata, 'metadata');
    if (input.homeTeam.trim().toLocaleLowerCase() === input.awayTeam.trim().toLocaleLowerCase()) {
      throw new ValidationError('Home and away teams must be different');
    }
    return withTransaction(this.pool, async (client) => {
      const result = await this.matches.create(client, {
        matchId: input.matchId,
        competition: input.competition.trim(),
        homeTeam: input.homeTeam.trim(),
        awayTeam: input.awayTeam.trim(),
        ruleset: this.defaultRuleset,
        metadata: input.metadata,
      });
      if (result.created) {
        await this.audit.append(client, {
          matchId: result.match.id,
          actor: input.actor,
          action: 'MATCH_CREATED',
          payload: {
            competition: result.match.competition,
            homeTeam: result.match.homeTeam,
            awayTeam: result.match.awayTeam,
          },
        });
        await client.query(
          `INSERT INTO outbox(topic, aggregate_id, payload) VALUES ('match.created', $1, $2::jsonb)`,
          [result.match.id, JSON.stringify({ matchId: result.match.id })],
        );
      }
      return result;
    });
  }

  public async updateIntegrity(
    matchId: string,
    input: { clockIntegrityOk?: boolean; sourceIntegrityOk?: boolean; reason: string },
    actor: string,
  ) {
    return withTransaction(this.pool, async (client) => {
      await lockMatch(client, matchId);
      const changed = await this.matches.setIntegrity(client, matchId, input);
      if (changed) {
        await this.audit.append(client, {
          matchId,
          actor,
          action: 'MATCH_INTEGRITY_UPDATED',
          payload: input,
        });
        await client.query(
          `INSERT INTO outbox(topic, aggregate_id, payload)
           VALUES ('match.integrity.changed', $1, $2::jsonb)`,
          [matchId, JSON.stringify(input)],
        );
      }
    });
  }

  public async updateStatus(
    matchId: string,
    status: 'FINISHED' | 'ABANDONED',
    reason: string,
    actor: string,
  ) {
    return withTransaction(this.pool, async (client) => {
      await lockMatch(client, matchId);
      const changed = await this.matches.setStatus(client, matchId, status);
      if (changed) {
        await this.audit.append(client, {
          matchId,
          actor,
          action: 'MATCH_STATUS_UPDATED',
          payload: { status, reason },
        });
        await client.query(
          `INSERT INTO outbox(topic, aggregate_id, payload)
           VALUES ('match.status.changed', $1, $2::jsonb)`,
          [matchId, JSON.stringify({ status, reason })],
        );
      }
    });
  }

  public async transitionPeriod(
    matchId: string,
    period: Period,
    status: 'RUNNING' | 'ENDED',
    actor: string,
  ) {
    return withTransaction(this.pool, async (client) => {
      await lockMatch(client, matchId);
      const changed = await this.matches.setPeriodStatus(client, matchId, period, status);
      if (changed) {
        await this.audit.append(client, {
          matchId,
          actor,
          action: status === 'RUNNING' ? 'PERIOD_STARTED' : 'PERIOD_ENDED',
          payload: { period },
        });
        await client.query(
          `INSERT INTO outbox(topic, aggregate_id, payload) VALUES ('match.period.changed', $1, $2::jsonb)`,
          [matchId, JSON.stringify({ period, status })],
        );
      }
    });
  }

  public async announce(matchId: string, period: Period, minutes: number, actor: string) {
    return withTransaction(this.pool, async (client) => {
      await lockMatch(client, matchId);
      const changed = await this.matches.announce(client, matchId, period, minutes);
      if (changed) {
        await this.audit.append(client, {
          matchId,
          actor,
          action: 'ADDED_TIME_ANNOUNCED',
          payload: { period, minutes },
        });
        await client.query(
          `INSERT INTO outbox(topic, aggregate_id, payload) VALUES ('match.announcement.changed', $1, $2::jsonb)`,
          [matchId, JSON.stringify({ period, minutes })],
        );
      }
    });
  }
}
