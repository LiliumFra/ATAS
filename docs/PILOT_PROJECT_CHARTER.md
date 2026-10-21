# Draft pilot project charter

## Objective

Determine whether ATAS can safely, reliably, and usefully assist referee teams in measuring added-time evidence while preserving full human decision authority.

## Scope

Included: deterministic engine, match-bound rulesets, clock ingestion/consensus, event workflow, auditability, operator interfaces, edge deployment, historical replay, laboratory and shadow testing.

Excluded: autonomous period termination, automatic board control, public/broadcast claims of official accuracy, and competitive influence without explicit approvals.

## Stakeholders

- applicant/provider;
- FIFA innovation and refereeing representatives;
- supporting association/league/club;
- match officials and operators;
- independent evaluator;
- cybersecurity/privacy/legal representatives;
- The IFAB where the Laws or competitive trials require its approval.

## Work packages and gates

1. Specification and rules governance.
2. Independent software/security assessment.
3. Annotated historical validation.
4. Laboratory and stadium integration.
5. Non-influential shadow trials.
6. Formal go/no-go review for any controlled trial.

Each gate requires signed evidence, known limitations, and an approved next-stage plan.

## Stop criteria

- unsafe state displayed as valid;
- unexplained deterministic mismatch;
- confirmed evidence lost or destructively altered;
- material clock drift not detected;
- security/privacy incident;
- operator interface creates unacceptable human-factor risk;
- manual fallback cannot be completed;
- governing-body approval is absent or withdrawn.

## Reporting

Versioned source and ruleset digest, SBOM, test results, incident logs, performance results, user-study results, independent assessment, limitations, and final recommendations.
