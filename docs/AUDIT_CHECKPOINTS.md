# External audit checkpoints

ATAS protects events, stoppages, clock samples, and operational audit records with per-match HMAC hash chains. A chain detects internal edits, but a party that controls both the database and HMAC secret could recompute it or remove its final suffix. Signed external checkpoints anchor the observed chain heads outside the application trust boundary.

## Key generation

Generate the Ed25519 key on an offline or HSM-backed signing host, not inside the API container:

```bash
openssl genpkey -algorithm ED25519 -out atas-checkpoint-private.pem
openssl pkey -in atas-checkpoint-private.pem -pubout -out atas-checkpoint-public.pem
chmod 600 atas-checkpoint-private.pem
```

Keep the private key outside Git, container images, Kubernetes Secrets, and the ATAS database. Publish the public-key fingerprint through a separately controlled channel.

## Export

Run after each period, announcement, integrity incident, and final match closure:

```bash
CHECKPOINT_SIGNING_PRIVATE_KEY_PATH=/secure/atas-checkpoint-private.pem \
ATAS_RELEASE_COMMIT="$(git rev-parse HEAD)" \
npm run audit:checkpoint -- \
  --match 00000000-0000-4000-8000-000000000001 \
  --output checkpoint-final.json
```

Before export, the tool verifies that the database contains exactly the migration set supported by the running release. It then uses a read-only repeatable-read transaction, verifies all four internal chains, records the explicit ordinal canonicalization profile, chain counts and heads, ruleset digest, period states, migration checksums, software version, optional release commit, database time, and the latest durable change ID including the retention watermark when older outbox rows have already been purged. It refuses to sign an invalid chain.

## Independent verification

Verification should use a trusted public key or an expected fingerprint obtained independently of the checkpoint file:

```bash
npm run audit:checkpoint:verify -- \
  --input checkpoint-final.json \
  --public-key atas-checkpoint-public.pem \
  --expected-fingerprint <64-hex-sha256>
```

Verifying only the public key embedded in the checkpoint proves mathematical self-consistency, not identity. Federation or tournament operation should pin the expected fingerprint and archive each checkpoint in write-once object storage or an external transparency service.

## Retention

Store checkpoints independently from the match database and HMAC secret. Recommended copies are:

- local stadium write-once archive;
- federation-controlled archive;
- independent evaluator archive for a pilot;
- encrypted off-site backup.

A later checkpoint must never replace an earlier one. Retain the complete sequence so suffix deletion or rollback is detectable.

## Compatibility

ATAS 1.2 exports `atas.audit-checkpoint.v2` with the fixed `ATAS-ORDINAL-1` canonicalization profile. The verifier can also validate v1 checkpoints and reports when legacy locale-based canonicalization was required. New checkpoints must never use the legacy profile.
