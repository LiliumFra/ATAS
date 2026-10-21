# Preliminary safety case

This is a structured argument for evaluation, not a certification claim.

## Top-level claim

**C0:** ATAS can be evaluated in replay, laboratory and non-influential shadow operation without transferring match authority to software or silently presenting materially untrustworthy timing as valid.

## Claims and evidence

| Claim                                             | Principal evidence in this repository                                                                     | Open assurance work                                           |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| C1. Calculation is deterministic                  | frozen ruleset digest, pure interval engine, regression tests                                             | independent specification review and property/fuzz testing    |
| C2. Overlap and boundaries are handled explicitly | interval-union logic, 45/90/extra-time tests, explainable deductions                                      | annotated historical corpus and referee adjudication          |
| C3. Live time is not caller-controlled            | authenticated source identity, projection, anti-jump, freshness/quorum/source-drift and period-wall gates | calibrated stadium timing/metrology assessment                |
| C4. Unsafe timing fails visibly                   | `VALID`, `REVIEW_REQUIRED`, `WITHHELD`; no automatic primary failover                                     | human-factors testing of alerts and fallback                  |
| C5. Automated sources lack decision authority     | capability-based roles and forced sensor proposals                                                        | external identity/device assurance and operational training   |
| C6. Evidence is reconstructable                   | append-only revisions, HMAC chains, audit log, durable changes                                            | independent database and incident-recovery exercises          |
| C7. Tail deletion can be detected externally      | Ed25519 checkpoint counts/heads and pinned fingerprint                                                    | HSM, independent archive and checkpoint publication procedure |
| C8. Retries do not duplicate logical effects      | stable UUIDs/sequences and state-idempotent commands                                                      | real PostgreSQL concurrency/load fault injection              |
| C9. Deployment can operate at the edge            | local PostgreSQL/API topology, no required public service                                                 | stadium network/power/failover validation                     |
| C10. Referee retains authority                    | no whistle/board automation, explicit decision state                                                      | governing-body protocol and authorised shadow trial           |

## Safety constraints

- ATAS output must not be presented as valid when `operationalRecommendation` is not `VALID`; source agreement alone is insufficient when period-wall drift is outside tolerance.
- No automated identity may confirm evidence or approve the displayed minimum.
- No backup clock becomes primary without an authorised configuration/change procedure.
- The exact ruleset and release/image digest must be frozen before a match.
- Manual official timing remains continuously available.
- Any unexplained chain failure, schema mismatch or checkpoint failure stops operational use.

## Current conclusion

The software evidence supports progression to independent review and controlled shadow evaluation. It does not yet support competitive influence, FIFA/IFAB certification or autonomous officiating.
