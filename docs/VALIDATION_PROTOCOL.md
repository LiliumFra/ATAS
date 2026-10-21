# Validation protocol

ATAS must not influence an official competition before all applicable phases and written approvals are complete.

## Phase 0 — frozen specification

Approve the football-law interpretation, competition policy, ruleset digest, decision authority, fallback rules, data protection plan, cybersecurity ownership and independent evaluator.

## Phase 1 — software verification

Test every event policy, overlap arrangement, 45/90/extra-time boundary, interruption during added time, correction, duplicate, reordering and conflict. Test clock projection, anti-jump, staleness, quorum, residual drift, common-mode freeze against the period-wall reference and primary loss. Test authorization scope, database state guards, concurrent writes, migration restoration, cursor expiry, LISTEN half-open failure, shutdown timeout, checkpoint schema mismatch, checkpoint tampering and tail truncation.

Required evidence includes deterministic tests, property/fuzz tests, real PostgreSQL integration, load/soak/chaos tests, image/SBOM/provenance, restore drills and independent code/security review.

## Phase 2 — annotated historical corpus

At least two qualified refereeing analysts independently mark start/end, category, compensability, overlap and rationale. Adjudicate disagreements without tuning against the evaluation set.

Report interval-boundary error, total under/over-count, detector precision/recall, analyst agreement, excluded-event reasons, clock correlation error, confidence intervals and performance by competition/stadium/context.

## Phase 3 — laboratory and stadium integration

Integrate calibrated primary/reference clocks, operator terminals, official feeds and synchronised video. Measure timestamp accuracy, latency distributions, availability and recovery under packet loss, duplication, reordering, partitions, replica failure, database failover and power/network loss.

## Phase 4 — shadow operation

Run live without influencing officials, board, broadcast graphics or match duration. Compare ATAS evidence, referee decision, actual played time, unresolved proposals, workload and incidents. Publish predefined stop criteria and all material deviations.

## Phase 5 — controlled authorised pilot

Proceed only with written organiser and governing-body approvals. Preserve immediate manual fallback, independent evaluation, trained operators, incident command and post-match review.

## Proposed engineering gates

- zero unexplained deterministic-core mismatch;
- zero destructive mutation or silent evidence loss;
- zero unsafe clock state presented as valid;
- zero exact retry creating a duplicate logical effect;
- match-scope escape tests all denied;
- signed checkpoint tampering and tail-truncation tests detected;
- agreed p99 latency/availability and recovery objectives met under load;
- no unresolved critical/high independent security findings;
- referee remains the explicit decision maker in every tested workflow.

These are project proposals, not published FIFA certification thresholds.
