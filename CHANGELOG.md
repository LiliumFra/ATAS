# Changelog

## 1.3.0 — 2026-10-21

- Replaced Apache-2.0 for future public releases with the ATAS Attribution License 1.0.
- Made author/project credit mandatory for deployments, redistributions, integrations, demonstrations and derivative works.
- Added explicit attribution placement requirements for user-facing and headless systems.
- Added built-in operator-console attribution and updated public project metadata and FIFA-facing documentation.
- Updated deployment image references and OpenAPI metadata to 1.3.0.

## 1.2.0 — 2026-07-20

- Added an independent database period-wall reference so redundant clocks that freeze together cannot appear healthy.
- Added active PostgreSQL LISTEN heartbeats, stale-listener readiness gating, bounded graceful shutdown and startup rollback cleanup.
- Kept the displayed board value fixed after an official announcement while retaining a larger measured amount as minimum-play evidence.
- Required a current verified migration set before checkpoint export and made checkpoint cursors retention-watermark aware.
- Projected redundant clock samples to a common database-observed instant and separated fresh operational drift from stale diagnostic drift.
- Added anti-jump checks for implausibly fast clock advance.
- Added explainable per-event contributions, explicit exclusions and overlap deductions.
- Added durable cursor-based realtime recovery, retention watermarks and WebSocket heartbeat.
- Added bounded single-leader outbox cleanup.
- Added Ed25519-signed, externally verifiable audit checkpoints with an explicit ordinal canonicalization profile and v1 verification compatibility.
- Added production match-scoped JWT enforcement and admin-only match creation.
- Made match creation and repeated event/lifecycle decisions idempotent.
- Added database-enforced match/period lifecycle and immutable identity guards.
- Added a dedicated high-frequency clock-ingestion rate limit.
- Added bounded JSON validation for metadata and evidence payloads.
- Added an exact database-schema compatibility gate that rejects future migrations.
- Expanded PostgreSQL smoke, authorization, timing and retry tests.
- Updated deployment, release provenance, validation and FIFA submission documentation.

## 1.1.0 — 2026-07-19

- Bound calculations to each match's immutable ruleset.
- Added authenticated append-only clock samples, live estimates, freshness/quorum/drift supervision and replay-safe sensor events.
- Added strict `bigint` decoding, database immutability triggers, hardened browser console and deployment/release controls.

## 1.0.0 — 2026-07-19

- Initial production-oriented reference release.
