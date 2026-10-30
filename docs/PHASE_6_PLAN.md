# Phase 6 — inspected architecture and implementation plan

Recorded October 17, 2026 before product-code changes. Scope is groups, channels,
membership and essential privacy. Phase 5/5.5, the six historical migrations,
session authentication, Prisma repositories, same-origin HTTP adapter, private
Realtime helper, responsive conversation workspace and navigation were inspected.

## Architecture

- Keep PostgreSQL authoritative, Next.js Node HTTP handlers and the existing
  short-lived private `merkat:user:<UUID>` Broadcast capability. New triggers send
  empty invalidations only; every group/channel content API checks live membership.
  No group-topic capability, browser publishing or new transport is needed.
- Add Group, GroupMember, GroupChannel, GroupMessage, GroupReadState and
  GroupInvitation models; separate user privacy preferences, directional blocks
  and securely stored reports. Existing DM/friend/plan data is preserved.
- Membership is durable with an active/left state, so leaving does not erase
  another member's message history. OWNER/ADMIN/MEMBER are server-authorized.
  Ownership transfer is atomic; a deferred database check prevents ownerless live
  groups. An owner must transfer before leaving unless alone; the last owner's
  departure archives the group. New members accept invitations explicitly.
- All active members access all active channels; there are no private channels,
  global discovery or public broadcasting. Every group starts with a stable
  default channel, initially `general`, which cannot be deleted. Channel deletion
  is soft deletion and immediately removes API access. IDs/order remain stable.
- Serialize membership/channel mutations against content access using the group
  row. Use server sequences, unique client submissions, channel-local reply FKs,
  fixed-boundary pagination and monotonic per-channel delivered/read cursors.
  Joining initializes cursors at the current tail; older group history remains
  readable but is not counted as newly unread. Cap groups at 100 active members,
  20 active channels and creation invitations at 20.

## Privacy rules

- Defaults preserve existing DMs: non-friends may start them. Users can disable
  this for new conversations. Group invitation preference defaults to friends;
  alternatives are everyone or nobody. Only owners/admins can invite, and both
  invitation creation and acceptance recheck preference, blocks and inviter role.
- Either-direction blocking prevents DM sends/new opens, friendship requests and
  direct invitations (including plan invitations). Existing DM history remains
  readable. Blocking removes the friendship and pending invitations involving
  the blocked pair. Shared-group membership/messages remain visible; blocking
  neither kicks a member nor silently changes shared history.
- A short shared PostgreSQL advisory privacy lock protects interaction checks;
  blocking/settings updates take its exclusive counterpart. This establishes a
  transaction boundary: interactions already committed can remain, but operations
  after a completed block must fail. Group operations also serialize membership
  changes, preventing a removed member from reading/sending after removal commits.
- Exact-username lookup stays authenticated/minimal and gains persistent quotas
  including unsuccessful searches. Blocked/unknown/unavailable peers use the same
  result. No prefix/list discovery or private profile/email data is exposed.
- Reports contain a bounded category/reason and server-bound reporter/target.
  Users receive an acknowledgement only; no report-reading endpoint is introduced.
  A separate NOLOGIN moderation role has SELECT only and must be explicitly granted
  to a reviewed operator. The app can insert but cannot read reports. No automatic
  review or active moderation team is claimed.

## Implementation sequence and verification

1. Add contracts, additive Prisma migration/integrity constraints and repositories.
2. Wire existing HTTP/session patterns; extend DM/friend/discovery/plan checks.
3. Extend private Broadcast setup and least-privilege server grants; test with an
   isolated PostgreSQL Realtime contract fixture, explicitly not a hosted service.
4. Add a groups overview and combined Chats entry points, group conversations,
   contextual channel sheet, membership/settings/privacy interfaces, replies and
   retry/reconciliation. Reuse existing visual primitives/composer patterns.
   Preserve Calendar → Friends → white logo/New chat → Chats → Profile, and hide
   navigation inside active group conversations using the existing shell marker.
5. Test independent real registrations, concurrent role/removal/send races,
   ownership, invitations, unread/history/idempotency, blocking, reports and
   regressions on isolated databases. Run browser checks at 320/360/390/430 and
   desktop, keyboard/scroll/Back, lint/typecheck/schema/audit/build.
6. Produce `docs/architecture/phase-6-groups-privacy.md` with exact results and stop.

The user additionally requested phone installation, a browser-tab logo and an
installed-app logo during implementation. Add a web app manifest/icons from the
approved supplied brand asset, browser favicon/apple-touch metadata and a small
install interface. Service-worker behavior must not cache authenticated HTML,
API responses, messages or credentials. Verify the install surface with browser
automation; actual phone installation remains a physical-device release check.

## Release boundaries

The previously dedicated Merkat Supabase project now serves the user's explicitly
published production app. It is not an isolated staging database. Do not apply
Phase 6 migrations/setup there, run mutation tests against it, rotate its keys or
deploy Phase 6 to production. Hosted group acceptance needs a separate reviewed
staging target. Physical Xiaomi 15T testing is a separate gate. No Phase 7,
voice/video, media upload, account recovery, purchases or billing changes.
