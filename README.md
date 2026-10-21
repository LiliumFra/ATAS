# ATAS — Added Time Assistance System

Production-oriented, auditable reference implementation for measuring and assisting decisions about **added time in association football**.

> **Status:** ATAS is not FIFA/IFAB-certified and must not autonomously decide or terminate an official match. It measures evidence and presents an explainable recommendation; the referee remains the final authority.

## Release 1.3.0 highlights

- Match-bound immutable rulesets and deterministic microsecond calculations.
- Primary clock projection to a common database-observed instant, redundant-source quorum, freshness, anti-jump checks, and an independent period-wall reference that detects clocks freezing together.
- Explainable output showing per-event raw, exclusive and shared durations, excluded evidence and overlap deductions.
- Replay-safe creation of matches, events, stoppages, clock samples and repeated lifecycle decisions.
- Append-only PostgreSQL evidence, strict lifecycle triggers and HMAC-SHA-256 chains.
- Exportable Ed25519-signed audit checkpoints for external anchoring and independent verification.
- Durable realtime change cursors with retention watermarks; WebSocket messages are only wake-up hints, and the PostgreSQL listener is actively heartbeated.
- Match-scoped JWTs, explicit capabilities and ingest-only sensor identities.
- Rate limits appropriate for high-frequency redundant clock adapters.
- Bounded, single-leader outbox cleanup and safe PostgreSQL `bigint` decoding.
- REST/OpenAPI, operational console, Prometheus/Grafana, Docker Compose, Kubernetes, bounded graceful shutdown, and hardened CI/release workflows.

## Safety model

ATAS separates five concerns:

1. **Detection:** sensors, VAR, official feeds or operators propose evidence.
2. **Confirmation:** authorised humans confirm, correct or reject it.
3. **Measurement:** a deterministic engine measures compensable intervals without double counting.
4. **Integrity supervision:** clock freshness, quorum, drift and source integrity gate the recommendation.
5. **Decision:** the referee approves the minimum displayed amount.

Automated identities cannot confirm their own events. ATAS never silently fails over to another primary clock and never sounds the final whistle.

## Quick start

Requirements: Docker Engine with Compose v2.

```bash
cp .env.example .env
openssl rand -hex 32  # JWT_SECRET
openssl rand -hex 32  # AUDIT_HMAC_SECRET — must be different

docker compose -f deploy/docker-compose.yml up -d --build
```

Open:

- Console: `http://localhost:8080/console/`
- OpenAPI: `http://localhost:8080/docs`
- Readiness: `http://localhost:8080/health/ready`

Create a short-lived administration token for initial provisioning:

```bash
docker compose -f deploy/docker-compose.yml exec app \
  node dist/scripts/issue-token.js --role admin --subject pilot-admin --hours 1
```

Production credentials should be issued by a controlled identity service. Non-admin tokens must be scoped to one or more match UUIDs using `--matches`.

## Minimal API flow

Generate a stable UUID before creating the match. Replaying the identical request is harmless; reusing that UUID with different content is rejected.

```bash
MATCH_ID="$(uuidgen | tr '[:upper:]' '[:lower:]')"

curl -X POST http://localhost:8080/v1/matches \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"matchId\":\"$MATCH_ID\",\"competition\":\"Pilot Competition\",\"homeTeam\":\"Home\",\"awayTeam\":\"Away\"}"
```

Issue match-scoped official and sensor credentials:

```bash
node dist/scripts/issue-token.js --role official --subject referee-001 --hours 8 --matches "$MATCH_ID"
node dist/scripts/issue-token.js --role sensor --subject stadium-clock-primary --hours 8 --matches "$MATCH_ID"
node dist/scripts/issue-token.js --role sensor --subject stadium-clock-backup --hours 8 --matches "$MATCH_ID"
```

Start the period and send realistic fresh clock samples. A newly started period cannot immediately jump to minute 44; the anti-jump gate rejects implausible advances.

```bash
curl -X POST "http://localhost:8080/v1/matches/$MATCH_ID/periods/FIRST_HALF/start" \
  -H "Authorization: Bearer $OFFICIAL_TOKEN"

curl -X POST "http://localhost:8080/v1/matches/$MATCH_ID/clock-samples" \
  -H "Authorization: Bearer $PRIMARY_CLOCK_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"period":"FIRST_HALF","sourceSequence":1,"elapsedUs":1500000,"evidence":{"device":"clock-a"}}'

curl -X POST "http://localhost:8080/v1/matches/$MATCH_ID/clock-samples" \
  -H "Authorization: Bearer $BACKUP_CLOCK_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"period":"FIRST_HALF","sourceSequence":1,"elapsedUs":1500000,"evidence":{"device":"clock-b"}}'
```

Add a confirmed interruption with a stable event UUID:

```bash
EVENT_ID="$(uuidgen | tr '[:upper:]' '[:lower:]')"

curl -X POST "http://localhost:8080/v1/matches/$MATCH_ID/events" \
  -H "Authorization: Bearer $OPERATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"eventId\":\"$EVENT_ID\",\"period\":\"FIRST_HALF\",\"kind\":\"INJURY\",\"source\":\"OPERATOR\",\"status\":\"CONFIRMED\",\"startUs\":200000,\"endUs\":800000,\"confidence\":1,\"evidence\":{\"terminal\":\"fourth-official-1\"}}"
```

Read the live estimate and durable changes:

```bash
curl "http://localhost:8080/v1/matches/$MATCH_ID/estimate/live?period=FIRST_HALF" \
  -H "Authorization: Bearer $VIEWER_TOKEN"

curl "http://localhost:8080/v1/matches/$MATCH_ID/changes?afterId=0&limit=100" \
  -H "Authorization: Bearer $VIEWER_TOKEN"
```

## Local development

ATAS targets Node.js 24 LTS and PostgreSQL 17.

```bash
npm ci
cp .env.development.example .env
npm run db:migrate
npm run dev
```

Run the complete static/unit pipeline:

```bash
npm run check
```

GitHub CI additionally starts PostgreSQL 17, applies every migration and runs the end-to-end API smoke test.

## Roles

| Role       | Intended use            | Effective permissions                                                        |
| ---------- | ----------------------- | ---------------------------------------------------------------------------- |
| `viewer`   | Observer/display        | Read only, within assigned matches                                           |
| `sensor`   | Automated adapter       | Submit `SENSOR_FUSION` proposals or authorised clock samples; no read access |
| `operator` | VAR/data operation      | Read and manage evidence/stoppages within assigned matches                   |
| `official` | Referee team            | Operator functions plus lifecycle, integrity and announcement decisions      |
| `admin`    | Controlled provisioning | Global administration and match creation                                     |

## Audit checkpoints

Create a post-match checkpoint after verifying all internal chains:

```bash
CHECKPOINT_SIGNING_PRIVATE_KEY_PATH=/secure/atas-ed25519-private.pem \
  npm run audit:checkpoint -- --match "$MATCH_ID" --output "checkpoint-$MATCH_ID.json"

npm run audit:checkpoint:verify -- \
  --input "checkpoint-$MATCH_ID.json" \
  --public-key /secure/atas-ed25519-public.pem \
  --expected-fingerprint <sha256-fingerprint>
```

Store the signed checkpoint in an independent archive, transparency service or governing-body evidence system. An embedded public key verifies mathematical consistency but is not by itself proof of signer identity.

## Rulesets and governance

The bundled policy is `rulesets/ifab-2026-27.json`. It is an engineering interpretation used for research and pilots. Grace values are not claimed as universal IFAB fixed values. Every competition must approve, version and pin its own policy digest.

## Production boundary

Version 1.3.0 is suitable for deterministic replay, laboratory integration and non-influential shadow trials. Official use still requires independent safety/cybersecurity review, annotated-match validation, stadium integration, human-factors studies, disaster-recovery exercises and written governing-body approval.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [API integration](docs/API.md)
- [Data model](docs/DATA_MODEL.md)
- [Operations runbook](docs/OPERATIONS.md)
- [Threat model](docs/THREAT_MODEL.md)
- [Preliminary safety case](docs/SAFETY_CASE.md)
- [Failure mode analysis](docs/FMEA.md)
- [Data protection profile](docs/DATA_PROTECTION.md)
- [Validation protocol](docs/VALIDATION_PROTOCOL.md)
- [Audit checkpoints](docs/AUDIT_CHECKPOINTS.md)
- [Rules and governance](docs/RULES_AND_GOVERNANCE.md)
- [FIFA submission index](docs/FIFA_INNOVATION_SUBMISSION.md)
- [Release audit](docs/AUDIT_2026-07-20.md)
- [Release evidence](docs/RELEASE_EVIDENCE.md)
- [Attribution requirements](ATTRIBUTION.md)

## License and attribution

Licensed under the **ATAS Attribution License 1.0**. Use, deployment, redistribution, demonstrations, integrations and derivative works require attribution to the original ATAS project and José Francisco Bustamante Ocampo. See [ATTRIBUTION.md](ATTRIBUTION.md) for the exact credit and placement requirements.

Minimum required credit:

> ATAS — Added Time Assistance System. Created by José Francisco Bustamante Ocampo. Copyright 2026 José Francisco Bustamante Ocampo and ATAS contributors.

The running service also exposes this information at `GET /v1/legal`.

This is a project-specific attribution-required license, not Apache-2.0.

Copyright 2026 José Francisco Bustamante Ocampo and ATAS contributors.
