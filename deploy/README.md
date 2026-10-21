# Deployment templates

These manifests are secure starting points, not a completed federation infrastructure.

## Docker Compose

The default topology exposes Caddy on `ATAS_PORT`; the application and PostgreSQL remain on the internal `backend` network. Caddy blocks `/metrics`, adds security headers, and forwards trusted proxy metadata. Prometheus scrapes the application internally.

Set two or more clock subjects and choose one explicit primary. The default production quorum is two fresh sources. Do not expose the application container directly when `TRUST_PROXY=true`.

Set `POSTGRES_PASSWORD` and the password component of `DATABASE_URL` to the same value. Use a cryptographically random URL-safe value (for example hexadecimal/base64url); otherwise percent-encode reserved URI characters. The application now consumes `DATABASE_URL` directly instead of interpolating a raw password into a URI.

For public DNS/TLS, set `ATAS_DOMAIN` to the approved hostname and adapt the host port/TLS policy. For an isolated stadium network, use a privately trusted certificate and controlled DNS rather than disabling transport protection.

## Kubernetes

Before applying:

1. Replace `ghcr.io/liliumfra/atas:1.3.0` with an immutable image digest.
2. Store secrets in an external secret manager; never deploy `secret.example.yaml`.
3. Configure real issuer/audience, origins, primary/reference clock subjects, quorum, freshness, and drift thresholds.
4. Run the migration job once before rollout.
5. Ensure ingress does not expose `/metrics`; use a separate internal monitoring path/policy.
6. Adapt NetworkPolicy to the actual ingress, DNS, PostgreSQL, and monitoring identities.
7. Use TLS to PostgreSQL and mTLS/hardware identities for match-critical devices.
8. Deploy replicas and PostgreSQL across failure domains with tested synchronous failover.
9. Require protected branches, signed releases, CI, CodeQL, SBOM/provenance, and independent review.

The match-critical path must remain usable without public internet access.
