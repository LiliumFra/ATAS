# Data model

## Core state

- `rulesets`: immutable canonical policy body and SHA-256 digest.
- `matches`: client-generated UUID, teams, competition, immutable ruleset binding, integrity and lifecycle.
- `periods`: ordered lifecycle, nominal duration and non-decreasing announced minimum.

PostgreSQL triggers enforce valid state transitions, immutable identity fields and rejection of destructive deletion.

## Evidence chains

- `match_clock_samples`: authenticated source, monotonic source sequence, elapsed microseconds, receive time, evidence and HMAC chain.
- `match_events`: append-only logical event revisions grouped by stable `event_id`.
- `play_stoppages`: append-only stoppage revisions grouped by stable `stoppage_id`.
- `audit_log`: actor/action history with an independent HMAC chain.

PostgreSQL `bigint` values are accepted only when exactly representable as JavaScript safe integers.

## Realtime

- `outbox`: ordered durable state-change messages committed with the mutation.
- `outbox_retention_watermarks`: greatest deleted change ID per match. It lets clients distinguish an empty delta from an expired cursor.

Cleanup is bounded by `OUTBOX_CLEANUP_BATCH_SIZE`, serialised with a PostgreSQL advisory transaction lock and limited to published rows older than the configured retention.

## Migrations

1. Core schema, evidence, audit and outbox.
2. Clock chain and append-only enforcement.
3. realtime indexes plus event/stoppage revision-lineage enforcement.
4. lifecycle guards, immutable match/period identity and retention watermarks.

The application refuses readiness when the migration ledger is not current.
