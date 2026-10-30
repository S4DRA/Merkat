# Local DM/group 503 repair

October 30, 2026. Scope: the latest local-only brief. No production/staging
database was contacted or modified during this repair; no deployment was made.

## Local startup and optional realtime follow-up

The subsequent `EADDRINUSE 127.0.0.1:59312` was the saved local PostgreSQL
port still being occupied. Startup tried to reserve that port unconditionally.
The new owned runtime record prevents a second launcher from starting another
instance. If the launcher has exited but PostgreSQL remains, startup authenticates
to the saved loopback connection and checks `SHOW data_directory` against the
owned cluster before reusing it. It never kills or adopts an unknown service,
changes credentials, deletes cluster data, or substitutes a different database.

The latest attached browser log concerns `/api/direct/realtime`, separately
from DM/group lists. Ordinary local mode intentionally has no Supabase Broadcast
configuration, but the capability endpoint treated that expected state as 503.
It now returns authenticated, no-store availability information:
`200 { available: false, reason: "NOT_CONFIGURED" }`. The client opens no socket
and preserves the existing unavailable label. Invalid/partial configuration and
actual database failures remain 503; absent/expired authentication remains 401.
Configured signed capabilities and private-channel authorization are unchanged.

Actual launcher checks passed for an already-running app (a second `npm run dev`
exits 0 with its URL), a stale launcher record, and an independently running
copy of the same owned cluster (startup prints that it is reusing the verified
database). No database reset was performed. An initial attempt to reproduce an
orphan by stopping the process tree also stopped PostgreSQL; that attempt was
not counted as evidence of reuse. The existing cluster was then started with
its bundled `pg_ctl`, and the successful reuse branch was observed directly.

Real authenticated localhost checks return **200** for both lists and explicit
disabled realtime, with **zero browser page errors and zero realtime 503s**.
Opening an existing DM shows **Live unavailable**. All three saved sessions,
two original DM messages and three group messages remain valid after the app
and database restarts. Evidence stays ignored in
`artifacts/launcher-browser-verification.json`,
`launcher-persistence-verification.json` and `duplicate-local-launch.log`.

Regression coverage adds four launcher/real-PostgreSQL tests for active-instance
reuse, stale-record recovery, unknown-record preservation and authenticated
data-directory verification (including wrong-directory and wrong-password
rejection). HTTP regressions distinguish disabled realtime, invalid configuration,
authentication failure and a real database outage. The browser unavailable-state
regression covers the disabled payload and verifies that no socket is created;
this mocked availability case is client regression coverage, not the real-HTTP
acceptance evidence above.

Files changed in this follow-up:

- `scripts/dev-local.mts` and new `scripts/local-runtime.mts`: instance ownership,
  safe port handling and verified database reuse.
- `packages/contracts/src/messaging.ts`, `apps/web/src/lib/server/http-api.ts` and
  `apps/web/src/components/chats/use-direct-realtime.ts`: explicit disabled
  realtime availability and its existing UI state.
- `tests/integration/local-runtime.test.ts`, `tests/integration/messaging.test.ts`,
  `tests/integration/list-http-recovery.test.ts`, `tests/support/run-integration.ts`
  and `tests/browser/messaging.spec.ts`: regressions described above.
- `README.md`, `MERKAT_LOCAL_503_REPORT.md` and `MERKAT_TEST_RESULTS.md`: startup
  behavior, evidence and verification limits.

No schema, dependency or visual design changes.

## Root cause

The old root `npm run dev` built packages and started only Next.js. Next loaded
`apps/web/.env.local`, which selected the hosted, six-migration database already
identified in the earlier investigation. Starting HMR did not start PostgreSQL or
apply the groups/privacy migration. That is why frontend adjustments/restarts did
not repair either conversation list.

`apps/web/src/app/api/[...path]/route.ts` delegates to the shared HTTP adapter.
`direct/list` calls the messaging repository, which now queries `UserBlock` when
reading existing DMs. `groups/list` queries the new group tables. The missing
schema throws Prisma errors, and the adapter's safe failure boundary converts
those errors into HTTP 503 `{ "error": "SERVICE_UNAVAILABLE" }`, with no-store
headers. Username discovery also needs the three new quota columns.

The earlier timeout improvements and ColorZilla diagnosis addressed separate
failures. They could not create the missing database objects.

## Fix and data boundaries

- Root `npm run dev` now uses the existing owned local-development launcher,
  exactly like `npm run dev:local`. It builds packages, starts persistent
  PostgreSQL, applies the seven committed migrations only to its recognized
  loopback cluster, and starts Next at `http://localhost:3000`.
- `npm run dev:web` preserves the old Next-only behavior for a deliberately
  configured custom local/staging environment. It never migrates that target.
- Existing hosted environment files/credentials were preserved. The local
  launcher overrides database, origin and authentication settings and disables
  hosted realtime configuration in the child process. It does not adopt a
  database URL from environment files for migration.
- Existing local data was retained. Local and hosted accounts are separate;
  use a local sign-in or register a local account after switching startup modes.
- Group inbox success callbacks now check cancellation before replacing state,
  matching the existing error path and DM list cleanup. Strict Mode remains on.

No Prisma schema, committed migration, navigation, visual identity or messaging
architecture was changed. No fake conversations or empty-success fallbacks were
introduced. The development PostgreSQL directory was checkpointed/stopped using
its bundled `pg_ctl`, then the same app/database were restarted without reset.

## Real verification

- The owned local cluster reports **7 completed migrations**, with both group
  and privacy tables present. Loopback works on this machine; the old sandbox's
  EACCES restriction does not apply.
- Three actual username/password registrations were exercised through local HTTP
  during the initial acceptance runs. Final local acceptance reused three real
  credential-service fixture sessions to preserve the HTTP registration quota;
  no limiter was reset or disabled. All fixtures live only in local/test data.
- Real HTTP returns **200 for both list endpoints** using three authenticated
  accounts. The browser journey verifies a deduped DM, two-direction messages,
  explicit group invitations/acceptance, three members and three group messages,
  and persisted conversation/history after page reloads. No HTTP success response
  or websocket notification is mocked.
- After a real local PostgreSQL/app restart, saved session cookies remained valid,
  both lists still returned 200, and the original two DM/three group messages and
  browser group lists remained present for all three users.
- A real local HTTP-server regression verifies missing/expired sessions return
  **401**, actual unavailable-database connections return **503**, and restoring
  database availability restores **200 with the original persisted data**.
- The browser regression additionally injects network failures (aborted requests,
  not fabricated responses) to exercise DM Retry and group Retry. It checks the
  unsent composer draft survives DM-list failure and recovery.

Private session snapshots and evidence are ignored under
`artifacts/local-acceptance/`, `local-acceptance-browser.log`,
`local-restart-verification.json` and `local-fix-*.log`. Do not publish them.
Initial acceptance-test failures were corrected API-envelope/status expectations
and an ambiguous text selector; the expired-session fixture was corrected to
respect the existing creation/expiry constraint. No checks were weakened.

## Commands

Final quality results for this repair:

| Check                                    | Result                                                            |
| ---------------------------------------- | ----------------------------------------------------------------- |
| Lint                                     | PASS, zero warnings                                               |
| Workspace and test/script types          | PASS                                                              |
| `npm test`                               | PASS: 72 integration + 2 reference API tests, zero failures/skips |
| `npm run build`                          | PASS, optimized Next production build                             |
| Full browser suite                       | PASS: **54 passed (2.7m)**                                        |
| Actual localhost:3000 three-user journey | PASS, real local HTTP/database; no mocked success responses       |
| Owned PostgreSQL + app restart           | PASS, sessions and original messages retained                     |

Files changed: root `package.json`/`README.md` (safe default startup and explicit
Next-only alternative); `group-list.tsx` (cancellation guard); Playwright config
and browser fixture setup (loopback-only live acceptance and three users);
`local-messaging.spec.ts` and `list-http-recovery.test.ts` plus the integration
runner (real persistence/outage/retry coverage); this report and the three main
implementation/test/readiness reports (current evidence and local scope).

```powershell
npm run dev
```

Open `http://localhost:3000`, sign in/register locally. Ctrl+C stops the launcher;
the local database files remain for the next run. Use Node 22.17+ in the Node 22
line and npm 11, matching the repository's engines.

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:ui -- --reporter=line
```

`tests/browser/local-messaging.spec.ts` runs in the normal isolated HTTPS browser
suite. To run it against an explicitly started local app, set
`MERKAT_ACCEPTANCE_ORIGIN=http://localhost:3000` and select that file; the override
rejects non-loopback targets. Repeated real registration consumes real quotas.

## Limits

Private Supabase Broadcast is intentionally unavailable in ordinary local
PostgreSQL mode. The UI shows Live unavailable. Persistent HTTP messaging,
receipts, membership and focus/online reconciliation remain real. Existing
mock-transport regression tests verify the preserved client lifecycle, but they
do not prove hosted private websocket delivery. No production access is needed
to fix this local startup problem. Configure isolated Supabase staging separately
for actual cross-device realtime acceptance.

The dev server and owned local PostgreSQL remain running on port 3000 at handoff.
The final validation results and commit are recorded in the main test/report
files and the handoff message.
