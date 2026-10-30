# MERKAT implementation report

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
