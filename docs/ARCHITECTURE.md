# Architecture

## Safety properties

1. **Determinism:** identical match-bound ruleset and confirmed timeline produce identical output.
2. **Authoritative time:** operational calculations never accept a browser-supplied clock.
3. **Aligned consensus:** samples are projected to one database-observed instant before drift comparison and checked against an independent period-wall reference.
4. **Human authority:** automation proposes; authorised humans confirm and decide.
5. **Append-only evidence:** corrections add revisions; destructive mutation is rejected by PostgreSQL.
6. **Retry safety:** stable command identities and state equivalence prevent duplicate effects.
7. **Fail closed:** missing/stale/frozen primary timing yields `WITHHELD`; insufficient source quorum or source disagreement yields `REVIEW_REQUIRED`.
8. **Recoverable realtime:** the durable change cursor survives lost WebSocket notifications.
9. **External anchoring:** signed checkpoints detect database-tail truncation when retained independently.
10. **Edge operation:** the match-critical path requires no public internet service.

## Component view

```text
Primary clock ──────────────┐
Reference clocks ───────────┤ authenticated, sequenced samples
Sensors / VAR / feeds ──────┤ proposed evidence
Operator/referee terminals ─┤ confirmed revisions and decisions
                            ▼
                    Fastify API replicas
                 auth scope + route capability
                            │
                  per-match advisory lock
                            ▼
                         PostgreSQL
  rulesets | matches/periods | evidence chains | audit | durable outbox
                            │
              LISTEN/NOTIFY wake-up hints
                            ▼
              WebSocket + cursor-based REST recovery

match.ruleset_id + latest confirmed revisions + projected primary clock
                            ▼
             deterministic explainable timing engine
```

## Clock architecture

Every source is the authenticated JWT subject. Samples are append-only, sequenced and non-decreasing. The repository calculates all ages using `statement_timestamp()`, giving one consistent database instant for a query. The engine then projects elapsed values to that instant.

The primary source is never replaced automatically. Fresh-source residuals determine operational drift; stale-source residuals remain available as diagnostics. An anti-jump gate compares new elapsed time with server-observed wall advance plus an explicit tolerance. Independently, the projected primary is compared with PostgreSQL time elapsed since the official period start. This detects a common-mode freeze in which all clock devices agree with one another but stop advancing.

## Concurrency and idempotency

Match mutations acquire a transaction-scoped advisory lock. Client-generated match/event/stoppage UUIDs and clock sequences make exact network retries harmless. Lifecycle commands are state-idempotent, so a retry does not append another audit or outbox row.

## Realtime and retention

Every state mutation and outbox row commit atomically. Notifications only wake connected nodes. The dedicated `LISTEN` connection is actively heartbeated and readiness fails when it becomes stale, even if a half-open socket has not emitted an error. Consumers recover from a durable ordered cursor. Published rows are deleted in bounded batches by one advisory-lock cleanup leader; per-match watermarks identify expired cursors and force safe full resynchronisation.

## Cryptographic model

HMAC chains detect changed or reordered rows while the application secret remains trustworthy. They do not alone prevent an administrator from deleting the latest valid tail. Post-match Ed25519 checkpoints bind chain counts/heads, ruleset digest, migration checksums and durable cursor into an externally retainable signed statement.
