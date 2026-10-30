# Phase 5.5 — autonomous validation

Validation date: October 17, 2026. This report supersedes the validation status in [Phase 5](phase-5-messaging.md), without changing the approved design or starting Phase 6.

**Outcome: Merkat is live at https://merkat-umber.vercel.app. Local checks and actual Vercel Preview + Supabase private messaging pass; all eight production smoke checks pass.** Physical-device acceptance remains pending. Mocked local transport, actual hosted WebSockets and production smoke checks are distinguished. No Phase 6 work was started.

## Status by environment

| Environment                      | Result                                                                                                                                                                                                                                                                                    |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verified locally                 | Real account registration/session handling, two-account persistent messaging, delivery/read receipts, authorization, retry/idempotency, pagination, reconciliation, responsive navigation and composer behavior. Production build and security configuration regression checks also pass. |
| Verified against hosted Supabase | Dedicated `merkat` project `ejsqjkstyrzddrxydrwq`: real private subscriptions, delivery, persistence, receipts, authorization, renewal/expiry, publish denial and catch-up. No mock socket.                                                                                               |
| Verified on Vercel Preview       | **PASS:** 21 real acceptance checks through deployed Linux Next.js functions and hosted Supabase, including three independent accounts, native password verification, ingress, portable CA and responsive UI.                                                                             |
| Verified on Vercel Production    | **PASS:** READY deployment, public canonical HTTPS domain and eight smoke checks, including a real read-only database session lookup. No production account/message mutations. Full messaging acceptance ran on Preview before publication.                                               |
| Verified on physical hardware    | **None.** ADB is installed; `adb devices -l` reports no connected devices. Chromium touch/viewport/keyboard-event checks are emulation.                                                                                                                                                   |
| Blocked or pending               | Physical soft keyboard/IME, hardware scrolling, background/resume and network transitions; long-term uptime, load/connection-budget and forced cold-start measurements. Existing workspace audit/formatting debt remains explicit.                                                        |

## Existing implementation inspected

Read the Phase 5 report and inspected the authoritative Prisma schema/migrations, database environment/client, authentication/session and messaging repositories, same-origin HTTP handlers, capability issuer, private SQL policies/triggers, Supabase SDK integration, reconciliation, conversation navigation/composer, browser fixtures and integration tests.

The architecture remains Next.js App Router on Vercel, PostgreSQL through Prisma, and Supabase private Broadcast invalidations. Message content is fetched through authorized Merkat HTTP endpoints. No Supabase Auth migration, custom production WebSocket server, Redis, paid service or alternative messaging architecture was introduced.

## Correct project and hosted configuration

The latest account login resolved the access blocker. Supabase CLI 2.121.0 lists one project: **merkat**, reference **`ejsqjkstyrzddrxydrwq`**, Frankfurt (`eu-central-1`), created October 16, 2026. Its healthy status and name were checked through the authenticated Management API.

Before writing, `/database/query/read-only` returned `transaction_read_only=on`, UTC, no application tables, no custom roles, zero Auth users/sessions, zero storage buckets/objects, and no Realtime policies. Billing inspection showed no selected paid add-ons. This established a new, empty, dedicated staging target. No billing settings, purchases, existing production data or unrelated projects were changed.

Earlier sessions exposed Conduit (`hxjfypxdqrvcbpnbevne`), confirmed by matching sibling repository references and read-only catalog metadata; it was left untouched. The stale Merkat reference `rauhbsqhtcwppadelbnx` in `infra/local/.env` was not repurposed or modified. Its earlier 403/DNS failures are historical, not current blockers.

Configuration performed only on the new Merkat project:

1. Created separate generated-password `merkat_migrator` and `merkat_runtime` roles. Applied all six existing migrations with Prisma `migrate deploy`; subsequent `migrate status` reports up to date. Disabled migration-role login after setup; ownership is preserved. No Prisma model or historical migration was changed.
2. Required verified TLS to the shared session pooler. The initial untrusted-chain rejection was resolved with the public Supabase Root 2021 CA downloaded from the exact URL used by Supabase Studio. No certificate bypass was used. Database-side SSL enforcement was also enabled. Supabase's required reboot temporarily returned `57P03` (shutting down), then recovered. Post-reboot client certificate verification and both client-to-pooler and pooler-to-database **TLS 1.3** pass; enforcement reports applied successfully. No insecure fallback was used during restart.
3. Set Realtime `private_only=true`. Applied `infra/supabase/realtime.sql` and the new `infra/supabase/server-role.sql`, repeatedly, without widening browser privileges.
4. Imported a generated ES256 private JWK with matching UUID `kid` and activated it in this previously empty dedicated project. Existing default keys were retained. No shared/production signing key was rotated or revoked. Private material remains only in ignored server configuration; no service-role key is used.
5. The runtime has application CRUD policies scoped exclusively to `merkat_runtime`, private function execution and restricted content-free Broadcast INSERT. It has no superuser, BYPASSRLS, database/role/schema creation, table ownership, or migration metadata access. These policies implement the existing trusted-backend architecture; browsers still have no application table access. The administrative `postgres` role can manage migration-owned objects.
6. Security Advisor identified a platform-created `public.rls_auto_enable()` SECURITY DEFINER helper callable by browser roles. Browser EXECUTE was revoked while preserving its event trigger. The final advisor result has **zero ERROR/WARN**, and one INFO for `_prisma_migrations`: RLS enabled with no policy, deliberately denying access.

Management credentials were read from the CLI's documented Windows credential store and held only in process memory. They were not printed or persisted. Identification did not use CLI `db query --linked`, whose preflight can mint a temporary role. SQL request errors were diagnosed before retrying; PowerShell's stalled large-body request was replaced with bounded Node HTTPS requests. Initial generated auth-secret formatting and browser-response observation issues were corrected in the ignored validation harness, without adding an application authentication bypass.

## Actual hosted acceptance evidence

The first full hosted run uses **real hosted PostgreSQL, real Supabase JWT verification/private WebSockets and the built production Next.js app**. Its local HTTPS ingress models Vercel source headers and does **not** by itself prove Vercel. The later independent Vercel Preview run below removes that local ingress and app server. Three independently registered browser contexts act as two participants and an outsider. Passwords are generated, optional email is exercised, and no mock socket is installed.

| Check                    | Hosted result                                                                                                                                                                                                                |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Registration/sign-in     | Real username/password registration, blank/optional email, wrong-password denial, sign-out/sign-in, Secure HttpOnly cookie pass.                                                                                             |
| Delivery/persistence     | Automatic inbox notification, both message directions, read receipts and exact persisted rows after reload pass.                                                                                                             |
| Retry                    | Repeated send with the same client UUID returns the same message ID; no duplicate row.                                                                                                                                       |
| Reconnection             | Browser offline/online restores the live service and catches up a missed persisted message once.                                                                                                                             |
| Notifications            | Actual events contain only Supabase's generated broadcast `id`; no message text, conversation ID or Merkat session identifier. The trigger supplies `{}`, and hosted `realtime.send` adds this metadata.                     |
| Outsider                 | HTTP history/send/receipt each return 404; subscribing to another user's topic returns CHANNEL_ERROR.                                                                                                                        |
| Publishing/public access | Browser broadcast returns `error`, no forged event arrives, and public channel joins are rejected.                                                                                                                           |
| Data API                 | Browser capability cannot read `DirectMessage` through REST: 403.                                                                                                                                                            |
| Token lifecycle          | With no navigation/reconnect, the installed SDK heartbeat obtains a new capability in **76 seconds**, before the original 90-second expiry. Old expired tokens cannot subscribe; a fresh page remains live.                  |
| Session/account status   | A freshly revoked session capability cannot join while still within its expiry. A generated account temporarily suspended for the test loses HTTP list/refresh and fresh subscription access; it is restored before cleanup. |
| UI                       | Navigation hidden inside DMs and restored on Back; approved logo retained; no horizontal overflow at 320/360/390/430/1440px; reduced-height composer remains visible.                                                        |

Only accounts and conversations generated by each validation run are deleted, using their recorded exact UUIDs. Two interrupted harness registrations were also identified by their exact generated username/UUID and removed. At that earlier inspection the application tables contained no users/messages. This is historical, not an assertion about the current production population. Final security checks confirm RLS on every public table, zero browser application-table grants and an unprivileged runtime. Generated-account cleanup always uses the recorded exact UUIDs; shared limiter counters are retained until normal expiry. No default/sample accounts were added. Sanitized evidence is in ignored `artifacts/phase-5.5/hosted-validation-results.json` and `hosted-final-security.json`.

The final focused hosted recovery run passes with **exit 0** after rebuilding the receipt fix and enabling SSL enforcement. Playwright forwards frames unchanged to a real Supabase WebSocket using `connectToServer`; no join, authorization, broadcast or heartbeat response is fabricated. One HTTP receipt failure and one transport close are injected. The actual SDK opens a new upstream connection, joins the real service, catches up the missed persisted message and clears the error without manual Retry. The saved screenshot was inspected. The first focused run passed its assertions but exposed a test-proxy teardown error; its response-error handler was corrected before the clean final run. Final evidence is `hosted-recovery-results.json` and `post-reboot-tls.json`. This controlled transport interruption is not physical-network or service-failover testing.

## Actual Vercel Preview acceptance

The completed Vercel CLI login identifies **s4dra** and the existing Hobby team **s4dras-projects**. Only its **merkat** project, ID `prj_ASSoFknfhPWidqclpEtXvTJ7jvit`, linked to `S4DRA/Merkat`, was configured. No unrelated project, paid plan or billing setting changed.

Project settings: Next.js, root `apps/web`, workspace source outside the root enabled, Node **22.x**, install `npx --yes npm@11.21.1 --prefix ../.. ci`, and build `npx --yes npm@11.21.1 --prefix ../.. run build`. Functions run in Frankfurt **fra1**; the build machine region is separate. Next's output tracing root includes workspace and native Argon2 packages. The final Linux build succeeds without an engine mismatch.

Initially configured six encrypted Preview-only variables: DATABASE_URL, DATABASE_CA_CERT, AUTH_RATE_LIMIT_SECRET, SUPABASE_REALTIME_URL, SUPABASE_PUBLISHABLE_KEY and MERKAT_REALTIME_SIGNING_JWK. The runtime uses the transaction pooler on port 6543 with verified TLS and a portable PEM CA. No signing key or privileged database credential is browser configuration. Upload inspection found **150 files** and no ignored environments, artifact secrets, local databases or node_modules.

The backend classified the first deployment as Production despite explicit `--target preview`. It was canceled while BUILDING, never reached READY, and had no production application credentials. That canceled history remains intact. The subsequent Preview succeeded; this matches a [reported Vercel first-deployment behavior](https://github.com/vercel/vercel/issues/17069). A later pinned-npm rebuild produced the final tested Preview:

- Deployment: **`dpl_FrmXDYnig2JBKZdktTtWUZXdZcMW`**, READY, Preview (API target null).
- URL: https://merkat-9hud779a7-s4dras-projects.vercel.app/register
- Evidence: `vercel-validation-results.json`, **exit 0, all 21 assertions pass**.

Three independently registered browser contexts exercised the actual remote Next.js functions and real hosted Supabase. There was no local app server, simulated ingress or fake socket. Registration with blank/optional email, native Linux password verification, wrong-password denial and Secure HttpOnly sessions pass. Login still succeeds with invalid client-supplied forwarding headers, confirming Vercel supplies the trusted `x-vercel-forwarded-for` used by the server.

Automatic inbox/DM delivery, replies, reload persistence, read receipts, same-client-ID retry, offline/online catch-up, outsider HTTP/topic denial, browser publish denial, public-channel rejection and browser Data API denial all pass. Broadcast payloads contain only Supabase's generated UUID metadata, not conversation content or session identifiers. The SDK renews its capability in **75 seconds**, before the original 90-second expiry, without navigation/reconnect. Fresh revoked and expired capabilities and a suspended generated account cannot subscribe. Responsive widths 320/360/390/430/1440, reduced-height composer, hidden in-thread dock, Back restoration and original white PNG all pass. The saved thread screenshot was inspected. Only the three generated accounts/conversations/messages were removed, by exact UUID, before production publication; limiter counters were retained.

Vercel's existing deployment protection stayed enabled. A single temporary project automation bypass bootstrapped a host-scoped browser cookie; it was never sent to Supabase or used to bypass Merkat authentication. It was revoked after testing. Final inspection found **zero automation secrets**, and unauthenticated Preview access again returned **302** to Vercel authentication. Served registration HTML and **11 JavaScript assets** contained none of the generated private signing key, database password, auth secret or automation secret. The deployment-filtered request-log query returned no 5xx records. The final Supabase Security Advisor still has zero ERROR/WARN. Evidence: `vercel-final-access.json`, `vercel-public-asset-scan.json`, `vercel-request-error-check.json`.

This verifies real deployed startup and function execution. It does not measure guaranteed long-idle eviction, high concurrency, long-term uptime or physical devices.

## Production publication requested by the user

The user explicitly requested “push to production so far and continue.” The existing Merkat backend is therefore used for this initial publication, rather than creating a second project or copying data. It is now production data: further mutating acceptance runs must use isolated local databases or a separately provisioned staging project. Protected existing Preview builds and the local hosted development configuration share this backend; they are not isolated staging environments. No schema, production user/account/message row or signing key was changed during publication.

Seven encrypted Production variables were configured: the six validated server variables above plus explicit **APP_ORIGIN=https://merkat-umber.vercel.app**. Production origin remains explicit; request headers never determine the allowed origin. Deployment was performed from the current workspace through the CLI; no GitHub commit/push is implied.

- Production deployment **`dpl_7HPQ5zkHv2byeKYE5Y28mo9W4Lfr`** is **READY**, explicitly targets Production, runs in **fra1** on Node **22.x**, and serves **https://merkat-umber.vercel.app**.
- Its Linux production build passes using pinned npm 11.21.1, without an engine mismatch. Existing deployment protection is preserved; the canonical production domain is publicly accessible without an automation bypass. Zero temporary automation secrets remain.
- **Eight smoke assertions pass, exit 0:** public HTTPS health; matching READY deployment/domain; a real read-only database lookup rejects a random unknown session; anonymous messaging/capability/friends access returns 401; foreign-origin registration returns 403 before account/limiter writes; hydrated registration with optional email and 320/390/1440 widths; served HTML/11 JavaScript assets contain no configured private material; hydrated sign-in without browser page errors. The registration screenshot was inspected.
- No production account was created, suspended, revoked or deleted, and no production message was sent or changed. The earlier 21 full messaging assertions establish the validated build/backend behavior before publication; these eight production checks do not claim a new two-account production conversation.
- The final production request-log query returned zero 5xx records for the deployment during the queried 30-minute window. Evidence: `production-deploy.json`, `production-final-build.json`, `production-build.log`, `production-smoke-results.json`, `production-register.png`, `production-request-errors.json` under ignored artifacts.

## Local application connection

Created ignored `apps/web/.env.local` with the new project's server-only runtime configuration and trusted CA path. The old `infra/local/.env` remains untouched. The owned Phase 5 local-only web process was stopped; its helper can close its local database normally and the persistent local files are preserved. Merkat now runs at **http://localhost:3000/register** against the dedicated hosted staging database. `/register` returns 200 with enabled username/password registration and no unavailable notice.

For a later restart, run `npm run dev` from the repository using Node 22.17+ on the supported 22.x line. `npm run dev:local` intentionally uses the separate local database and disables hosted Realtime. Accounts from that earlier local database do not automatically exist in the new staging project. Local setup retains its ignored certificate file. Vercel uses DATABASE_CA_CERT with the public trusted PEM; no Windows path is copied into the hosted environment. After production publication, this local hosted configuration shares production data: use `dev:local` for isolated mutating work.

## Defects fixed

The runtime previously accepted a remote production `DATABASE_URL` with no TLS mode, permitting the PostgreSQL driver to connect without requiring encryption. The legacy configuration demonstrates that this omission is possible.

Production now rejects remote database URLs unless they explicitly set exactly one `sslmode=verify-full`. This requires certificate-chain and hostname verification. Production also rejects a `host` query parameter that could override the URL hostname and bypass the loopback classification. Loopback isolated production tests and ordinary development behavior remain supported. The existing pg/Prisma driver architecture, database model, historical migrations and brand assets remain in place.

The regression test covers absent/disabled/preferred/unverified TLS, ambiguous duplicate modes, hostname overrides, valid verified TLS, IPv4/IPv6 loopback and preserved development configuration. Errors do not include connection strings or passwords. The actual hosted TLS check separately verifies the configured CA.

Hosted runtimes can now supply **DATABASE_CA_CERT** as a PEM with exactly one `sslmode=verify-full` and no conflicting `sslrootcert`. The pg adapter receives parsed connection fields and an explicit CA with `rejectUnauthorized=true`, avoiding connection-string reparsing that could overwrite the CA. Local file-based roots remain supported. Regression tests reject missing TLS, conflicting roots and malformed CA configuration without leaking secrets. The actual hosted check accepts the trusted CA and rejects an unrelated CA. The separate migration connection also needs verified TLS.

Preview requests previously had no stable explicit origin before their deployment hostname existed. A strict server-only fallback now accepts only Vercel-provided VERCEL_URL when VERCEL=1 and VERCEL_ENV=preview, with one valid DNS label under vercel.app. Explicit APP_ORIGIN retains precedence; invalid hosts, ports, paths, credentials, query strings and other environments are rejected. Production/custom origins remain explicit. A regression covers the boundary. No request Host/Forwarded header is trusted for origin selection.

The hosted screenshot exposed a second defect: a failed read/delivery receipt left “Couldn't connect” and Retry visible after reconnection had already restored messages and Live status. Receipt errors now have their own state and clear only after a successful receipt. History/loading errors keep their existing behavior. A focused regression injects one receipt failure and verifies automatic recovery without manual Retry. This changes error recovery only; approved geometry, styling, navigation and brand assets remain intact.

## Dependency security review

The initial production-tree audit reported two advisories: `fast-uri` host normalization and `source-map-js` source-map denial of service. The full workspace audit additionally reported two critical findings through `concurrently`/`shell-quote` and other tool dependencies.

Targeted security updates stay within existing compatible ranges; no framework constraint was changed. The database package additionally declares `pg-connection-string` 2.14.0 directly because its existing transitive parser is now imported explicitly; this does not upgrade that parser.

| Dependency          | Before | After  |
| ------------------- | ------ | ------ |
| fast-uri 3.x        | 3.1.7  | 3.1.8  |
| fast-uri 4.x        | 4.1.4  | 4.2.2  |
| source-map-js       | 1.2.1  | 1.2.2  |
| brace-expansion 1.x | 1.1.18 | 1.1.21 |
| brace-expansion 5.x | 5.0.9  | 5.0.12 |
| concurrently        | 9.2.4  | 9.2.5  |
| shell-quote         | 1.9.0  | 1.12.0 |

The updated install was verified before repeating application tests/build. **`npm audit --omit=dev --json` now returns exit 0, zero findings.** This is a dependency database result, not a guarantee that a deployed application has no vulnerabilities.

The full audit returns exit 1 with **six remaining workspace findings: five high findings in the ESLint → fast-glob/micromatch/braces dependency chain and one moderate finding in inactive Fastify**. There are no remaining critical findings. The npm-suggested ESLint remediation downgrades `eslint-config-next` from the approved Next 16 line to 14.2.35; it was not forced. The inactive API's exact Fastify version and code remain unchanged. These findings remain explicit tooling/legacy dependency debt; the full workspace audit is not green. No `npm audit fix --force`, major downgrade or inactive endpoint activation was performed.

## Local evidence

All product-data tests run on freshly generated, isolated, loopback PostgreSQL clusters with UTC timezone and the six existing migrations. They do not use the legacy hosted environment. Test-only real password accounts are created through the authentication service; no application login bypass or seeded user was added.

| Area                                 | Verified locally                                                                                                                                                                                                                                                   | Limit                                                                                                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Independent accounts and persistence | Two separately registered accounts exchange persisted messages; history survives fresh HTTP fetches and browser reloads.                                                                                                                                           | Hosted delivery is independently verified above; physical cross-device delivery remains untested.                                               |
| Delivery/read receipts               | Monotonic, bounded cursors; unread excludes own messages; UI read acknowledgement requires visibility/focus and the bottom of history.                                                                                                                             | Hosted invalidation latency and suspended-device receipt timing are unverified.                                                                 |
| Concurrency/retry                    | One canonical DM pair, exactly two immutable members, ordered concurrent sends, same-client-ID retries without duplication or extra send quota.                                                                                                                    | Hosted pooler latency and Vercel concurrent function behavior are unverified.                                                                   |
| History/reconciliation               | Stable keyset pages, fixed catch-up boundary, no skipped gap after an own send, duplicate notification deduplication, older-page scroll preservation.                                                                                                              | Actual hosted delivery is separately verified above; durable notification retention is not promised.                                            |
| API authorization                    | Outsiders, incomplete onboarding, revoked/expired sessions and suspended users denied; strict inputs, sender identity, origin, body limits, no-store and shared quotas checked.                                                                                    | Actual Vercel trusted ingress replacement is independently verified above.                                                                      |
| Capability security                  | Real ES256 signature, role/purpose/user/session binding, 90-second maximum lifetime, session-capped expiry and no privileged material in the browser DTO.                                                                                                          | Local issuer checks; actual imported-key verification is separately recorded above.                                                             |
| SQL authorization                    | Reviewed setup applied twice to a local contract fixture; wrong subject/session/purpose/topic, Presence, publishing and browser table access denied. A broad permissive policy cannot defeat the restrictive guard; notifications contain no application content.  | The fixture is ordinary PostgreSQL, **not** Supabase Realtime. Actual service authorization and Security Advisor are recorded separately above. |
| Capability renewal                   | A real-time test waits for the installed SDK heartbeat to obtain a fresh capability through the real authenticated endpoint before the original 90-second expiry.                                                                                                  | Socket transport is explicitly mocked.                                                                                                          |
| Socket reconnection                  | The mocked transport is actually closed; the real SDK automatically rejoins and reconciles a persisted missed message without a synthetic notification; reload preserves the message.                                                                              | This is client lifecycle testing, not a hosted outage test.                                                                                     |
| Navigation/responsiveness            | Navigation hidden inside DMs and restored on Back/inbox/other destinations; mobile widths 320/360/390/430 and desktop checks; logo/order and other approved routes retained.                                                                                       | Group conversation screens are not implemented; no group-thread runtime is claimed.                                                             |
| Composer/scroll/keyboard             | Reduced viewport keeps composer visible; touch targets/overflow, older-page position, Back/draft restoration and incoming-message positioning checked. Desktop Enter sends; Shift+Enter and composition do not; coarse-pointer Enter inserts a newline until Send. | No physical IME, Android soft keyboard, browser suspension or device-network transition was tested.                                             |
| Existing behavior                    | Authentication, profile, friends, plans and prior shell/browser regressions retained.                                                                                                                                                                              | Deferred groups/calls/media/recovery are not added.                                                                                             |

Supabase caches subscription authorization. A revoked connected client may receive empty timing hints until its short JWT expires or authorization refreshes; all content API requests recheck the live session immediately. This implementation makes neither instant WebSocket revocation nor end-to-end encryption claims.

## Commands and exact results

Final application commands use supported **Node 22.17.0**. Its executable was resolved through `npm exec --yes --package=node@22.17.0 -- node -p process.execPath`, then used to run npm with that Node directory first in PATH. The final command logs explicitly confirm `v22.17.0`; the host's default Node 24 is not the application test/build runtime.

| Command                       | Final result                                                                                                                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm test`                    | **PASS, exit 0:** 2 reference unit tests and 44 PostgreSQL integration tests; no failures/skips.                                                                                     |
| `npm run test:ui`             | **PASS, exit 0:** all 41 Chromium browser tests passed in 2.2 minutes, including the receipt-error recovery regression. Socket transport tests remain explicitly mocked.             |
| `npm run lint`                | **PASS, exit 0:** zero warnings.                                                                                                                                                     |
| `npm run typecheck`           | **PASS, exit 0:** all workspaces and tests.                                                                                                                                          |
| `npm run db:validate`         | **PASS, exit 0:** Prisma schema valid.                                                                                                                                               |
| `npm run build`               | **PASS, exit 0:** production Next.js build completed.                                                                                                                                |
| `npm run test:unconfigured`   | **PASS, exit 0:** missing-database login/liveness/authorization behavior, with and without APP_ORIGIN.                                                                               |
| `npm run format:check`        | **Exit 1:** the same 78 pre-existing formatting failures (71 bundled skill files, six inactive API reference files and the inactive phone form). Changed active files are formatted. |
| `npm audit --omit=dev --json` | **PASS, exit 0:** zero known production-tree findings after compatible updates.                                                                                                      |
| `npm audit --json`            | **Exit 1:** six remaining tooling/inactive-reference findings (five high, one moderate); zero critical. See the dependency review above.                                             |
| Hosted full validation        | **PASS, exit 0:** actual Supabase acceptance checks above, including a 76-second heartbeat renewal; generated test data cleaned.                                                     |
| Hosted post-fix recovery      | **PASS, exit 0:** actual upstream reconnect, missed-message catch-up and receipt error recovery; generated test data cleaned.                                                        |
| Actual Vercel Preview         | **PASS, exit 0:** all 21 real remote acceptance checks, including 75-second renewal; exact generated data cleaned.                                                                   |
| Actual Vercel Production      | **PASS, exit 0:** READY production build/domain and eight smoke assertions; no production user-data writes.                                                                          |

Logs and sanitized hosted/hardware inspection evidence are under ignored `artifacts/phase-5.5/`. Browser screenshots are under ignored `artifacts/phase-5-*.png`. Capability tokens, generated signing keys and session cookies are never printed in test assertions/output; isolated session fixture files remain ignored test artifacts.

Failures were investigated rather than bypassed: the initial lifecycle test's 75-second deadline coincided with the installed SDK's third 25-second heartbeat; its observation window is now 85 seconds, still before the 90-second expiry. A desktop status selector was narrowed to one visible label. A subsequent lost-response test raced initial history/receipt reconciliation, which legitimately found the committed message and hid Retry; it now waits for initial requests to finish before injecting the dropped response. Those three lifecycle additions required no application changes. The fourth lifecycle regression covers the separate receipt-error correction discovered during actual hosted inspection. The final full browser run passes all four. A further full-suite failure exposed a test-only race: an optimistic message was visible before its real send transaction committed, so a manually emitted mocked notification could arrive too early. Both message directions now await the real successful send response before emitting that mocked event, matching the database-trigger order. The final full suite passes all 41 tests; no product behavior was changed for this harness race.

## Files changed

- `packages/database/src/environment.ts`, `packages/database/src/client.ts`: verified TLS, portable CA validation and parsed pg adapter configuration.
- `packages/database/package.json`: declare the already installed connection parser directly.
- `apps/web/src/lib/environment.ts`, `tests/integration/migration.test.ts`: trusted Preview origin fallback and security regression.
- `apps/web/next.config.ts`: repository-wide output tracing for the monorepo and native dependencies.
- `.gitignore`, `.vercelignore`: exclude Vercel metadata and private/local files from source and deployment uploads.
- `tests/integration/accounts.test.ts`: transport configuration regression coverage.
- `tests/browser/realtime-lifecycle.spec.ts`: timed renewal, transport close/rejoin, receipt recovery, persistence and keyboard behavior checks with explicitly mocked sockets.
- `tests/browser/messaging.spec.ts`: finish initial reconciliation before dropped-response injection; await committed sends before mocked peer notifications.
- `tests/support/mock-realtime.ts`: explicitly mocked lifecycle counters/expiry and close control; no token output.
- `tests/support/browser-server.ts`: two additional isolated real password-account fixtures, independent of the existing logout test.
- `apps/web/.env.example`, `docs/architecture/environment.md`: verified TLS/portable CA, Preview origin and deployment/environment ownership guidance.
- `docs/architecture/phase-5.5-validation.md`: this report.
- `apps/web/src/components/chats/chats-workspace.tsx`: clear a recovered receipt's stale error without clearing history errors.
- `infra/supabase/server-role.sql`: restricted backend permissions, browser revocations and migration metadata protection.
- `docs/architecture/phase-5-messaging.md`: link the historical baseline to this current report.
- `package-lock.json`: compatible targeted security updates listed above.

A before-snapshot of 240 source/configuration files supports the final audit: **20 source/configuration files changed or added, zero deletions; all 28 protected brand/navigation/CSS/schema/migration files remain unchanged**. The chat component changes only receipt-error recovery. Next's generated development type references were restored to baseline. A private-material scan of 403 source/browser-asset files found zero matches for the generated private key or server secrets; ignored server configuration remains excluded. The complete file list and audits are in ignored artifacts. The hosted mutation harness now refuses to run once the production publication marker exists.

## Remaining work and shortest handoff

**Physical device:** connect the Xiaomi/Android phone by USB with USB debugging enabled and authorize this computer. ADB is installed but reports no attached hardware. Actual soft keyboard/IME, scrolling, Back/dock behavior, background/resume and Wi-Fi/mobile-data switching remain unverified. Browser viewport/touch/keyboard events do not satisfy this gate.

Supabase/Vercel account access no longer needs user action. No credentials or signing keys should be pasted into chat. Full-workspace audit/formatting debt and unmeasured load/cold-start behavior remain explicit above. Phase 6 was not begun.

## Primary references checked

- [Supabase changelog](https://supabase.com/changelog): current breaking changes reviewed; the October 12 TLS cipher deprecation does not justify disabling TLS checks.
- [Monitoring and debugging](https://supabase.com/docs/guides/monitoring-and-debugging): consulted before diagnosing service/connection failures.
- [Connecting to PostgreSQL, SSL](https://supabase.com/docs/guides/database/connecting-to-postgres#connecting-with-ssl): project root certificate and server verification.
- [Custom JWTs](https://supabase.com/docs/guides/auth/jwts) and [signing keys](https://supabase.com/docs/guides/auth/signing-keys): external capabilities require an appropriate imported key, not a publishable/secret API key.
- [Realtime authorization](https://supabase.com/docs/guides/realtime/authorization): private channels, authorization cache and JWT refresh behavior.
- Installed Next.js 16.4.1 route/data-security guides, Supabase SDK source, `pg-connection-string` source, and Supabase CLI `--help` were checked against the actual installed versions.
- [fast-uri advisory](https://github.com/advisories/GHSA-hrr3-gc8f-f4qj) and [source-map-js advisory](https://github.com/advisories/GHSA-68fv-2mgg-jv7q): affected versions and compatible remediation, checked against live npm metadata.

- [Vercel monorepo FAQ](https://vercel.com/docs/monorepos/monorepo-faq), [deployment CLI](https://vercel.com/docs/cli/deploy) and [automation protection bypass](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation): project settings, production targeting and temporary scoped access.
