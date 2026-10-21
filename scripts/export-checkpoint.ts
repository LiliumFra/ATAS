import { createHash, createPrivateKey, createPublicKey, sign as signPayload } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadConfig } from '../src/config.js';
import { createPool } from '../src/db/pool.js';
import { withTransaction } from '../src/db/tx.js';
import { canonicalJson } from '../src/domain/canonical.js';
import { assertSchemaCurrent, expectedMigrations } from '../src/db/schema.js';
import { AuditRepository } from '../src/repositories/audit.js';
import { ClockRepository } from '../src/repositories/clock.js';
import { EventRepository } from '../src/repositories/events.js';
import { StoppageRepository } from '../src/repositories/stoppages.js';

function argument(name: string, fallback?: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index === -1 ? fallback : process.argv[index + 1];
  if (value === undefined) throw new Error(`Missing --${name}`);
  return value;
}

const matchId = argument('match');
const outputPath = resolve(argument('output', `atas-checkpoint-${matchId}.json`));
const signingKeyPath = process.env.CHECKPOINT_SIGNING_PRIVATE_KEY_PATH?.trim();
const config = loadConfig();
const pool = createPool(config);
const packageManifest = JSON.parse(await readFile(resolve('package.json'), 'utf8')) as {
  version: string;
};
const migrations = await expectedMigrations();

try {
  await assertSchemaCurrent(pool);

  const releaseCommitRaw = process.env.ATAS_RELEASE_COMMIT?.trim();
  const releaseCommit =
    releaseCommitRaw === undefined || releaseCommitRaw === '' ? null : releaseCommitRaw;
  const checkpoint = await withTransaction(pool, async (client) => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const matchResult = await client.query<{
      id: string;
      competition: string;
      home_team: string;
      away_team: string;
      ruleset_id: string;
      status: string;
      updated_at: Date;
      ruleset_sha256: string;
    }>(
      `SELECT m.id, m.competition, m.home_team, m.away_team, m.ruleset_id,
              m.status, m.updated_at, r.sha256 AS ruleset_sha256
       FROM matches m JOIN rulesets r ON r.id = m.ruleset_id
       WHERE m.id = $1`,
      [matchId],
    );
    const match = matchResult.rows[0];
    if (match === undefined) throw new Error('Match not found');

    const [eventHead, stoppageHead, clockHead, auditHead, periods, verification, databaseState] =
      await Promise.all([
        client.query<{ count: number; head: string | null }>(
          `SELECT count(*)::bigint AS count,
             (SELECT event_hash FROM match_events WHERE match_id = $1 ORDER BY sequence DESC LIMIT 1) AS head
           FROM match_events WHERE match_id = $1`,
          [matchId],
        ),
        client.query<{ count: number; head: string | null }>(
          `SELECT count(*)::bigint AS count,
             (SELECT record_hash FROM play_stoppages WHERE match_id = $1 ORDER BY sequence DESC LIMIT 1) AS head
           FROM play_stoppages WHERE match_id = $1`,
          [matchId],
        ),
        client.query<{ count: number; head: string | null }>(
          `SELECT count(*)::bigint AS count,
             (SELECT sample_hash FROM match_clock_samples WHERE match_id = $1 ORDER BY sequence DESC LIMIT 1) AS head
           FROM match_clock_samples WHERE match_id = $1`,
          [matchId],
        ),
        client.query<{ count: number; head: string | null }>(
          `SELECT count(*)::bigint AS count,
             (SELECT audit_hash FROM audit_log WHERE match_id = $1 ORDER BY sequence DESC LIMIT 1) AS head
           FROM audit_log WHERE match_id = $1`,
          [matchId],
        ),
        client.query<{
          period: string;
          status: string;
          nominal_duration_us: number;
          announced_minutes: number | null;
          started_at: Date | null;
          ended_at: Date | null;
        }>(
          `SELECT period, status, nominal_duration_us, announced_minutes, started_at, ended_at
           FROM periods WHERE match_id = $1 ORDER BY period`,
          [matchId],
        ),
        Promise.all([
          new AuditRepository(config.auditHmacSecret).verify(client, matchId),
          new EventRepository(pool, config.auditHmacSecret).verify(client, matchId),
          new StoppageRepository(pool, config.auditHmacSecret).verify(client, matchId),
          new ClockRepository(pool, config.auditHmacSecret).verify(client, matchId),
        ]),
        client.query<{ database_time: Date; latest_change_id: number }>(
          `SELECT clock_timestamp() AS database_time,
                  GREATEST(
                    COALESCE((SELECT max(id) FROM outbox WHERE aggregate_id = $1), 0),
                    COALESCE(
                      (SELECT through_id FROM outbox_retention_watermarks WHERE aggregate_id = $1),
                      0
                    )
                  )::bigint AS latest_change_id`,
          [matchId],
        ),
      ]);

    const [auditValid, eventsValid, stoppagesValid, clocksValid] = verification;
    const head = (result: { rows: { count: number; head: string | null }[] }) => ({
      count: result.rows[0]?.count ?? 0,
      head: result.rows[0]?.head ?? '0'.repeat(64),
    });
    const body = {
      schema: 'atas.audit-checkpoint.v2',
      canonicalization: 'ATAS-ORDINAL-1',
      generatedAt: new Date().toISOString(),
      databaseTime: databaseState.rows[0]?.database_time.toISOString() ?? null,
      software: {
        version: packageManifest.version,
        commit: releaseCommit,
        migrations,
      },
      match: {
        id: match.id,
        competition: match.competition,
        homeTeam: match.home_team,
        awayTeam: match.away_team,
        status: match.status,
        rulesetId: match.ruleset_id,
        rulesetSha256: match.ruleset_sha256,
        updatedAt: match.updated_at.toISOString(),
      },
      periods: periods.rows.map((period) => ({
        period: period.period,
        status: period.status,
        nominalDurationUs: period.nominal_duration_us,
        announcedMinutes: period.announced_minutes,
        startedAt: period.started_at?.toISOString() ?? null,
        endedAt: period.ended_at?.toISOString() ?? null,
      })),
      chains: {
        events: head(eventHead),
        stoppages: head(stoppageHead),
        clocks: head(clockHead),
        audit: head(auditHead),
      },
      latestChangeId: databaseState.rows[0]?.latest_change_id ?? 0,
      verification: {
        valid: auditValid.valid && eventsValid.valid && stoppagesValid.valid && clocksValid.valid,
        audit: auditValid,
        events: eventsValid,
        stoppages: stoppagesValid,
        clocks: clocksValid,
      },
    };
    if (!body.verification.valid) throw new Error('Cannot checkpoint an invalid audit chain');
    return body;
  });

  const canonical = canonicalJson(checkpoint);
  const digest = createHash('sha256').update(canonical).digest('hex');
  let signature: Record<string, unknown> | null = null;

  if (signingKeyPath !== undefined && signingKeyPath !== '') {
    const privateKey = createPrivateKey(await readFile(resolve(signingKeyPath), 'utf8'));
    if (privateKey.asymmetricKeyType !== 'ed25519') {
      throw new Error('Checkpoint signing key must be Ed25519');
    }
    const publicKey = createPublicKey(privateKey);
    const publicKeyDer = publicKey.export({ type: 'spki', format: 'der' });
    signature = {
      algorithm: 'Ed25519',
      keyFingerprintSha256: createHash('sha256').update(publicKeyDer).digest('hex'),
      publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      valueBase64: signPayload(null, Buffer.from(canonical), privateKey).toString('base64'),
    };
  }

  const envelope = {
    checkpoint,
    canonicalSha256: digest,
    signature,
  };
  await writeFile(outputPath, `${JSON.stringify(envelope, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${outputPath}\n`);
} finally {
  await pool.end();
}
