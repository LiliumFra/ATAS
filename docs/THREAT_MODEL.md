# Threat model

## Protected assets

Official timing evidence, human decisions, ruleset binding, match assignment, clock identity, audit history, release identity and service availability.

## Controls

| Threat                               | Principal control                                               |
| ------------------------------------ | --------------------------------------------------------------- |
| Caller manipulates live time         | live endpoint uses authenticated clock samples only             |
| Asynchronous samples appear to drift | database-common age plus projection to one instant              |
| Clock jumps forward                  | real-time anti-jump gate and source sequence checks             |
| Redundant clocks freeze together     | independent PostgreSQL period-wall drift gate                   |
| Retry duplicates state               | client UUIDs, source sequences and state-idempotent commands    |
| Sensor gains human authority         | explicit capability matrix; sensor is ingest-only/`PROPOSED`    |
| Credential acts on another match     | mandatory production match scope                                |
| Wrong rules applied                  | immutable match-bound ruleset and pinned digest                 |
| Overlap inflates total               | interval-union engine plus explainable overlap deduction        |
| Database evidence rewritten          | append-only/state-transition triggers and HMAC chains           |
| Valid chain tail deleted             | externally retained Ed25519 checkpoint with counts and heads    |
| Lost notification causes stale UI    | durable ordered changes cursor and retention watermark          |
| LISTEN socket remains half-open      | active heartbeat plus readiness staleness gate                  |
| Cleanup harms latency/storage        | single cleanup leader and bounded batches                       |
| PostgreSQL integer loses precision   | strict safe-integer `int8` decoder                              |
| Browser leaks token/XSS              | in-memory JWT, CSP, text-only rendering and header redaction    |
| Supply-chain compromise              | lockfile, CodeQL, audit, SBOM, provenance and digest deployment |
| Process hangs during deployment      | bounded graceful shutdown with forced failure exit              |

## Residual risks

- A compromised API host can misuse active signing/HMAC material; production should use an HSM/KMS and independently controlled checkpoint publication.
- Match-scoped symmetric JWTs remain bearer credentials; elite deployment should use managed identity, mTLS/device attestation and rapid revocation.
- Sensor/detector correctness is outside the deterministic core and requires its own validated quality programme.
- Human confirmation can be wrong; dual review, training and usability studies remain necessary.
- Database high availability, physical security, insider controls and incident response depend on the deployment organisation.
