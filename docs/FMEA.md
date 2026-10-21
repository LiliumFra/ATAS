# Preliminary failure mode and effects analysis

Scores are illustrative for pilot planning and must be reassessed by the governing body and independent evaluator.

| Failure mode                      | Effect                                 | Detection/control                             | Required response                                                  |
| --------------------------------- | -------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------ |
| Primary clock absent/stale        | unreliable live position               | freshness gate, `WITHHELD`                    | use independent referee timing; restore or formally change primary |
| Reference sources disagree        | uncertain clock alignment              | residual drift/quorum, `REVIEW_REQUIRED`      | reconcile devices/video; no automated recommendation               |
| Clock jumps forward               | inflated event acceptance/estimate     | anti-jump rejection and audit                 | isolate source; inspect reset/sequence/configuration               |
| All clock sources freeze together | apparently coherent but stale timeline | period-wall drift gate, `WITHHELD`            | use independent referee timing; isolate clock distribution         |
| Duplicate sensor/network retry    | duplicated interruption                | stable event/stoppage UUID and clock sequence | exact retry returns existing record                                |
| Conflicting UUID reuse            | evidence substitution                  | canonical payload comparison, HTTP 409        | investigate adapter identity and replay state                      |
| Lost WebSocket notification       | stale display                          | durable cursor and REST resync                | fetch missing changes; full reload if cursor expired               |
| Half-open realtime listener       | no low-latency wake-up hints           | active SQL heartbeat and readiness failure    | replace pod; clients continue durable cursor polling               |
| Database replica/API restart      | temporary unavailability               | readiness, durable PostgreSQL state           | fail over; verify chains and cursor before resuming                |
| Database tail deleted             | incomplete but internally valid chain  | external signed checkpoint count/head         | stop use; compare independent archive and restore evidence         |
| Wrong ruleset/release             | incorrect policy                       | immutable binding, digest and migration gate  | stop; deploy approved artifact and revalidate                      |
| Operator confirms wrong event     | incorrect allowance                    | revision history and contribution explanation | second review/correction; retain rationale                         |
| Deep/oversized evidence payload   | CPU/memory exhaustion                  | body limit and bounded JSON validation        | reject payload; fix adapter schema                                 |
| Credential used on another match  | cross-match mutation/read              | match-scoped JWT                              | revoke credential; security investigation                          |
| Outbox grows indefinitely         | storage/performance degradation        | retention, bounded single-leader cleanup      | monitor watermark/size; archive and tune under change control      |
| Software unavailable              | no assistance                          | health monitoring and manual fallback         | continue match with official independent timing                    |
