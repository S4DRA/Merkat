# Product database boundary

Approved: PostgreSQL with Prisma. No provider-specific Supabase APIs or Supabase Auth dependency.

Phase 3 uses Prisma 7.10 with the PostgreSQL driver adapter. Schema and the initial migration are under `prisma/`; generated client files are ignored and rebuilt with `npm run build:packages`. Prisma CLI tooling is pinned at the workspace root. Root overrides pin patched CLI transitive dependencies (deepmerge-ts and mysql2); generation and migration tests verify compatibility. MySQL is not used by Merkat.

`createDatabase` validates DATABASE_URL and creates a bounded PostgreSQL pool. Next reuses it lazily through guarded server-only modules; browser/contracts imports remain prohibited. Repository ports implement account and existing plan persistence. Migration tooling uses DIRECT_URL when supplied, otherwise DATABASE_URL. Export CLI variables; this package does not load `.env` files. Supabase uses pooled runtime and direct/session migration connections; see [environment setup](../../docs/architecture/environment.md).

Run `npm run db:validate` to validate the schema and `npm run db:migrate` to deploy pending migrations to your explicitly configured database. No existing/cloud database has been migrated during development; tests use fresh isolated clusters. Never add Matrix message history here.

Phase 4 adds `PasswordCredential` (one Argon2id hash per permanent user UUID) and
`AuthRateLimit` (bounded persistent counters with atomic upsert and database-clock
expiry). Registration creates user/profile/credential/session atomically. Login
rechecks active account, current username and verified credential under row locks
before issuing a session. The two earlier migrations stay unchanged. Apply the new
migration only to a reviewed local/staging target; no production database was used.

The explicit lower(username) unique index supplements the existing lowercase CHECK
and unique username constraint. Reserved-name enforcement is NOT VALID for existing
rows, avoiding a destructive rewrite; new/updated rows are checked. Review legacy
reserved names before separately validating that constraint in a future migration.
New auth tables enable RLS and revoke PUBLIC privileges. Inspect Supabase Data API
exposure/role grants in staging; credentials must never be browser-readable.
