# FIFA Innovation Programme — ATAS application dossier draft

## Applicant

**Project:** ATAS — Added Time Assistance System
**Lead:** José Francisco Bustamante Ocampo
**Repository target:** LiliumFra/ATAS
**Licence:** ATAS Attribution License 1.0 with mandatory author/project credit
**Status:** Independent prototype; not FIFA/IFAB-certified or affiliated

## One-sentence pitch

ATAS is a deterministic, human-in-the-loop and independently auditable assistance layer that consolidates confirmed match interruptions and authoritative clock evidence to help referees decide added time without transferring decision authority to software.

## Problem

Referee teams must determine added time under time pressure from heterogeneous evidence: injuries, substitutions, disciplinary delays, VAR, celebrations, medical breaks, deliberate delay, and other significant interruptions. Overlapping events, boundary-crossing stoppages, and losses during already-announced added time are difficult to reconstruct consistently. Current workflows may not provide one common, transparent, tamper-evident timeline with explicit clock and source integrity.

## Solution

ATAS provides:

- match-bound immutable rulesets;
- authenticated primary and reference clock sources;
- common-instant projection, anti-jump checks, freshness, quorum, source drift, and independent period-wall supervision;
- deterministic union of overlapping compensable intervals;
- correct treatment of stoppages crossing nominal period boundaries;
- continued measurement during announced added time;
- sensor proposals that require human confirmation;
- replay-safe event and clock ingestion;
- append-only PostgreSQL evidence, explainable contributions, cryptographic chains, and externally signed checkpoints;
- explicit `VALID`, `REVIEW_REQUIRED`, and `WITHHELD` outcomes plus durable realtime recovery;
- offline-capable stadium-edge deployment and complete post-match replay.

ATAS never autonomously decides the board value, ends a period, or replaces the referee.

## Direct value to football

- reduces cognitive load without reducing referee authority;
- increases consistency and explainability;
- enables objective post-match review and training;
- exposes technical uncertainty instead of hiding it;
- creates evidence for future policy and quality-programme research;
- supports shadow testing before any match influence.

## Maturity

Version 1.3.0 is a production-oriented reference implementation with strict TypeScript, PostgreSQL migrations, deterministic tests, API/OpenAPI, realtime updates, an operator console, Docker/Kubernetes templates, CI, CodeQL, dependency auditing, SBOM/provenance workflows, an explicit validation protocol, preliminary safety case, FMEA, and data-protection profile.

It has not yet completed independent cybersecurity certification, empirical match-corpus validation, stadium integration, referee usability studies, or authorised live shadow trials.

## Proposed project charter

### Work package 1 — independent technical assessment

Review architecture, calculations, database controls, clock model, cybersecurity, privacy, and failure modes. Reproduce the tagged build and verify the ruleset digest.

### Work package 2 — annotated historical replay

Create an independently annotated corpus and quantify deterministic agreement, source disagreement, timing error, overlap handling, and detector performance where applicable.

### Work package 3 — laboratory/stadium integration

Integrate two independent match-relative clocks, official data adapters, operator terminals, and synchronised video. Test latency, packet replay/reordering, clock drift, partitions, failover, and recovery.

### Work package 4 — shadow trials

Operate ATAS without influencing referee decisions, boards, broadcasts, or match duration. Measure reliability, workload, usability, unresolved proposals, and divergence from referee decisions.

### Work package 5 — controlled trial decision

Only if earlier gates pass, define an authorised pilot, independent evaluator, stop criteria, manual fallback, data governance, and any required written IFAB approval.

## Proposed success measures

- zero deterministic discrepancies against the frozen specification;
- zero silent loss or destructive mutation of confirmed evidence;
- zero unsafe clock states presented as valid;
- replay-safe ingestion under duplicate/reordered delivery;
- agreed local latency/availability targets;
- successful manual fallback in every tested failure;
- predefined referee usability/error thresholds;
- no unresolved critical/high independent security findings.

## Supporting body sought

A FIFA member association, professional league/competition, or professional club able to provide refereeing expertise, historical/controlled data, test facilities, and shadow-trial governance.

## Independent evaluator sought

An academic institution or accredited laboratory with expertise in sports officiating, timing/metrology, distributed systems, cybersecurity, and human factors.

## Intellectual property and licensing

The code is distributed under the ATAS Attribution License 1.0. Use, deployment, redistribution and derivative works must preserve the licence, copyright, NOTICE, and mandatory attribution to José Francisco Bustamante Ocampo and the ATAS project. Trademark and certification claims are excluded; the project does not use FIFA/IFAB marks and does not imply affiliation.

## Requested action from FIFA

We request a merit and technical review through the FIFA Innovation Programme. If ATAS is considered relevant, we request guidance toward a controlled Project Charter beginning with independent assessment, historical replay, and non-influential shadow operation. We are not requesting immediate competitive use or autonomous officiating authority.
