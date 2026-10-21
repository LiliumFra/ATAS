# Data protection and minimisation profile

ATAS should store timing evidence, not unnecessary personal data.

## Default minimisation rules

- Do not place video, audio, biometric templates, medical details or identity documents directly in `evidence` JSON.
- Store opaque references to separately governed media/evidence systems.
- Use role/device identifiers rather than personal names where operationally sufficient.
- Define competition-specific schemas for metadata/evidence; arbitrary fields are for adapters and pilots, not an invitation to collect more data.
- Apply purpose limitation, access control, retention and deletion rules approved for the jurisdiction and competition.

## Technical controls

- Request body size limit.
- Bounded JSON depth, node count, keys, arrays and strings.
- Match-scoped credentials and role separation.
- Append-only history and audit of decisions.
- TLS/mTLS at the edge, encrypted database/backups and network isolation.

## Governance still required

The deploying organisation must define controller/processor roles, lawful basis, notices, data-subject processes, media-system linkage, incident reporting, cross-border transfer rules and retention/destruction. Append-only competition evidence may conflict with ordinary deletion requests; that conflict requires legal and policy resolution before deployment.
