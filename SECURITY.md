# Security policy

## Reporting

Do not open a public issue for a suspected vulnerability affecting authentication,
audit integrity, match timing, or data isolation. Contact the repository owner
privately and include reproducible steps, impact, and affected versions.

## Supported version

Only the latest tagged minor release receives security fixes during the initial
reference-project phase.

## Security assumptions

- TLS or mTLS is terminated by a trusted edge proxy.
- PostgreSQL is isolated from public networks.
- JWT and audit HMAC secrets are different and stored in a secret manager.
- Official and operator devices are managed endpoints.
- Metrics and admin endpoints are network-restricted.
- Database backups are encrypted and restoration is tested.

## Prohibited configurations

- `AUTH_DISABLED=true` in production.
- Shared JWT and audit secrets.
- Long-lived sensor tokens.
- Public PostgreSQL exposure.
- Running the container as root.
- Editing historical database rows directly.
