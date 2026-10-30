# MERKAT test results

October 30, 2026, Europe/Istanbul. Baseline `466a2ac`; continuation branch `new-chat/work/merkat-audit`. These results are from the continuation run, not the historical Phase 6 report.

## Result summary

| Check                                | Command / evidence file                                                                                     | Observed result                                                                                           |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Shared packages                      | `scripts/build-sandbox.ps1`; `packages-verification.txt`                                                    | PASS, Prisma generated and contracts/backend/database compiled.                                           |
| Unit tests                           | `npm run test:unit`; `unit-verification.txt`                                                                | PASS: 11 tests, zero failures/skips.                                                                      |
| Reference API tests                  | `node --conditions=react-server --import tsx --test apps/api/src/app.test.ts`; `reference-verification.txt` | PASS: 2 tests, zero failures/skips.                                                                       |
| All workspace types                  | `npm run typecheck --workspaces --if-present`; `types-verification.txt`                                     | PASS: API, web route types, worker and shared packages.                                                   |
| Final affected web/test types        | `tsc -p apps/web/tsconfig.json --noEmit`, `tsc -p tests/tsconfig.json`; corresponding text evidence         | PASS, including new service and browser scenarios.                                                        |
| Lint                                 | `eslint . --max-warnings 0`; `lint-verification.txt`                                                        | PASS, zero warnings.                                                                                      |
| Schema                               | `npm run db:validate`; `schema-verification.txt`                                                            | PASS, Prisma 7.10.0.                                                                                      |
| SQL migrations and persistence       | `npm run test:sql:offline`; `sql-verification.txt`                                                          | PASS, 14 exact SQL migrations, integrity assertions and second-process persistence checks.                |
| Component/browser QA                 | `npm run test:components`; `components-verification.txt`                                                    | PASS: 40 checks, zero browser errors, 28 internal screenshots. Explicit mocked HTTP and Next adapters.    |
| Optimized web build                  | `next build --webpack`, Node 22.17.0, Next 16.4.1; `build-verification.txt`                                 | PASS without import warnings; 12 static pages generated and dynamic routes compiled.                      |
| Worker build                         | `npm run build -w @merkat/worker`; `worker-verification.txt`                                                | PASS. This does not mean a hosted worker is operating.                                                    |
| Compiled liveness handler            | In-process call to built Next route; `compiled-route-verification.txt`                                      | PASS: status 200 and expected JSON; in-process, not an HTTP network test.                                 |
| Full service integration             | `node --import tsx tests/support/run-integration.ts`; `integration-verification.txt`                        | BLOCKED, nonzero exit before database startup: loopback connect EACCES. Zero feature-test passes claimed. |
| Full real browser suite              | `npm run test:ui -- --reporter=line`; `browser-verification.txt`                                            | BLOCKED, nonzero web-server setup exit from the same database preflight. No end-to-end pass claimed.      |
| Clean dependency install / remote CI | Manual workflow provided                                                                                    | NOT RUN. Existing installed dependencies were used; CI must verify npm ci.                                |

Text evidence is included under `docs/verification/2026-10-30/` in the source archive. Empty successful type/lint logs are accompanied by this recorded result table. Historical tests and prior mocked transport results are not added to these counts.

Browser collection also passes: `npm run test:ui -- --list` discovers 54 tests in 10 files. This is collection only. The new browser test uses an existing PNG fixture instead of importing sharp into the Playwright collector, avoiding a Node module-loader failure discovered during collection.

## Exact key output

```text
Unit: tests 11; pass 11; fail 0; skipped 0
Reference: tests 2; pass 2; fail 0; skipped 0
{"componentChecks":40,"browserErrors":0,"transport":"Explicit mocked HTTP; not live end-to-end verification"}
{"migrations":14,"engine":"PostgreSQL single-user mode","migrationAndConstraintChecks":"PASS","networkConnections":0,"persistedAcrossPostgresRestart":true}
Error: TEST_ENVIRONMENT_BLOCKED: loopback unavailable (EACCES). Real service tests did not run.
```

The loopback probe used an ephemeral server owned by this run and a client connecting to that server. Listening succeeded; connecting was rejected. No production host, database credentials or hosted account were involved. The integration/browser failures are environmental blockers, not evidence that the application behavior passed or failed.

## What passed at each layer

### Native unit/reference layer

The spending example yields 135,000 minor units total, consumption A=50,000/B=55,000/C=30,000 and B/C repayments to A after A pays the venue. Pending consent is excluded. Remainders and quantity allocations reconcile deterministically. Decimal-comma parsing avoids floating-point money calculations. Time conversion rejects invalid calendar dates and nonexistent/ambiguous DST wall times.

Actual sharp decoding/normalization handles PNG/JPEG, strips metadata and enforces format, size and dimension limits. An exactly 2,000,000-byte valid JPEG input is accepted and 2,000,001 bytes is rejected; a small encoded image wider than 8192 pixels is rejected. Missing push configuration returns unavailable/zero attempts without database I/O or a delivery claim. The two reference checks cover liveness and safe invalid configuration.

### Real PostgreSQL, without sockets

Fresh private cluster; all 14 committed SQL migrations executed against native PostgreSQL. Assertions cover new-table RLS and browser privileges, avatar/theme constraints, reminder uniqueness, one active tab, immutable closed orders/snapshots, scope FKs, cross-conversation reference rejection, push session identity and single-use recovery mutation.

The first process exits. A second PostgreSQL process opens the same data directory and verifies stored users, the closed tab snapshot, used recovery code and runtime-role avatar access. This proves actual disk persistence for those SQL fixtures. It does not verify Prisma's socket adapter, the application API, concurrent transactions or authenticated browser behavior. Single-user mode is not a concurrent service.

### Component/browser layer

Real React product components/CSS rendered in Chromium at 390px and 1440px in light/dark themes; additional tab overflow checks at 320/768/1024px with larger text. Checks include theme controls, OS system-theme changes, reduced-motion and larger-text settings, oversized upload rejection before sending, event creation/invitation payloads, solo-order edit UI and Escape/focus return on profile dialogs.

The harness intercepts HTTP and adapts Next navigation/image primitives. No mocked result is counted as a successful API/database call. These checks do not certify contrast compliance, screen-reader behavior, physical-device safe areas, live realtime or notification display.

## Real-service scenarios implemented but not executed

`tests/integration/collaboration.test.ts` uses real registered users and actual repositories against its own fresh database. It never resets quotas or adopts a hosted URL. Coverage now includes private avatar persistence/removal, outsider denial, saved preferences across independent clients, logout subscription cleanup, retry-safe two-way DMs, three-user ordered group history, invitation response, Maybe/Going subscription, 24/5-hour jobs, concurrent/reconstructed workers, dedupe, edit/cancel rescheduling, personal-plan sharing, consent/decline/rounding, stale-version concurrent edits, idempotent retries, venue payment/repayment confirmation, closed history, member removal and password/recovery/session invalidation.

`tests/browser/collaboration.spec.ts` adds three separate authenticated contexts using actual HTTP routes and database-backed fixture sessions. It tests PNG upload/reload, oversized rejection, group invitation acceptance, persisted group messages after reload, calendar RSVP/list synchronization, event deep link, shared-expense consent and exact rounding, payment/closure/history and cancellation. It contains no HTTP response mocks. Existing password-auth browser tests cover registration/login without email, phone or OTP verification. The local browser fixture has no real Supabase service; even in a normal run, reload persistence is distinct from hosted live delivery.

The suites are type-checked, not runtime-verified here. Potential failures on an unrestricted runner must be investigated; the presence of an assertion is not proof it passes.

## Reproduction and next execution

Use Node 22.17+ within Node 22 and npm 11. On a normal private checkout:

```sh
npm ci
npm run build:packages
npm run lint
npm run typecheck
npm run db:validate
npm run test:unit
npm test
npm run build -w @merkat/web -- --webpack
npm run build -w @merkat/worker
npx playwright install --with-deps chromium
npm run test:ui
npm run test:components
```

The manual `.github/workflows/release-verification.yml` carries these checks, without production secrets or deployment. It was not remotely dispatched. The isolated runners create their own databases; do not replace their URLs with production connections.

This managed Windows host denies workspace junctions and nested asynchronous build-directory creation. Verification therefore used existing copied workspace packages, synchronized builds, the scoped `sandbox-fs.cjs` mkdir adapter, `MERKAT_BUILD_DIR=.next-handoff` and cache disabled for copied packages. The preload only affects that generated directory and is not part of application runtime. Normal npm-linked workspaces do not use these overrides. Default Turbopack and a clean npm ci remain unverified in this host.
