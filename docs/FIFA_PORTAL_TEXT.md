# FIFA Innovation Programme — portal-ready text

Use the wording below as a starting point. Update legal-entity, contact, funding, and supporting-body fields with verified information before submission.

## Innovation title

ATAS — Added Time Assistance System

## Category / priority

Officiating technology; professional football operations; match flow; or the closest open innovation priority available in the portal.

## One-line description

A deterministic, human-in-the-loop and auditable system that consolidates confirmed interruptions and authoritative clock evidence to assist referees with added-time decisions without transferring decision authority to software.

## Problem statement

Referee teams determine added time under severe time pressure from heterogeneous evidence including injuries, substitutions, disciplinary delays, VAR, celebrations, medical breaks, deliberate delay and other significant interruptions. Overlapping events, stoppages crossing the nominal period boundary, and losses during already-announced added time are difficult to reconstruct consistently. Existing workflows may not provide a common, transparent and independently reviewable timeline with explicit clock and source-integrity states.

## Proposed solution

ATAS measures confirmed time loss on a match-relative authoritative timeline. It binds an immutable operational policy to each match, merges overlapping intervals, handles interruptions crossing 45:00/90:00, and continues measuring losses during announced added time. Automated sources can only propose evidence; authorised operators or officials confirm, correct or reject it. Primary and reference clocks are authenticated, replay-protected and projected to a common instant and supervised for anti-jump, freshness, quorum, source drift and common-mode freeze against the official period start. Evidence is append-only, explainable, cryptographically chained and externally anchorable through signed checkpoints. Unsafe timing is withheld and source disagreement requires human review. The referee remains the final decision-maker and ATAS never ends a period or controls the fourth official's board autonomously.

## Current maturity

ATAS v1.3.0 is a production-oriented reference implementation with a strict TypeScript engine, PostgreSQL persistence and migrations, REST/OpenAPI and WebSocket interfaces, an operational console, Docker/Kubernetes deployment templates, deterministic tests, CI, CodeQL, dependency auditing, SBOM/provenance workflows, an explicit threat model, safety case, FMEA, data-protection profile and staged validation protocol. It has not yet completed independent cybersecurity certification, annotated match-corpus validation, stadium integration, referee usability studies or an authorised live shadow trial.

## Requested FIFA action

We request a merit and technical review through the FIFA Innovation Programme. If the concept is considered relevant, we request guidance toward a controlled Project Charter beginning with independent software and security assessment, annotated historical replay, laboratory/stadium integration and non-influential shadow operation. We are not requesting immediate competitive deployment, autonomous match authority or any claim of FIFA/IFAB certification.

## Proposed measurable value

- deterministic reproducibility from a frozen ruleset and confirmed timeline;
- no overlapping interruption counted twice;
- no unsafe clock state presented as valid;
- replay-safe ingestion under duplicate and reordered delivery;
- complete post-match reconstruction and audit verification;
- reduced referee-team cognitive load while preserving final human authority;
- measurable reliability, latency, usability and divergence metrics during shadow trials.

## Safety and Laws of the Game statement

ATAS is an assistance and evidence system. The referee remains the official timekeeper and final decision-maker. Any trial that could affect a competitive match or the application of the Laws of the Game would proceed only under the written authorisations required by FIFA, the relevant competition and The IFAB.

## Intellectual property

ATAS is released under the ATAS Attribution License 1.0. Any use, deployment, redistribution or derivative work must preserve the licence, NOTICE and mandatory credit to José Francisco Bustamante Ocampo and the ATAS project. The project is independent, does not use FIFA/IFAB trademarks as an endorsement, and makes no certification or affiliation claim.

## Attachments to upload

1. `FIFA_APPLICATION_DOSSIER.md` or an exported PDF.
2. `PILOT_PROJECT_CHARTER.md`.
3. `VALIDATION_PROTOCOL.md`.
4. `AUDIT_2026-07-20.md`.
5. `THREAT_MODEL.md`.
6. `RELEASE_EVIDENCE.md`.
7. `SAFETY_CASE.md`, `FMEA.md`, `DATA_PROTECTION.md` and `ARCHITECTURE.md`.
8. Two-to-three-minute demo video using `FIFA_PITCH_VIDEO_SCRIPT.md`.
9. Source repository/tag and SHA-256 checksums.
10. Legal-entity, ownership, IP, privacy and supporting-body documents requested by the portal.
