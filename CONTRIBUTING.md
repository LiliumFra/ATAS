# Contributing

## Non-negotiable principles

1. The referee remains the final decision-maker.
2. Sensor evidence cannot silently become confirmed time.
3. Changes to ruleset semantics require tests, documentation, and a version bump.
4. Historical records are append-only; corrections create revisions.
5. A loss of clock integrity must fail visibly and safely.
6. No FIFA or IFAB certification claim may be added without documentary authority.

## Development workflow

```bash
npm ci
npm run check
```

Use conventional, focused commits. Add tests for every engine change, especially boundary, overlap, active-event, and added-time recursion cases.

## Pull request checklist

- [ ] Typecheck passes.
- [ ] Lint passes.
- [ ] Formatting passes.
- [ ] Tests pass.
- [ ] Build passes.
- [ ] Ruleset impact documented.
- [ ] Threat model considered.
- [ ] Migration is backward compatible or has a rollback plan.
