# MERKAT test results

October 30, 2026, Europe/Istanbul. Current run on
`fix/production-chat-group-loading`, baseline `6ea62ba`. Node **22.17.0**, npm
**11.4.2**, existing locked dependencies. Results from the other recovered
checkout are not included in these counts.

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
