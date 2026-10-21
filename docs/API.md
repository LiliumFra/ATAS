# API integration

Interactive OpenAPI documentation is available at `/docs`.

## Authentication and match scope

REST requests use short-lived bearer JWTs. Non-admin credentials include a `matches` claim containing assigned match UUIDs. In production, a request whose path contains another match UUID is rejected before the route handler runs.

```http
Authorization: Bearer <JWT>
```

Browser WebSockets use `atas-v1, jwt.<JWT>` as subprotocols. TLS and proxy/application redaction of `Sec-WebSocket-Protocol` are mandatory.

## Match creation

```http
POST /v1/matches
```

Admin only. `matchId` is mandatory and client-generated. Exact retries return the existing match with HTTP 200; a first creation returns 201; reuse with different content returns 409.

```json
{
  "matchId": "9df43109-a201-47d4-8fb2-bb51d9cedc49",
  "competition": "Pilot Competition",
  "homeTeam": "Home",
  "awayTeam": "Away",
  "metadata": { "venue": "Pilot Stadium" }
}
```

## Time model

`startUs`, `endUs`, `elapsedUs` and diagnostic `nowUs` are safe integer microseconds relative to the start of the selected period. They are not Unix timestamps.

Operational calculation:

```http
GET /v1/matches/{matchId}/estimate/live?period=SECOND_HALF
```

The server projects all latest clock samples to one common database-observed instant, calculates from the designated primary source, supervises freshness/quorum/residual drift, and compares the projected primary with database time elapsed since the official period start. Stale samples remain visible as diagnostics but do not inflate operational fresh-source drift. A common-mode clock freeze is therefore withheld even when redundant devices still agree.

Diagnostic/replay calculation only:

```http
GET /v1/matches/{matchId}/estimate?period=SECOND_HALF&nowUs=2700000000
```

## Clock ingestion

```http
POST /v1/matches/{matchId}/clock-samples
```

Requirements:

- JWT role is `sensor` or controlled `admin` maintenance access;
- JWT subject is one of `CLOCK_SOURCE_SUBJECTS`;
- source sequence increases monotonically per match/period/source;
- elapsed time never moves backwards or implausibly faster than server-observed time;
- exact retries are idempotent;
- reused sequence with different content is rejected;
- the route has a dedicated high-frequency limit configured by `CLOCK_RATE_LIMIT_MAX`.

## Event ingestion and decisions

Every event includes a stable UUID `eventId`. Sensor credentials may submit only `source=SENSOR_FUSION`; the server forces `status=PROPOSED`. Operators and officials may append confirmation, correction or rejection revisions.

Exact creation or decision retries produce no duplicate event, audit record or realtime change. Reusing the logical UUID with different first-revision content is rejected.

## Stoppages and lifecycle commands

Stoppage UUIDs are stable and retry-safe. Start/end period, announcement, integrity and final-status operations are state-idempotent. An announced minimum cannot be reduced. A period cannot end with confirmed open evidence.

## Explainable estimate

The response includes:

- confirmed initial allowance and additional losses during added time;
- raw compensable duration and overlap deducted;
- exact target end and remaining duration;
- floor/ceiling panel evidence before announcement; after announcement both fields remain fixed to the displayed minimum while the exact target may still be longer;
- `eventContributions` with raw, exclusive and shared intervals;
- `excludedEvents` with explicit exclusion reason;
- clock projection, sample ages, source residuals, fresh quorum, maximum observed drift, and independent period-wall drift;
- `integrity`: `OK`, `DEGRADED` or `UNSAFE`;
- `operationalRecommendation`: `VALID`, `REVIEW_REQUIRED` or `WITHHELD`.

Shared time is deliberately not allocated arbitrarily to one event; it is displayed as overlap evidence.

## Durable realtime feed

```http
GET /v1/matches/{matchId}/changes?afterId=<cursor>&limit=100
```

The outbox is the durable source. WebSockets are low-latency wake-up hints. Clients persist the latest `changeId`, fetch missing changes after reconnect and then reload authoritative REST state.

Published changes expire according to `OUTBOX_RETENTION_DAYS`. The response includes a retention watermark. When `cursorExpired=true`, discard the old cursor and perform a complete REST resynchronisation before accepting new notifications.

## Audit verification

```http
GET /v1/matches/{matchId}/audit/verify
```

This verifies the audit, event, stoppage and clock HMAC chains. For external anti-truncation evidence, export and independently retain an Ed25519-signed checkpoint as described in `AUDIT_CHECKPOINTS.md`.


## Legal and attribution metadata

`GET /v1/legal` is public and returns the project license, mandatory attribution text, canonical repository, and non-certification disclaimer. Integrators should preserve this endpoint or provide an equivalent discoverable legal/credits surface as required by `LICENSE`.
