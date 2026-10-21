# Rules and governance

## Scope

ATAS measures and explains time loss. It does not rewrite the Laws of the Game and it
does not remove the referee's authority.

## Policy classes

| Mode     | Behaviour                               | Example use                    |
| -------- | --------------------------------------- | ------------------------------ |
| `FULL`   | Entire confirmed interval counts        | VAR review, injury assessment  |
| `EXCESS` | Counts only after configured grace      | A delayed restart              |
| `MANUAL` | Counts only after official confirmation | Deliberate time wasting        |
| `NONE`   | Never counts                            | Competition-specific exclusion |

## Ruleset approval

A production ruleset must have:

- immutable identifier and semantic version;
- effective date;
- approving body and approval reference;
- source-law version;
- exact event definitions;
- operational grace definitions and evidence;
- rollback procedure;
- signed SHA-256 digest;
- validation dataset and expected outputs.

The bundled `ifab-2026-27-reference` file is a reference configuration. Its restart
grace values are engineering defaults and are not represented as fixed official values.

## Change control

Ruleset changes should follow a four-person control model:

1. football-law owner proposes;
2. refereeing owner reviews;
3. engineering owner implements and tests;
4. independent approver signs the release.

No ruleset may change during an active match. A match stores its selected `ruleset_id`
when created.

## Decision trace

The operator display should distinguish:

- confirmed measured loss;
- proposed/unconfirmed evidence;
- announced minimum;
- new loss during added time;
- clock/source integrity;
- active intervals;
- exact target and panel alternatives.

The UI must not present a model probability as a binding decision.
