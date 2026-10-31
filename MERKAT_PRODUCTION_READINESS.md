# MERKAT production readiness — 31 October 2026

Decision: DO NOT RELEASE YET. Production release is authorized by the owner after the required gates pass; the current gates have not passed.

Cost constraint: FREE SERVICES ONLY. Do not upgrade plans or provision paid workers, branches or add-ons. The separate staging project was quoted at $0/month. Branching requires Pro and was not provisioned.

## Current production

Vercel project merkat, prj_ASSoFknfhPWidqclpEtXvTJ7jvit.
Canonical observed alias: https://merkat-umber.vercel.app
Current production deployment: dpl_BPQ4xQDRopDAwjcpKQXnogTBBxPp.
Production commit: 6ea62ba1d04f7627914c30d198c2953ed955626e.

Newer deployments are Preview deployments. No Preview was promoted and main was not merged or reset.

## Release gates

| Gate | State |
|---|---|
| Existing source/history preserved and remotely backed up | PASS |
| Current runtime dependency high/critical findings | PASS: runtime audit clean |
| Real isolated PostgreSQL migrations/services | PASS in CI |
| Final isolated browser and component acceptance | PASS: 61 browser tests, 40 component checks |
| Production TLS configuration and authenticated Prisma query | BLOCKED |
| Production backup and practical isolated restore | BLOCKED |
| Production schema compatibility | FAIL: six of fifteen migrations applied |
| Correct restricted runtime role and final grants on staging | INCOMPLETE |
| Isolated staging HTTPS login, DM/group/calendar/tab journeys | BLOCKED |
| Hosted private Broadcast with three real clients | BLOCKED |
| Operational durable reminder execution and push | BLOCKED |
| Physical mobile installation/device notification acceptance | NOT VERIFIED |

## SSL diagnosis and required repair

The reported exception is a configuration contradiction, raised before opening a database connection by packages/database/src/environment.ts.

With DATABASE_CA_CERT present, the existing DATABASE_URL must contain exactly one sslmode=verify-full and no sslrootcert. A remote production URL also cannot override host through a query parameter. packages/database/src/client.ts passes parsed connection fields and an explicit trusted CA with rejectUnauthorized=true to the Prisma PostgreSQL adapter.

The validator was not weakened. The trusted CA is parseable and not expired, but endpoint chain/name compatibility is not established. The actual Production URL is stored as a non-readable sensitive secret, so which conflicting parameter exists cannot be independently identified or safely rewritten here. Preserve its database, username, password, host and port when correcting only reviewed TLS parameters.

After secure configuration, verify a real restricted-role Prisma query and npm run db:check-runtime, then authenticated production requests and runtime logs. An empty recent log search or a successful build is insufficient.

## Database plan

Production is ejsqjkstyrzddrxydrwq. Staging is sclhbqsprowujdmyonsc. Never run test suites against production.

Before production DDL: obtain and validate a restorable backup, record migration checksums/state and existing-data counts privately, and rehearse the upgrade on an isolated restoration. All nine pending migrations require review, not merely the earlier groups migration. Apply through the privileged migration connection, then the reviewed Supabase runtime permission/invalidation setup. Normal requests must use merkat_runtime, not postgres or a migration owner.

The migrations are mainly additive, but include foreign keys, backfill/subscription changes and immutable-history triggers. Review existing rows, lock duration, defaults and old/new writer compatibility before rollout. Do not migrate during application startup/build. Do not reverse migrations destructively.

## Hosted setup still required

- Complete Supabase's confirmation for staging group/privacy grants. It expired twice; no attempt was made to evade confirmation.
- The recovery branch now has its own sensitive staging DATABASE_URL, AUTH_RATE_LIMIT_SECRET and CA. Verify a real authenticated Prisma connection; the earlier global Preview environment lacked these values.
- The recovery branch now overrides realtime URL/publishable key with the separate staging project. Import its signing key before hosted Broadcast testing. Other generic Preview scopes originally shared production realtime settings.
- Import/verify the authorized ES256 signing key and private Broadcast configuration. No Supabase Auth replacement.
- Configure an authorized free scheduled execution path or free persistent worker and prove queue health, retries, cancellation and restart behavior. A Vercel handler is not an always-running worker.
- Supply push configuration only if physical delivery will be tested; distinguish an inbox record, provider acceptance, and actual display.

A protected staging build is READY at https://merkat-rhkffbdcu-s4dras-projects.vercel.app (dpl_DmVuj5EnWw5ZFN85J7e3NA6u5Wvc). Its API target is staging; it has not passed authenticated acceptance. Automatic review rejected creating a bearer share link. Use authorized private SSO access, or obtain explicit owner approval before making a share link. Do not disable Deployment Protection.

## Rollout and rollback

Release only the reviewed development-plus-repair candidate after all critical gates pass. Use the existing GitHub/Vercel project and production environment. Verify the actual production commit, aliases, restricted-role health, real owner login, existing conversation reads and safe authorized writes. Monitor errors and queue health.

Keep dpl_BPQ4xQDRopDAwjcpKQXnogTBBxPp available for application rollback. Confirm the old application remains compatible with applied schema changes before switching traffic back. Preserve data and additive schema; never automatically down-migrate or reset production.
