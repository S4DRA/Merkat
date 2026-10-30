# Phase 6 — groups, channels and privacy

Validation date: October 17, 2026. Includes the user's additional phone-install,
browser-tab icon and installed-app logo requests. The inspection and decisions
were recorded in [the plan](../PHASE_6_PLAN.md) before product-code changes.

**Implementation is local and unreleased.** The Phase 5.5 production deployment
and its database were not migrated, redeployed or used for Phase 6 mutation tests.
Hosted group verification and physical Xiaomi 15T acceptance remain release gates.
No Phase 7, calls, media uploads, recovery, billing changes or purchases were added.

## 1. Architecture decisions

The existing Next.js App Router HTTP adapter, Merkat username/password sessions,
Prisma/PostgreSQL source of truth and private per-user Supabase Broadcast remain.
Groups use a separate repository/service and explicit membership authorization;
DM pair authorization was not reused as group membership.

Every group/channel operation validates the live session and active/onboarded
user. Group reads take a shared group-row lock; membership/channel mutations and
sends take its update lock. This orders content access against removal and
channel deletion. A transaction that finished reading before removal may already
have returned content; new content operations after removal commits return 404.

Short PostgreSQL shared advisory privacy locks protect interaction checks;
blocking, preference and friendship changes take their exclusive counterpart.
This orders them against DM starts/sends and invitations. Locks follow session,
privacy fence, quota, group/conversation order. Transactions do no external network
publishing. Quotas use the existing bounded, persistent per-user row.

## 2. Additive database changes

The seventh migration is `202610170003_groups_privacy`. It was generated from the
old/new Prisma schema files, supplemented with reviewed integrity SQL, and applied
only to newly generated loopback test databases. The six historical migrations and
existing production data remain unchanged.

| Model           | Purpose                                                                                                     |
| --------------- | ----------------------------------------------------------------------------------------------------------- |
| ChatGroup       | Stable UUID, immutable creator/submission key, current owner, name/description, activity and archive state  |
| GroupMember     | Unique group/user pair, OWNER/ADMIN/MEMBER role, join/leave state; durable sender identity after leaving    |
| GroupChannel    | Stable UUID, submission key, immutable creation position, default flag, sequence/activity and soft deletion |
| GroupMessage    | Persistent text, server sequence/time, immutable member sender, client UUID and channel-local reply         |
| GroupReadState  | Unique channel/user delivered/read cursors                                                                  |
| GroupInvitation | Unique pending group/user invitation, inviter, stable UUID and creation time                                |
| UserPrivacy     | Non-friend DM preference and FRIENDS/EVERYONE/NOBODY invitation preference                                  |
| UserBlock       | Directional unique blocker/blocked pair                                                                     |
| SafetyReport    | Reporter-bound submission key, user/group target, category and bounded private reason                       |

MessagingRateLimit gains discovery, management and report counters. Existing send,
creation and friendship limits remain. Indexed foreign keys, unique submissions
and channel sequences, partial unique default/owner/name indexes, nonempty content
checks and deferred ownership/default-channel constraints protect integrity.
Database triggers reject message updates, inactive senders, cross-channel replies,
invalid/regressing receipt cursors and ownerless live groups. Sender IDs never come
from the browser. RLS is enabled and public/browser privileges revoked on all new
tables. No browser content-table access or unrestricted runtime role is introduced.

Group messages/memberships are retained when someone leaves. Channels are soft
deleted. Archived groups have no active API access. These retained identities and
reports deliberately restrict destructive account deletion; an account-deletion
workflow is not part of this phase.

## 3. Implemented features and APIs

Implemented real group creation with optional description, invitation of registered
users, explicit acceptance/decline/revocation, membership lists, removal/leave,
details editing, roles/ownership transfer, default/general and managed channels,
channel switching, persistent messages, replies, unread state, history pagination,
activity, retry/idempotency and reconnection reconciliation.

The existing POST JSON, exact Origin/Fetch-Site checks, HttpOnly session cookie,
no-store responses and generic error adaptation are preserved. Nonmember and
unknown IDs both return 404. Forbidden role operations return 403; strict invalid
input returns 400; submission/capacity/default-channel conflicts return 409;
quotas return 429 with Retry-After; bounded service failures return 503.

| Route under `/api/`                                                             | Operation                                                                                   |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| groups/list, groups/create, groups/detail, groups/edit                          | Paginated overview/incoming invitations, atomic creation, member-scoped details and editing |
| groups/invite, groups/invitation, groups/member, groups/leave                   | Invitations, recipient actions/revocation, role/removal/transfer and leave                  |
| groups/channel/create, groups/channel/edit                                      | Stable channel creation, rename and soft deletion                                           |
| groups/messages, groups/send, groups/receipt                                    | Channel keyset pages/catch-up, idempotent sends/replies and monotonic receipts              |
| privacy/settings, privacy/update, privacy/blocks, privacy/block, privacy/report | Own preferences, blocked-user pagination, block/unblock and insert-only reports             |

Groups are limited to 100 active members, 20 active channels and 100 memberships
per user. Pending invitations are bounded to 50 per group and inviter. History
pages contain 40 messages, overview/blocked pages 30 entries. Text is capped at
4,000 characters/16,000 bytes, descriptions/reports at 1,000 characters. Send bodies
are limited to 24 KiB, other group/privacy requests to 8 KiB. Creation takes at most
20 initial usernames, subject to the shared invitation quota.

Shared one-minute quotas: sends 60, new conversations/groups 10, new friendships/
invitations 10, exact-username discovery 30, management/privacy updates 30 and
reports 5. Unknown/blocked username lookups consume a committed discovery attempt;
failed lookups cannot roll that quota back. Exact send retries return the original
message without consuming another send. Group/channel creation keys also dedupe.

## 4. Group/channel permission matrix

| Action                                                       | OWNER                                                | ADMIN                 | MEMBER / invitee                                    |
| ------------------------------------------------------------ | ---------------------------------------------------- | --------------------- | --------------------------------------------------- |
| Read active channels/members, send/reply, update own cursors | Yes                                                  | Yes                   | Active MEMBER: yes; pending invitee: no             |
| Rename/edit group; create/rename/delete channels             | Yes                                                  | Yes                   | No                                                  |
| Delete the default channel                                   | No                                                   | No                    | No                                                  |
| Invite/revoke pending invitations                            | Yes, subject to recipient privacy/blocks             | Same                  | No                                                  |
| Accept/decline an invitation                                 | Only if recipient                                    | Only if recipient     | Recipient only; permissions rechecked at acceptance |
| Promote/demote admins                                        | Yes                                                  | No                    | No                                                  |
| Remove members                                               | ADMIN or MEMBER, not self                            | MEMBER only, not self | No                                                  |
| Transfer ownership                                           | To an active existing member                         | No                    | No                                                  |
| Leave                                                        | Transfer first when others remain; if alone, archive | Yes                   | Yes                                                 |

Ownership transfer atomically demotes the old owner to ADMIN, promotes the chosen
member and changes the group owner. Deferred constraints require exactly one
matching active owner for every live group. Concurrent transfers cannot produce
two owners. Removing/demoting an inviter invalidates that manager's pending invites.
All active members have the same active-channel access; private channels, public
broadcasting and global group/channel discovery are not implemented.

## 5. Privacy and blocking rules

- Existing behavior is preserved by default: non-friends may start a DM. Turning
  it off restricts new pairs; an already established conversation remains until
  blocked. Blocking takes precedence in both directions.
- Either-direction blocking prevents new/open DM interactions, sends in existing
  DMs, friendship requests and direct group/plan invitations. Existing DM history
  and receipts remain accessible. Blocking removes the friendship and applicable
  pending invitations; unblocking does not silently restore friendships.
- Shared-group membership/history/messages stay visible. Blocking does not kick
  someone, hide shared history, or imply private channels. The UI states this rule.
- Group invitations default to friends. Users may choose everyone or nobody.
  Creation/acceptance recheck the inviter's role, recipient preference/friendship,
  active status, and blocks involving both the inviter and current group owner.
  Another admin cannot bypass a block against the owner.
- Username discovery stays exact, authenticated, quota-bound and minimal: UUID,
  display name and username. Blocked/unknown/unavailable users share the same result.
  No email, phone, credential, session or private profile fields enter group DTOs.
- Reports require a known user relationship or a member/invitee group target, a
  valid category and a bounded reason. The server binds the reporter. Retries are
  acknowledged without creating duplicates. There is no application report-reading
  endpoint and no report data in Broadcast.

`groups-privacy.sql` gives the backend INSERT only on SafetyReport, with no SELECT,
UPDATE or DELETE. The separate NOLOGIN `merkat_moderator` role has SELECT only and
is not automatically granted to anyone. A reviewed operator must explicitly be
authorized to assume it. The app says only “Report saved privately”; no active
moderation team, automatic review or response guarantee is claimed.

## 6. Realtime security and reconciliation

No group/channel socket topic is added. Existing session-bound, 90-second,
receive-only `merkat:user:<UUID>` capabilities notify the user to refetch authorized
HTTP state. New SECURITY INVOKER triggers broadcast `{}` only to current active
members, invitation recipients/managers, or the affected user's own preference/
receipt stream. Membership-removal notification can reach the removed user so the
client closes the view; subsequent group-message invalidations exclude that user.

Existing restrictive Realtime authorization continues denying another user's topic,
public access, Presence and browser publishing. The private signing key remains
server-only. No service-role key, cookie, message text, report, group/channel ID or
membership list is a notification payload. Hosted Supabase may add its broadcast
UUID metadata, as verified historically in Phase 5.5.

Removed members immediately lose new message API access after the removal commits.
Their own per-user socket may remain valid for other conversations. Cached socket
authorization is not instant WebSocket revocation; no such claim is made. Existing
session revocation/expiry and token-renewal behavior are preserved.

Initial history and reconnect drain fixed sequence boundaries; UUIDs dedupe replay.
An own send is merged without advancing the reconciliation cursor past a possible
gap. Ambiguous retries reuse the original client UUID. Receipts are monotonic and
read acknowledgements require a visible, focused view at the bottom. The client
drains a newer visible cursor after an earlier receipt response finishes, without
looping failed requests. Unread counts exclude own messages. New/rejoining members
start at each channel's current tail; older retained history is readable but not
newly unread. Group messages show Sent; no aggregate “read by everyone” is claimed.

## 7. Mobile UX and phone installation

The approved navigation remains Calendar → Friends → white Merkat logo/New chat
→ Chats → Profile. Chats contains real group entries alongside DMs; Groups has an
overview and invitations. The New chat dialog offers group creation. Active group
threads use the existing conversation marker to hide navigation on mobile and
desktop; Back restores it.

Channel selection and group settings are contextual sheets on mobile and dialogs
on desktop. Sheet state is represented in the URL, so browser Back closes it and
channel Back/Forward restores context. Deleting the selected channel falls back to
the stable default. Per-channel drafts, failed submission IDs and scroll positions
are held in memory across channel/Back navigation; reload/leaving the destination
clears local drafts. Messages themselves persist in PostgreSQL.

Existing white/off-white/near-black/orange tokens, logo geometry, dock order and
visual primitives remain. New UI is scoped; no old stylesheet/navigation file was
rewritten. Bottom sheets respect safe areas, long settings keep the close header
reachable, icon/focus contrast is visible on the dark header, and composers use
16px text, dynamic viewport sizing, composition-aware desktop Enter, Shift+Enter
and touch newline behavior. Incoming messages do not move an older-history reader;
loading older pages preserves position.

The requested install support adds a valid standalone manifest, 192/512px icons,
180px Apple touch icon, and 32px PNG/ICO tab icons. Exports proportionally contain
the unchanged approved white transparent source on an orange square; original
assets are unchanged and the exports are not labeled maskable. Install Merkat is
available on account pages/Profile. It retains the browser's deferred install
event and prompts only after a user gesture, with browser-menu / iOS Share fallback
instructions. Installed/standalone mode hides the action. Browser support and event
timing vary; a native prompt is not promised on every browser.

No service worker, offline conversation cache, background sync, push permission or
native APK/store publication was introduced. Conversations require connectivity.
Synthetic install events test UI behavior only; they do not prove actual phone
installation. New icons/install features are not yet on the production deployment.

## 8. Files changed

- `apps/api/src/messaging-routes.ts`
- `apps/api/src/plan-routes.ts`
- `apps/web/public/brand/README.md`
- `apps/web/public/favicon.ico`
- `apps/web/public/icons/merkat-180.png`
- `apps/web/public/icons/merkat-192.png`
- `apps/web/public/icons/merkat-32.png`
- `apps/web/public/icons/merkat-512.png`
- `apps/web/src/app/[destination]/page.tsx`
- `apps/web/src/app/groups.css`
- `apps/web/src/app/layout.tsx`
- `apps/web/src/app/manifest.ts`
- `apps/web/src/components/account/account-controls.tsx`
- `apps/web/src/components/account/account-frame.tsx`
- `apps/web/src/components/chats/chats-workspace.tsx`
- `apps/web/src/components/groups/group-list.tsx`
- `apps/web/src/components/groups/group-settings.tsx`
- `apps/web/src/components/groups/group-thread.tsx`
- `apps/web/src/components/groups/groups-workspace.tsx`
- `apps/web/src/components/install-app.tsx`
- `apps/web/src/components/privacy-controls.tsx`
- `apps/web/src/lib/direct-client.ts`
- `apps/web/src/lib/server/http-api.ts`
- `apps/web/src/lib/server/runtime.ts`
- `docs/PHASE_6_PLAN.md`
- `docs/architecture/environment.md`
- `docs/architecture/phase-6-groups-privacy.md`
- `infra/supabase/groups-privacy.sql`
- `packages/backend/src/groups.ts`
- `packages/backend/src/index.ts`
- `packages/backend/src/messaging.ts`
- `packages/backend/src/plan-service.ts`
- `packages/backend/src/plans.ts`
- `packages/backend/src/privacy.ts`
- `packages/backend/src/social.ts`
- `packages/contracts/src/groups.ts`
- `packages/contracts/src/index.ts`
- `packages/contracts/src/messaging.ts`
- `packages/contracts/src/privacy.ts`
- `packages/database/prisma/migrations/202610170003_groups_privacy/migration.sql`
- `packages/database/prisma/schema.prisma`
- `packages/database/src/friendship-repository.ts`
- `packages/database/src/group-repository.ts`
- `packages/database/src/index.ts`
- `packages/database/src/messaging-repository.ts`
- `packages/database/src/plan-repository.ts`
- `packages/database/src/privacy-guard.ts`
- `packages/database/src/privacy-repository.ts`
- `tests/browser/groups.spec.ts`
- `tests/browser/install.spec.ts`
- `tests/integration/groups-privacy.test.ts`
- `tests/support/browser-server.ts`
- `tests/support/run-integration.ts`

## 9. Exact validation results

Commands used the explicit supported Node 22.17.0 runtime with npm 11.19.0, with that Node directory first in PATH. Build/generation stages were sequential. Final logs are under ignored artifacts/phase-6/.

| Command                     | Exact final result                                                                                                                |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| npm test                    | PASS, exit 0: 2 reference unit tests and 60 PostgreSQL integration tests; no failures/skips.                                      |
| npm run test:ui             | PASS, exit 0: all 53 Chromium tests in 2.4 minutes, including 12 group/install additions. Realtime transport is mocked.           |
| npm run lint                | PASS, exit 0: zero warnings.                                                                                                      |
| npm run typecheck           | PASS, exit 0: all workspaces and tests.                                                                                           |
| npm run db:validate         | PASS, exit 0: Prisma schema valid.                                                                                                |
| npm run build               | PASS, exit 0: Next.js 16.4.1 production build. No deployment.                                                                     |
| npm run test:unconfigured   | PASS, exit 0: login/liveness/authorization with APP_ORIGIN absent and set.                                                        |
| npm audit --omit=dev --json | PASS, exit 0: zero known production dependency findings.                                                                          |
| npm audit --json            | Exit 1: six existing tooling/legacy findings: five high, one moderate; zero critical.                                             |
| npm run format:check        | Exit 1: the same 78 pre-existing formatting failures: 71 bundled skill files, six inactive API files and the inactive phone form. |

All changed active TypeScript/TSX/CSS/JSON/Markdown files are formatted. Two inactive reference bridges receive only the new authenticated-discovery argument and retain their prior formatting debt; they are not activated. No dependency versions changed in this phase. The remaining full-audit debt is the existing ESLint / fast-glob / micromatch / braces chain and inactive Fastify. No forced framework downgrade or audit fix was applied.

The test runner uses fresh owned loopback PostgreSQL clusters, UTC and all seven
migrations. The larger group registration suite has a separate isolated cluster
so it does not exhaust the unchanged global auth quota for other files. Accounts
are independently registered through the real password service; browser fixtures
use genuine sessions and real Next.js HTTP/database operations. Socket transport
is explicitly mocked. No fake user/message examples were added to product code.

The SQL security fixture is real PostgreSQL with a minimal `realtime` contract,
not a hosted Supabase service. It applies setup scripts repeatedly and tests the
actual restricted backend role, insert-only report retries, moderator SELECT-only
access, browser table denial, empty notification payloads and removed-recipient
exclusion. Existing capability/RLS publishing/topic tests remain in the suite.

Initial failures were investigated: synchronous new service validation was aligned
with the existing async service contract; the expanded registration tests were
isolated rather than weakening/resetting shared quotas; generator steps were
sequenced after a concurrent Prisma-generation collision; a send-fault test now
finishes reconnect reconciliation before requiring Retry (automatic recovery had
already found the persisted message). An overlapping receipt response has a focused
regression and fix. Concurrent list membership removals are skipped rather than
incorrectly turning the entire overview into a missing-group error. No tests were
disabled to obtain a pass.

Final source audit: 244 baseline files, **53 changed/added, 0 deleted**. All **26 protected original logo/navigation/stylesheet/historical-migration files** remain unchanged. The Prisma schema change is additive and authorized; the brand README documents the requested new icon exports. The generated Next type reference was restored only when its bytes matched the baseline. A scan of **290 source/public browser-asset files** found **0 private-material matches**. Ignored environments, generated account sessions and secret artifacts are excluded from source/deployment; no environment values appear in this report.

## 10. Hosted verification results

**No Phase 6 hosted Realtime claim.** The known Merkat project
`ejsqjkstyrzddrxydrwq` serves the user's Phase 5.5 production app; its existing
Preview configuration shares that backend. It was not treated as disposable
staging, migrated, tested with generated accounts, or redeployed during Phase 6.

A fresh read-only CLI project inventory under the current login lists only two
unrelated projects, with no Merkat staging project. Their databases, settings and
data were neither queried nor modified. No new project, signing key, paid add-on
or billing change was created. Phase 5.5's historical hosted passes establish that
earlier version only; they do not validate this phase's new SQL/triggers.

Local browser tests prove persistence, UI, authorization and reconciliation with
simulated invalidations. SQL fixtures prove PostgreSQL contract behavior. Neither
proves actual hosted Broadcast delivery, JWT caching or provider behavior.

## 11. Known limitations

- All active members can read all active channels and retained history. New joins
  suppress historical unread counts, not historical access. Shared-group blocking
  does not filter content. No public discovery/private channels.
- Reports are stored securely but require explicitly authorized human operations;
  no moderation UI, active team or automated review is provided.
- No aggregate group reader roster; own delivered/read cursors and unread state are
  implemented. Groups are bounded to the capacities documented above.
- Draft/cache state is in memory, not persistent browser storage. Live updates
  require correctly configured Supabase; ordinary `dev:local` has no hosted socket
  and honestly shows live updates unavailable. There is no polling fallback.
- The privacy fence is a short database-wide shared/exclusive advisory boundary;
  this prioritizes correctness for the bounded beta. High-concurrency throughput,
  long-running uptime, provider failover and physical devices were not measured.
- Installation is a web app feature, not an app-store/native package. It has no
  offline messaging guarantee or physical-install acceptance yet.

## 12. Remaining release blockers and shortest handoff

1. Sign in with the Supabase account that can access a **separate, known Merkat
   staging project**, or grant that access. No credentials/signing keys should be
   pasted into chat. Review the target before applying the seventh migration and
   `realtime.sql` → `server-role.sql` → `groups-privacy.sql`; preserve any existing
   staging users/data and reuse approved staging signing configuration.
2. Verify real hosted group delivery, removal/invitation/block boundaries, receipts,
   expiry/renewal and reconnect using independent generated accounts on that target.
   Delete only recorded generated data; do not reset shared rate-limit counters.
3. Complete the separate Vercel release review with isolated staging credentials;
   existing Preview credentials must not point Phase 6 tests at production.
   Production deployment requires the user's separate approval.
4. Connect the Xiaomi 15T with USB debugging authorized. Fresh `adb devices -l`
   reports no connected hardware. Actual keyboard/IME, scrolling, background/
   resume, Wi-Fi/mobile switching, home-screen installation and app-icon launch
   remain unverified. Emulated touch/viewports and synthetic install events do not
   satisfy this gate.

The owned Merkat `next dev` process was stopped to avoid hot-reloading unreleased
code against the existing hosted `.env.local` and sharing Next build output during
validation. For isolated local work use **Node 22.17+ and `npm run dev:local`**.
The live Vercel app remains unchanged. Stop here for review; do not start Phase 7.

## References inspected

- [Phase 5](phase-5-messaging.md), [Phase 5.5](phase-5.5-validation.md), all six
  historical migrations and the current server/session/client implementation.
- Installed Next.js 16.4.1 route-handler, data-security, manifest and PWA guides.
- [Supabase Realtime authorization](https://supabase.com/docs/guides/realtime/authorization)
  and the current [changelog](https://supabase.com/changelog); no current change
  justifies weakening TLS or cached authorization boundaries.
- [MDN beforeinstallprompt](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeinstallprompt_event):
  deferred user-gesture prompting, limited browser availability and variable timing.
- Installed Prisma/pg adapter, Supabase SDK and CLI help; Supabase privilege,
  foreign-key indexing and lock-ordering guidance.
