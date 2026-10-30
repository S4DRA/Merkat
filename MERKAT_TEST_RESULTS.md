# MERKAT test results

## Latest local startup and optional realtime follow-up

The saved local PostgreSQL port was already occupied. Startup now recognizes an
active launcher and safely reuses an independently running owned database only
after authentication and an exact data-directory check. Fully unconfigured local
realtime returns explicit disabled availability; incomplete configuration and
actual database outages still fail, and authentication remains required.

Final commands on Node **22.17.0**, npm **11.4.2**:

| Command                                            | Result                                                      |
| -------------------------------------------------- | ----------------------------------------------------------- |
| `npm run lint`                                     | PASS, zero warnings                                         |
| `npm run typecheck`                                | PASS, workspaces and test/script types                      |
| `npm test`                                         | PASS: **72 integration + 2 API tests**, zero failures/skips |
| `npm run build`                                    | PASS, optimized production build                            |
| `npm run test:ui -- --reporter=line`               | PASS: **54 passed (2.7m)**                                  |
| Changed-file Prettier check and `git diff --check` | PASS                                                        |

Real localhost browser/HTTP checks return 200 for DM lists, group lists and
disabled realtime availability, show the existing unavailable label, and report
zero page errors/realtime 503s. Three saved sessions and the original two DM/three
group messages survive the database/app restart. A second launcher exits 0 with
the current URL. See `MERKAT_LOCAL_503_REPORT.md` for files and exact evidence.

One initial integration run returned `TRY_LATER` in the existing concurrent
friendship registration fixture (71 passed, 1 failed). The unmodified fixture
passed on subsequent fresh-database runs, including the final supported-Node
run; its intermittent limiter failure was not reproduced. An initial local
browser probe selected a thread-only status on the inbox; selecting the saved
conversation corrected the probe without an application UI change.

Final logs are ignored under `artifacts/launcher-final-{lint,types,tests,build,browser}.log`.
Live Supabase Broadcast is unconfigured locally. Existing mock-socket lifecycle
regressions pass, but hosted websocket delivery remains unverified. No production
database contact, deployment, schema reset or dependency changes were performed.

## Previous local-only 503 repair

Current scope and detailed evidence: `MERKAT_LOCAL_503_REPORT.md`. Real local
acceptance returns 200 from DM/group lists using three accounts, and a full owned
PostgreSQL/app restart preserves sessions, two DM messages and three group messages.
The new real HTTP regression covers 401 for expired/absent sessions, 503 for an
unavailable database, then recovery to persisted 200 results.

Current final run: lint and typecheck pass; `npm test` passes **68 integration + 2
API tests** with zero failures/skips; optimized production build passes. The full
browser run passes **54 tests (2.4m)**, including the new three-user persistence,
Retry and draft-preservation regression, recorded under
`artifacts/local-fix-browser.log`. Earlier results
below remain separately labeled history and do not replace this local acceptance.

October 30, 2026, Europe/Istanbul. Current run on
`fix/production-chat-group-loading`, baseline `6ea62ba`. Node **22.17.0**, npm
**11.4.2**, existing locked dependencies. Results from the other recovered
checkout are not included in these counts.

## Latest connection-error follow-up

The user's additional logs were traced through Next's session guard, the real
account repository, Prisma 7.10's installed transaction defaults, and the actual
pg driver. The configured hosted database responded to read-only probes while
`ChatGroup` was still missing. No hosted writes or environment changes were made.

| Current check                        | Result                                                            |
| ------------------------------------ | ----------------------------------------------------------------- |
| `npm run typecheck`                  | PASS, all workspaces and test/script types                        |
| `npm run lint`                       | PASS, zero warnings                                               |
| `npm test`                           | PASS: **67 integration tests + 2 API tests**, zero failures/skips |
| `npm run build`                      | PASS, optimized Next production build                             |
| `npm run test:ui -- --reporter=line` | PASS: **53 passed (2.4m)**, zero failures                         |
| Approved production migration        | BLOCKED only on owner-capable access; approval has been received  |

Before changing runtime behavior, three new real TCP/PostgreSQL regression tests
failed against the baseline (62 existing tests passed, 3 failed). A 2.3-second
connection exceeded Prisma's 2-second acquisition default despite fitting within
the driver's 5-second deadline. A dropped session read was not recovered, and a
persistent failure made only one attempt.

After correction, all five connection regressions pass: delayed acquisition,
fresh reconnect for a dropped session read, bounded failure after two attempts,
expiry during reconnect staying unauthenticated, and permanent/schema/auth errors
excluded from retry classification. A test-only nullable URL type error was
corrected before the final successful typecheck. These tests use real local TCP
faults and PostgreSQL, not HTTP mocks. No transaction/write retries were added.

Evidence: `artifacts/connection-baseline.log`,
`connection-final-tests.log`, `connection-typecheck.log`, `connection-lint.log`,
`connection-build.log` and `connection-browser.log`. The rest of this report
preserves the initial schema-repair run separately.

## Initial schema-repair verification

| Command/check                                               | Exact result                                                                                       |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `npm run build:packages`                                    | PASS: Prisma generated; contracts/backend/database compiled                                        |
| `npm run lint`                                              | PASS: exit 0, zero warnings                                                                        |
| `npm run typecheck`                                         | PASS: package builds, workspace typechecks, Next route generation and test/script TypeScript       |
| `npm test`                                                  | PASS: 2 reference API tests + 62 real database/service/HTTP integration tests; zero failures/skips |
| `npm run build`                                             | PASS: optimized Next 16.4.1 Turbopack production build; 9 static pages and dynamic routes          |
| `npm run build -w @merkat/worker`                           | PASS: current worker boundary compiles; this revision has no running durable reminder/push worker  |
| `npm run db:validate`                                       | PASS: Prisma 7.10.0 schema valid                                                                   |
| `npm run test:ui -- --reporter=line`                        | PASS: **53 passed (2.4m)**, zero failures                                                          |
| Runtime schema CLI using existing hosted server environment | EXPECTED NONZERO: exit 1, `ready: false`, nine missing tables and three missing quota columns      |
| Production SQL mutations/deployment                         | NOT RUN: approval and migration-owner access required                                              |

## Root-cause regression

`tests/integration/production-recovery.test.ts` is included in the 62-test suite.
It creates an owned disposable PostgreSQL cluster, applies the first six actual
migrations, models Supabase's SQL contracts, and registers three independent
username/password users using the real restricted backend role. It saves an
existing DM/message before the upgrade.

Observed before the repair:

```text
direct/list  -> HTTP 503; safe diagnostic code P2021
groups/list  -> HTTP 503; safe diagnostic code P2021
people/find  -> HTTP 503; safe diagnostic code P2010
```

The schema checker rejects that state. After the existing seventh migration it
still rejects missing runtime grants/policies. After the exact existing runtime
SQL (also reapplied once), it returns `ready: true` and all three endpoints return 200. Assertions verify original message IDs/history survive, DM retry dedupes,
group invitations remain optional/require acceptance, group sends/history work,
outsiders receive 404, browser roles cannot read messages, application reports
remain unreadable and private invalidation payloads contain no content.

The second added test verifies the error classifier never returns unknown codes,
exception messages or metadata. Both added tests pass; no existing test was
weakened, disabled or converted into a skip.

## Browser evidence and limits

Playwright runs against the actual built Next.js server through local HTTPS and
a real isolated database. It covers registration/immediate entry, login/logout,
session independence/CSRF/throttling, profile changes, friends, new DM/group,
invitations, messages/history/receipts, retries/reconnect, navigation/back,
keyboard/dialog focus, install/manifest assets and responsive widths
320/360/390/430/768/1024/1280/1440, plus landscape/reduced motion where specified.

Tests explicitly labeled mock socket/transport replace Supabase delivery while
retaining real HTTP/database operations. They do not prove hosted private
websocket delivery. Install tests synthesize install events; they do not prove a
physical installation. No production test users/messages were created.

Logs for this run are local/ignored under `artifacts/production-loading-*.log`,
`artifacts/production-recovery.log` and the sanitized
`artifacts/production-runtime-readiness.json`. Playwright screenshots/diagnostics
remain under the existing ignored artifact paths. There were no UI changes that
need new design before/after comparisons.

## Not verified

Live post-migration behavior, exact production database target confirmation with
owner access, production backup/restore, physical Xiaomi/iOS installation,
hosted multi-device realtime, actual push display, the separate recovered
candidate's richer features, and a fresh `npm ci` were not performed here. The
current checkout does not implement the attached new gesture/month-calendar/PWA
update requirements; see the UX/PWA inventories rather than treating these
regression passes as acceptance of those features.
