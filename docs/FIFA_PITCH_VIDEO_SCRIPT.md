# ATAS FIFA portal video script — approximately 2 minutes

Hello. My name is José Francisco Bustamante Ocampo, and I am presenting ATAS: the Added Time Assistance System.

Referees decide added time under pressure while tracking substitutions, injuries, disciplinary delays, VAR, goal celebrations and other interruptions. Some events overlap, some cross the end of normal time, and new time can be lost after added time has already been announced.

ATAS does not replace the referee. It creates one deterministic and auditable evidence timeline to support the referee's decision.

Here is the workflow. Authenticated sensors and official feeds can propose events, but they cannot confirm their own detections. An authorised operator or match official confirms, corrects or rejects each event. The calculation uses the immutable ruleset bound to that match and merges overlapping intervals so time is never counted twice.

The live engine cannot accept a clock entered by a browser. It uses an authenticated primary match clock and supervises fresh reference clocks for quorum and drift. If the primary clock is stale, the recommendation is withheld. If sources disagree, the system requires human review.

All event revisions, clock samples and official actions are append-only and cryptographically chained. The system can operate locally in a stadium without public internet and can reconstruct the complete decision after the match.

This prototype is not FIFA or IFAB certified, and it never ends a match or decides the board automatically. We are seeking a structured technical evaluation: independent software review, annotated historical replay, stadium laboratory testing and shadow trials that do not influence the match.

Our goal is simple: improve consistency, transparency and evidence while preserving the referee as the final authority.
