# Release evidence — ATAS 1.2.0

Release date: 2026-07-20

## Verified in the build workspace

- Exact target runtime: Node.js 24.18.0 with npm 10.9.2.
- Formatting: passed.
- ESLint strict/type-aware analysis: passed.
- TypeScript strict type-check: passed.
- Production compilation: passed.
- Unit/regression tests: 55 passed across 11 test files.
- Coverage run: passed; 75.58% statements and 76.87% lines overall. The pure timing engine reached 88.88% statement coverage and 88.78% line coverage.
- Locked production dependency audit: zero known vulnerabilities reported at the configured audit level.
- Production dependency tree resolution: passed; missing WebSocket native accelerators are optional dependencies.
- NPM packaging dry run: 133 entries, approximately 110,367-byte archive and 399,422 bytes unpacked. Final artifact checksums are recorded in the release checksum manifest.
- Bundled ruleset SHA-256: `8278696f39216a4717719a76a7f72b318332d47ccf37e042fc11dcc5f9dd28b3`.
- PostgreSQL migration syntax: five migration files parsed successfully; 56 statements in total.
- JSON validation: 7 files passed.
- YAML/CFF validation: 17 files / 18 documents passed.
- Shell entrypoint syntax: passed.
- Git whitespace/error check: passed.
- Strict PostgreSQL `int8` parsing tests cover exact values, malformed values and values outside JavaScript's safe-integer range.
- Regression coverage includes ruleset binding, common-instant clock projection, common-mode clock freeze, announcement-board immutability, overlap explanation, schema compatibility, bounded JSON, match scope and legacy hash verification.
- Release container metadata publishes matching `v1.2.0`, `1.2.0`, `1.2` and `latest` tags under `ghcr.io/liliumfra/atas`.

## Automated after publication

The GitHub Actions workflows are configured to run:

- the full static/unit pipeline on Node.js 24.18.0;
- PostgreSQL 17 migrations and exact schema verification;
- an end-to-end API smoke test against real PostgreSQL, including match/clock/event retry safety, live calculation, announcement non-reduction and audit verification;
- a Docker BuildKit image build;
- CodeQL analysis and dependency auditing;
- release image SBOM and build-provenance attestation.

The PostgreSQL runtime smoke test, Compose topology and Docker image build were not executable in the artifact workspace because it did not provide Docker or a PostgreSQL server. They remain mandatory promotion gates.

## Release boundary

This evidence establishes a production-oriented software baseline for deterministic replay, laboratory work and non-influential shadow evaluation. It does not constitute FIFA/IFAB certification, governing-body approval, completed stadium integration, independent cybersecurity/safety validation or permission to influence an official match.

## Public release licensing update — 2026-10-21

The public GitHub release line is v1.3.0 and later. It uses the ATAS Attribution License 1.0 with mandatory project/author credit. The public repository should not publish the pre-release Apache-2.0 Git history because doing so would make those earlier revisions separately available under their prior permissive terms.
