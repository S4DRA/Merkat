# Shared contracts

Client-safe transport types and runtime request/response validation belong here as APIs are implemented. The current opaque ID type does not authenticate or validate arbitrary strings. Only the backend may assign IDs after authoritative lookup.

No Prisma models, environment access, credentials, domain orchestration, or provider SDKs. Do not expose internal database rows as API responses.
