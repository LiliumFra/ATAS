# Operations runbook

## Pre-match gate

- Verify exact image digest, release tag, migration set, ruleset ID and ruleset SHA-256.
- Create the match once with a preallocated UUID; replay the request and confirm HTTP 200 with the same match.
- Issue short-lived match-scoped credentials and verify another match is denied.
- Verify primary/reference source identities, sequence reset policy and dedicated clock rate limit.
- Send samples from every clock; confirm projection age, quorum, residual drift and period-wall consistency.
- Retry a clock, event and lifecycle operation; confirm no duplicate audit/change record.
- Disconnect WebSocket, create changes, reconnect from cursor and verify full recovery.
- Exercise an expired cursor and verify forced full resynchronisation.
- Verify all chains and export a signed test checkpoint.
- Confirm independent referee timing and complete offline/manual fallback.

## During play

- Treat `VALID` only as evidence for human consideration.
- Treat `REVIEW_REQUIRED` as mandatory reconciliation.
- Treat `WITHHELD` as immediate manual fallback.
- Review per-event contribution and overlap rather than only the total.
- Never promote a backup clock silently.
- Never edit append-only tables directly.

## Clock incidents

- **Primary absent/stale:** recommendation withheld; continue independent official timing.
- **Quorum missing or source drift high:** review required; reconcile sources and video correlation points.
- **All sources agree but period-wall drift is high:** recommendation withheld; treat as common-mode clock freeze or incorrect period-start correlation.
- **Implausible jump rejected:** inspect sequence, device epoch/reset and transport buffering; do not raise tolerance during a match without authorised change control.

## Realtime incidents

A stale PostgreSQL listener makes readiness fail even when the TCP socket has not closed. Replace the instance; clients can continue cursor polling through another ready replica. WebSocket loss does not imply state loss. Reconnect, call `/changes` from the last cursor and reload REST state. When the retention watermark reports expiration, discard local derived state and perform complete resynchronisation.

## Post-match evidence

1. Close confirmed open intervals and finish the lifecycle.
2. Call `/audit/verify` and resolve any invalid chain before export.
3. Export an Ed25519-signed checkpoint using an offline/HSM-backed key.
4. Verify it from an independent host with a pinned public-key fingerprint.
5. Archive checkpoint, database backup, logs, ruleset and release/image digest separately.

## Recovery objectives for a pilot

Targets must be agreed in the project charter. Suggested starting points: no public-internet dependency during play, tested API-node failover, a replicated database with measured RPO/RTO, encrypted off-site evidence archive and continuously usable manual timing.

## Controlled shutdown

`SHUTDOWN_TIMEOUT_MS` bounds graceful termination. If listeners, WebSockets, workers or the database pool cannot close within that interval, the process exits non-zero so the orchestrator replaces it. Investigate every forced shutdown before promotion.
