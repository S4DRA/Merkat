# MERKAT implementation report

## Current result: local-only 503 repair

The latest user brief changes this task's boundary to isolated local development.
The normal dev command now starts the existing owned, persistent, fully migrated
PostgreSQL launcher instead of using the hosted environment file. Actual local
HTTP/browser checks and a PostgreSQL/app restart confirm real DM/group lists and
history persist. See `MERKAT_LOCAL_503_REPORT.md` for exact root cause, files,
configuration boundaries, regression evidence and reproducible commands.

The production discussion below is historical context, not a pending prerequisite
for this local fix. Production was not contacted or modified in this repair.

October 30, 2026. Scope: diagnose and repair the production Retry failures reported
for chats and groups, using the attached mobile/calendar brief as preservation
and architecture context. The user clarified the observed failure during the audit.

## Repository and release identity

- Working checkout: `D:\Github Repo\Conduit\Merkat`.
- Fix branch: `fix/production-chat-group-loading`; baseline `6ea62ba`.
- Vercel confirms production uses baseline `6ea62ba`, not the brief's `a481829`.
- Inspected the separate recovered `new-chat/work/merkat-audit` checkout at
  `a481829`, including all three requested existing reports. It has no remote and
  contains additional unreleased features/migrations. It was not edited or merged.
- Full SHA for this repair is available with `git rev-parse HEAD`; a report cannot
  embed its own commit hash without changing that hash.

## Findings and changes

**VERIFIED WORKING diagnosis:** production logs reproduce the reported affected
endpoints. The configured Supabase project database lacks the existing seventh
groups/privacy migration. A real local regression reproduces all three HTTP 503s
from that exact schema gap and proves the existing migration plus runtime SQL
restores HTTP 200s and preserves old messages.

**IMPLEMENTED, NOT LIVE-VERIFIED:** added `npm run db:check-runtime`, a read-only
schema/role check derived from the generated Prisma scalar enums. It catches
missing tables/columns, missing runtime grants/RLS policies, disabled RLS,
application ownership/elevated roles and readable private reports. It does not
require access to private data or migration metadata. It is an operator release
gate, not an automatic Vercel build hook.

**IMPLEMENTED, NOT LIVE-VERIFIED:** server failures now log the validated endpoint
and an allowlisted error code. Responses remain generic/no-store; exception
messages, metadata, request bodies and arbitrary Matrix paths are not logged.

**VERIFIED WORKING locally:** added the real old-schema recovery test to the normal
integration suite and extended the owned local database harness to start without
automatically migrating only when requested by that test. Existing tests retain
their default fully migrated setup.

Documented the exact existing migration/runtime repair and its approval/access
requirements in `infra/deployment/PRODUCTION_RECOVERY.md`; corrected the release
instructions that still described only six migrations.

## Files changed

| Files                                                                                              | Purpose                                                                                |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `apps/web/src/lib/server/http-api.ts`, `request-failure.ts`                                        | Safe route/error-code diagnostics                                                      |
| `packages/database/src/runtime-readiness.ts`, `index.ts`                                           | Read-only schema/runtime-role check and export                                         |
| `scripts/check-runtime-database.mts`, root `package.json`                                          | Operator CLI and npm command                                                           |
| `tests/integration/production-recovery.test.ts`, `tests/support/postgres.ts`, `run-integration.ts` | Real old-schema upgrade regression, isolated fixture option and normal-suite inclusion |
| `infra/deployment/README.md`, `PRODUCTION_RECOVERY.md`                                             | Corrected seven-migration release gate and exact repair runbook                        |
| Five root `MERKAT_*.md` reports                                                                    | Findings, current results, readiness and scoped UX/PWA inventories                     |

## Preserved scope

No product screens, logos, navigation, messaging architecture, dependencies,
Prisma schema or committed migrations were changed. No production data or
infrastructure was modified, no deployment/push was made, and the recovered
checkout remains untouched. The attached brief's new gestures/calendar/PWA work
has not been silently imported into this production hotfix.

See `MERKAT_TEST_RESULTS.md`, `MERKAT_UX_AUDIT.md`,
`MERKAT_PWA_VERIFICATION.md` and `MERKAT_PRODUCTION_READINESS.md` for evidence and limits.

## Follow-up: P2028 and session connection failures

The user approved the production migration/runtime repair, then supplied local
Next logs showing transaction acquisition failing at 2 seconds, missing schema
and a 5-second connection failure during session lookup. Supabase is still not
connected, so approved production execution remains blocked on owner access.

Real local PostgreSQL/TCP fault tests were added before changing behavior. All
three initial regressions failed: a 2.3-second handshake was rejected by Prisma's
2-second default, a dropped session read failed instead of reconnecting, and a
persistent outage made only one attempt. The fixes align transaction acquisition
with the existing driver deadline and retry only the read-only session lookup
once on known transient transport errors. Retries check current expiry; schema,
authorization and transaction failures remain errors and writes are never replayed.

Additional files: `packages/database/src/client.ts`, `account-repository.ts`,
`connection-errors.ts`, `tests/integration/database-connections.test.ts`, the
integration runner and the three implementation/test/readiness reports plus the
recovery procedure. No schema, environment, pool size/mode, UI or branding edits.

The shared package has been rebuilt. A running dev server needs a restart to
replace its cached Prisma client. Production source has not been deployed; the
production database is unchanged until owner access becomes available.
