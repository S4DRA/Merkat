# Phase 5 — direct text messaging

The implementation baseline below is historical. Hosted setup, subsequent fixes and current acceptance results are recorded in [Phase 5.5 validation](phase-5.5-validation.md).

Implementation covers Phase 5 plus the user's explicitly approved October 17 additions: reference-inspired mobile design/navigation, real friendships, and username/password registration with optional private email. Hosted Supabase delivery and physical Xiaomi 15T verification are pending. No existing external/production database was migrated and no deployment was performed. Earlier Matrix transport proposals are superseded; phone/Matrix code remains inactive. Plans, account identity/session security and original brand geometry are preserved.

## A. Existing implementation inspected

Read schema, all historical migrations, session/auth repositories, API routes, exact username lookup, shell/navigation, primitives and responsive CSS. Chats was a structural placeholder. Matrix/phone adapters were inactive and remain disconnected. `D:\VAL` contained images, no accessible source repository. No VAL design or implementation was copied. The [plan and risks](../PHASE_5_PLAN.md) were recorded before implementation.

## B. Architecture and security decisions

Prisma/PostgreSQL is the source of truth. Next.js Node route handlers perform all content operations. Supabase private Broadcast signals that state changed; the client then fetches authorized HTTP data. No Socket.IO, custom server, Redis, worker, paid infrastructure, public message subscriptions or Supabase Auth migration is introduced.

Supabase supports custom JWTs through an imported signing key. A server-only ES256 P-256 JWK signs a 90-second capability with `sub` = Merkat UUID, `role=authenticated`, fixed `merkat_purpose=realtime`, the actual Merkat session UUID and an expiry capped to that session. It never includes a password, cookie token, session hash or database credential. Merkat UUIDs remain independent of usernames. The browser holds the JWT in memory only and refreshes it from the authenticated endpoint; the signing key is never serialized to the browser.

Private receive-only topic: `merkat:user:<UUID>`. A private SQL helper checks subject, purpose, session ownership, revocation/expiry, onboarding and active user. Each database trigger sends **only `{}`**, to the two immutable conversation participants. Conversation membership is enforced when choosing recipients and again on every API read/write. There is no client-controlled topic or sender accepted by the content APIs. No table is published using Postgres Changes.

Supabase caches subscription authorization. A previously connected revoked session can receive empty activity hints until JWT expiry (at most 90 seconds); it immediately loses API content access. Fresh authorization/refresh checks the real session. This bounded timing leak is documented; this implementation does not promise instant WebSocket revocation. Signing-key compromise grants project-wide signing power: store it as a secret, restrict operator access and use Supabase key rotation/revocation if compromised. Transport and server access control are provided; **this is not E2EE**.

Current official references, checked October 16–17, 2026:

- [Custom JWTs and the accessToken client option](https://supabase.com/docs/guides/auth/jwts)
- [Importing and activating JWT signing keys](https://supabase.com/docs/guides/auth/signing-keys)
- [Private-channel RLS and cached authorization](https://supabase.com/docs/guides/realtime/authorization)
- [Private database Broadcast](https://supabase.com/docs/guides/realtime/broadcast)
- [setAuth and token refresh](https://supabase.com/docs/reference/javascript/setauth)
- [Default UTC database timezone](https://supabase.com/docs/guides/database/postgres/configuration)
- [October 12 TLS deprecation](https://supabase.com/changelog/cbc-tls-ciphers-deprecated): keep current browser/OS TLS; no obsolete cipher workaround is included.

## C. Database models and migration

Three new additive migrations: `202610160002_direct_messaging`, `202610170001_friendships`, `202610170002_optional_email`. The three pre-existing historical migrations are unchanged:

| Model              | Purpose and integrity                                                                                                                          |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| DirectConversation | UUID, canonically sorted distinct user UUIDs, unique pair, last sequence, server timestamps, activity/id index                                 |
| DirectParticipant  | Exactly the two pair owners, immutable identities, delivered/read cursors, unread count, user/conversation index                               |
| DirectMessage      | UUID, participant sender FK, conversation sequence, server timestamp, text, client submission UUID; unique sequence and sender/submission keys |
| MessagingRateLimit | One bounded row per user, shared send/create counters and fixed one-minute window                                                              |
| Friendship         | UUID and unique canonical user pair; pending/accepted status, immutable requester belonging to the pair; owner/status/date pagination indexes  |
| User.email         | Nullable, normalized, private and unverified email; not returned by account/discovery DTOs or used for login/recovery                          |

Triggers create the two participants and reject additions, removal of a single participant, reassignment, regressing cursors and receipts beyond history. Deferred checks allow normal transaction-safe creation/deletion. User deletion deliberately cascades. Preferences have no current use case and were not added. No historical data is backfilled or renamed. All new tables enable RLS and revoke public/browser privileges; actual content stays server-only. Prisma schema drift is checked against the migrated isolated database, preserving the earlier functional username index.

## D. Messaging APIs and authorization

All endpoints below use POST with same-origin JSON, the existing HttpOnly Merkat cookie, `Cache-Control: no-store`, strict Origin/Fetch-Site checks and bounded body reads. POST reads avoid leaking conversation/cursor details in query URLs. All operations recheck a live session under a transaction lock; content queries are membership-scoped. Nonmember and unknown conversations both return 404.

| Endpoint               | Input                                                                       | Result                                                   |
| ---------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------- |
| `/api/direct/list`     | optional activityAt/id `before`                                             | 30 conversations, unread conversation count, next cursor |
| `/api/direct/open`     | exact username                                                              | existing or atomically created DM                        |
| `/api/direct/messages` | conversationId; optional before OR after; optional fixed through with after | 40 ordered messages, metadata, hasMore, through          |
| `/api/direct/send`     | conversationId, clientId UUID, text                                         | persisted message; exact retry returns original          |
| `/api/direct/receipt`  | conversationId, deliveredSequence, optional readSequence                    | monotonic receipt state and unread count                 |
| `/api/direct/realtime` | empty object                                                                | short-lived session-bound private Realtime capability    |

Generic error adaptation includes 400 validation, 401 invalid session, 404 missing/nonmember, 409 changed-content submission reuse, 429 quota with Retry-After and bounded 503 service failure. Errors contain no database details or keys. Existing plan APIs and inactive Matrix endpoints retain their behavior.

Friends endpoints use the same server session, CSRF, no-store and body protections: `/api/friends/list` takes FRIENDS/INCOMING/OUTGOING plus optional date/UUID cursor and returns 30 public-profile entries; `/api/friends/request` takes an exact username; `/api/friends/act` accepts a friendship UUID and ACCEPT/DECLINE/CANCEL/REMOVE. Only the recipient accepts/declines pending requests; only the sender cancels, and either accepted friend can remove the relationship. Concurrent reciprocal requests stay pending until explicit acceptance. Removal leaves DM history intact. New requests are limited to 10/user/minute and 50 outstanding outgoing requests. Friend changes use the same private empty Broadcast notifications.

Registration requires only username/password. Optional email is validated/normalized and stored privately; blank email remains NULL. Display name defaults to username and can be edited later. Existing API callers supplying displayName stay compatible. The form has no required display name or confirmation field; password visibility, Argon2id, session security, shared auth limits, error/loading states and profile entry remain. Email is not verified, made public, used to sign in or connected to recovery.

## E. Supabase Realtime integration

`use-direct-realtime.ts` uses the installed, pinned Supabase client with `private: true`, receive-only Broadcast and an accessToken callback. The callback refreshes before expiry and disconnects on authorization failure. SUBSCRIBED, events, focus and network restoration reconcile persisted state. Reconciliation drains a fixed sequence boundary; overlapping notifications coalesce and UUIDs deduplicate. A successful own send never skips a missed sequence range. There is no continuous polling fallback.

The separate [Supabase SQL setup](../../infra/supabase/realtime.sql) intentionally requires Supabase's existing realtime schema. It installs a restrictive guard alongside the receive policy, so broad permissive policies cannot grant browser publishing, Presence or another user's topic. The lookup helper is SECURITY DEFINER only to inspect private auth tables; it is in an unexposed schema, has an empty search_path, checks the calling JWT, returns only a boolean, and revokes PUBLIC/anon access. Notification triggers are SECURITY INVOKER. The script is transactional and repeatable, and does not attempt to alter ownership or enable already-enabled RLS on realtime.messages.

## F. Mobile UX

Chats gains a real list/detail composition and Friends gains real list/request/sent tabs inside AppShell. The user's new navigation order is **Calendar → Friends → Merkat/New chat → Chats → Profile**. Calendar links to the preserved `/plans` destination; the raised orange center circle opens New chat. Its white transparent PNG is exported from supplied vector geometry without redrawing; source assets are unchanged. The mobile dark rounded dock, calmer list spacing, soft text bubbles, dark conversation header and rounded history follow the supplied references. The brand header stays on other routes/desktop; mobile Chats/Friends use their own concise headings. Existing Calls/Groups URLs remain available, without implementing their deferred features. No voice/media/pinned/fake-category examples from the references are added.

The composer remains in layout below the scrollable history. Dynamic and visual viewport sizing accommodates reduced keyboard space without changing other routes. Textareas use 16px text, composition-aware desktop Enter and mobile newline behavior. URL selection supports browser Back; mounted list scroll, per-thread draft, failed-send IDs and message offsets are retained while Chats remains mounted. Older-page prepending preserves position; incoming messages do not pull a reader away from older history. A new-message button returns to the bottom. Read acknowledgements require a visible, focused page at the bottom; delivery means history fetched by the client. Receipts are monotonic and own messages do not add unread counts.

Primary navigation is hidden while a conversation detail is open, at both mobile and desktop widths. Back to Chats restores the inbox and navigation; other destinations retain navigation. The desktop layout reclaims the sidebar column and the mobile composer retains safe-area padding. A shared `data-conversation-open` marker supports the same behavior for future group detail screens; actual group messaging is not implemented.

Draft/failed-send/scroll state is intentionally in memory, not persistent browser storage. Reloading or leaving Chats clears that local UI state; persisted messages remain in PostgreSQL. Realtime connection failures and retry controls are visible. No private message content is placed in notifications, localStorage, logs or URLs.

## G. User discovery

The new-chat dialog calls the existing `/api/people/find` service for an exact normalized username. Only UUID, display name and username are returned. Opening a DM re-resolves that username on the server, requires an active onboarded peer and rejects self-DMs. There is no phone discovery, prefix enumeration, fake data or hardcoded application account.

## H. Reliability and security review

- Locks order session/user, per-user quota, conversation; DB-only transactions contain no external publishing request. Native pair conflict handling and message uniqueness handle concurrent server instances.
- Sends: 60 per user per minute; new DMs: 10 per user per minute. The same row bounds storage across instances and resets on access. Opening an existing conversation and exact message retries do not consume send quota. No unbounded per-request limiter key is created.
- Text: trimmed nonempty, 4,000 JavaScript characters maximum, invalid control characters rejected, rendered as plain React text. DB independently limits length/bytes and checks sender membership. Request body cap is 24 KiB for sending and 8 KiB for other direct operations.
- Server sequence ordering avoids timestamp/UUID tie ambiguity. Message pages are immutable keyset ranges; conversation activity changes can move a row between pages, so the client refreshes/deduplicates the list.
- Reconnect/focus reconciles missed rows; failed/ambiguous submission reuses its original clientId. Receipt updates only notify when cursors advance, avoiding feedback loops.
- PostgreSQL must use UTC, Supabase's default. The installed Prisma pg adapter serializes UTC wall time without an offset and normalizes returned timestamptz values as UTC. Isolated Windows PostgreSQL previously inherited Istanbul time; the runner now explicitly uses UTC and verifies the clock/short expiry. No existing timestamps were rewritten. Review any non-UTC legacy database before migration rather than mass-correcting stored data.

## I. Files changed

Contracts/backend/database: messaging and friendship contracts/services/repositories, three additive migrations and schema relations; optional private email and default display name in registration; package index exports.

Next.js: runtime wiring, HTTP adaptation, capability issuer, API client/reconciliation, Chats component/Realtime hook and scoped stylesheet; AppShell content slot and Chats route integration. Supabase client is explicitly declared in the web workspace and lockfile.

Tests/setup: new isolated messaging/friendship/email tests and browser tests; test PostgreSQL uses UTC; browser server creates isolated real password accounts and a test-only signing key. The explicit dev:local command provisions only its owned persistent local PostgreSQL cluster and generated ignored credentials. Shell tests cover the approved new navigation and retain unchanged Calls panel checks. Environment examples, README, deployment/environment guidance, plan and this report are updated. Full file list is recorded in `artifacts/phase-5/changed-files.txt`. Original supplied brand files, plans, historical migrations and actual env files remain unchanged; the new logo export and navigation changes are explicitly authorized.

The list contains 58 implementation/test/documentation files plus two files automatically refreshed by `next dev`: `apps/web/AGENTS.md` (generated Next.js guidance heading) and `apps/web/next-env.d.ts` (development type import). The 215-file before-snapshot audit found no deleted files, protected asset/history/plan changes or unlisted source changes.

## J. Exact test results

Commands ran with Node 22.17.0 through `npm exec --yes --package=node@22.17.0 -- ...`, matching the supported Node major rather than the host's Node 24:

| Command                     | Result                                                                                                                                                               |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`                  | Exit 0: 2 reference unit tests and 41 real PostgreSQL integration tests passed; no failures/skips                                                                    |
| `npm run test:ui`           | Exit 0: 37 browser tests passed in 46.1 seconds, including navigation hiding/restoration at mobile and desktop widths                                                |
| `npm run lint`              | Exit 0; zero warnings                                                                                                                                                |
| `npm run typecheck`         | Exit 0; all workspaces, tests and the local development script checked                                                                                               |
| `npm run db:validate`       | Exit 0; Prisma schema valid                                                                                                                                          |
| `npm run build`             | Exit 0; Next.js production build completed                                                                                                                           |
| `npm run test:unconfigured` | Exit 0; login/liveness behavior verified with missing database configuration, with and without APP_ORIGIN                                                            |
| `npm run format:check`      | Exit 1: 78 pre-existing formatting failures (71 bundled skill files, 6 inactive API reference files and the inactive phone form); changed active files are formatted |

The explicit local development command also started successfully against its owned persistent database. An actual Chromium registration returned 201, logout/login returned 200, reload retained the authenticated session, and optional email was confirmed in PostgreSQL. The generated verification account was deleted afterwards; no default accounts were added. The local server was left running at `http://localhost:3000`.

Test logs/screenshots remain under ignored `artifacts/phase-5` and `artifacts/phase-5-*.png`. SQL tests use a minimal test-only realtime contract fixture; browser tests explicitly mock Phoenix socket notifications. Neither is evidence of hosted Supabase delivery.

## K. Environment and setup

1. Use Node 22.x (minimum 22.17) and npm 11; run `npm ci` at the root.
2. For immediate local use, run `npm run dev:local` and open `http://localhost:3000/register`. It generates its own ignored local credentials, starts a real persistent loopback PostgreSQL database and applies all six migrations only to that owned cluster. No env configuration or Docker is needed. Accounts/data persist after restart; Ctrl+C stops the app. MERKAT_LOCAL_PORT changes its web port. It does not contact the existing env-configured database or create application accounts for you.
3. For a separately configured local/staging PostgreSQL target, keep timezone UTC and TLS verification enabled. Export DATABASE_URL/DIRECT_URL for the CLI, inspect the target, then run `npm run db:migrate`. Never migrate during normal install/build/start. All six migrations are required.
4. For that separate target, set `apps/web/.env.local` with DATABASE_URL, exact APP_ORIGIN and the existing shared AUTH_RATE_LIMIT_SECRET. Root `.env` does not configure Next.js. Start with `npm run dev`, open `/register`, and create your own accounts. Ordinary PostgreSQL supports persistent HTTP messaging/friends while live updates show unavailable.
5. For live delivery, use a known **dedicated Supabase staging project** backing the same Prisma database. Disable **Allow public access** in Realtime settings. Review other policies and integrations first: this script intentionally restricts anon/authenticated realtime access project-wide to Merkat's private topics. Keep `merkat_private` out of exposed Data API schemas; disable unused Data API access.
6. Generate an ES256 key using Supabase CLI's `supabase gen signing-key --algorithm ES256` (CLI help was verified). Store the private JWK securely; do not paste it in chat, commit it or print it in application logs. Import it as a signing key in that project's Dashboard, preserve the same `kid`, and activate/rotate to it as the official guide requires. Supabase-generated keys whose private part cannot be exported cannot mint Merkat capabilities. Do not rotate keys on an existing shared production project for this test.
7. Review/run `infra/supabase/realtime.sql` on that same staging database after Prisma migrations. Review function owner/runtime privileges: the server role must execute realtime.send, and the private lookup helper owner must read User/Session. The script never grants browsers table access. Run Supabase Security Advisor on the configured staging project and verify no broad public/publishing policy escapes the guard.
8. Add server-only SUPABASE_REALTIME_URL (project HTTPS origin), SUPABASE_PUBLISHABLE_KEY (`sb_publishable_…`) and MERKAT_REALTIME_SIGNING_JWK (single-line private JWK) to the web environment/Vercel runtime. No service-role key is needed. Restart Next.js. Builds require no live credentials. Do not put any of these signing credentials in NEXT_PUBLIC variables.
9. Use two independently registered accounts and two browsers/devices. Verify real Live status, send/reply, read state, outsider topic denial, browser publish denial, logout/expiry, disconnect and missed-message catch-up. This step is still pending on an actual service.

No paid product was provisioned or required by this implementation.

## L. Hosted services and physical devices

No hosted Supabase project, Realtime service, imported key, Vercel deployment or production database was modified or verified. Automated tests use fresh isolated PostgreSQL; the separate local development smoke check uses only the checkout's owned persistent PostgreSQL cluster. Chromium emulates 320/360/390/430px, reduced viewport height, history/Back, composer/scroll and navigation, with additional desktop checks. No physical Xiaomi 15T, Android keyboard, browser suspension or device-network transition has been verified. These require a configured staging project and actual device checks.

## M. Blockers and later-phase recommendations

Remaining release gate: configure/review a known staging project's signing key and restrictive SQL policies, run real WebSocket authorization/delivery/reconnect tests and Security Advisor, then verify Xiaomi 15T keyboard/scroll/navigation and suspended/background app behavior. Also verify Vercel's Linux native Argon2 packaging before release. Existing dependency-audit and formatting debt from Phase 4 is tracked separately; this phase does not apply broad upgrades or reformat inactive references/bundled skills.

For a separately approved Phase 6, prioritize abuse/privacy controls (block/report and discovery preferences), operational delivery monitoring and explicit retention policy. Groups, calls, media, recovery and plans redesign are not implemented. Stop after this phase.
