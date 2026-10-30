# Phase 5 implementation and security plan

Recorded before implementation, 2026-10-16. Scope: persistent direct text messaging only.

## Inspected

- Prisma schema and all three historical migrations; server-only Prisma pool and repositories.
- Merkat Argon2 username/password registration, opaque hashed sessions, rotation/logout, request origin checks and bounded JSON handling.
- Existing exact username lookup in PlanService/PlanRepository, inactive Matrix endpoints, AppShell, navigation, shared primitives and mobile CSS.
- Isolated PostgreSQL integration runner and built Next.js HTTPS browser tests.
- `D:\VAL` contains visual assets, no source checkout. No VAL implementation was available to reuse. No visual assets were copied.
- Current Supabase changelog and official JWT, signing-key, Broadcast, authorization and setAuth documentation. The October 12 TLS cipher removal affects obsolete clients; use current HTTPS/WSS clients. No deprecated @supabase/server adapters are needed.

## Supported Realtime identity bridge

Supabase explicitly supports externally minted JWTs signed with an imported JWT signing key. Import and activate an ES256 P-256 signing key in a dedicated Supabase project; keep its private JWK on the Next.js server only. An authenticated, same-origin POST issues a 90-second token with the Merkat UUID as `sub`, `role=authenticated`, a fixed purpose claim and the actual Merkat session UUID. Expiry cannot exceed the Merkat session expiry. The browser receives this short-lived capability and the publishable project key, never a database password, service-role key, cookie token or signing key.

Use one private receive-only Broadcast channel per user. The policy's private helper checks JWT purpose, subject, live Merkat session and active onboarded user. Database triggers notify only the two participants of an affected conversation. No browser publishing or Presence is allowed. A restrictive policy prevents other permissive policies from widening this access. Disable public channel access in the project's Realtime settings.

Broadcast contains only an empty invalidation event, never message content, sender, conversation ID or read state. Every actual list/history/send/receipt operation goes through the Merkat API and checks the database session and membership. This matters because Supabase caches private-channel authorization until token refresh/expiry: revocation immediately denies API content access, while a previously authorized socket may receive empty activity hints for at most 90 seconds. The browser refreshes its capability from the live session and tears down on failure. Reconnection/focus reconciles persisted state; there is no public subscription or custom socket server fallback.

Realtime-specific policy/triggers will be a separate reviewed Supabase setup script, not part of portable Prisma migrations (ordinary isolated PostgreSQL lacks the realtime schema). Hosted delivery remains unverified until the operator configures a known staging project. Missing/invalid configuration fails closed with a visible connection state; persistent HTTP messaging still works.

Official references:

- <https://supabase.com/docs/guides/auth/jwts>
- <https://supabase.com/docs/guides/auth/signing-keys>
- <https://supabase.com/docs/guides/realtime/authorization>
- <https://supabase.com/docs/guides/realtime/broadcast>
- <https://supabase.com/docs/reference/javascript/setauth>
- <https://supabase.com/changelog/cbc-tls-ciphers-deprecated>

## Database and API plan

A new additive migration is necessary because no direct conversation, message or receipt tables exist. Canonically sorted distinct UUID pairs have one unique conversation. Database triggers create and enforce exactly those two immutable participant rows. Messages have UUIDs, per-conversation sequences, server timestamps, participant sender foreign keys and a unique sender/client submission ID. Transaction locks serialize sequence allocation, deduplicate retries and reject conflicting reuse. Participant delivery/read cursors advance monotonically and never beyond persisted history. Unread counts exclude one's own messages.

Every repository operation rechecks and locks the live session for the transaction, requires completed onboarding and performs member-scoped queries. Invalid/nonmember conversation IDs produce the same not-found error. No caller supplies a sender identity. Lists and history use bounded keyset pages. Per-user PostgreSQL counters limit sends and new conversation creation, shared across instances, without unbounded limiter rows. Sensitive tables have RLS, no browser policies or grants; no messages are added to the Postgres Changes publication.

Use the existing same-origin/no-store HTTP adaptation and exact username search. Starting a conversation re-resolves the username on the server and verifies active real accounts. Inputs are strict, text is rendered as text, mutations require the configured Origin and JSON, and errors reveal no internal database information.

## UI and verification plan

Replace only the Chats placeholder with a real list/detail composition inside the existing app frame. Preserve navigation order, central official logo, href and behavior, header and all other destinations. Use URL conversation selection for browser Back, retain mounted list scroll, preserve message offset when prepending history, reconcile by UUID/sequence, show send failures with same-ID retry, and avoid moving a reader away from older history. Use dynamic/visual viewport height for mobile keyboard space and a fixed-in-layout composer.

Verify isolated real accounts, concurrent creation/send, authorization, constraints, paging, retry, receipts, limits and revoked/expired sessions. Verify the actual policy helper under a restricted PostgreSQL role with a minimal test-only realtime contract fixture; label it as SQL authorization testing, not a hosted service. Browser tests cover actual Next.js endpoints and mobile widths 320/360/390/430; any simulated socket notification is explicitly a mock. Run lint, typecheck, schema validation, formatting, integration/browser regressions and production build. Do not migrate unknown databases, deploy or start Phase 6.

## User-approved refinement, October 17

The user supplied two visual references and explicitly replaced the earlier mobile navigation constraint: Calendar, Friends, a raised orange center circle containing the white transparent Merkat PNG, Chats, Profile. The center opens New chat (confirmed). The user explicitly added a real friends list to scope (confirmed), rather than a search-only placeholder. Calls/Groups remain reachable through their existing URLs; their features are not changed.

Before implementing the added scope: add one further reviewed migration for a canonical, unique pair-based Friendship with pending/accepted status and a requester who must belong to the pair. Exact-username requests require the live session; only the recipient accepts/declines, only the sender cancels, and either accepted friend can remove the relationship. Outgoing pending requests are capped and new requests use a bounded per-user database quota. Lists are paginated and expose only public profile fields. Private empty change notifications use the already reviewed Realtime channel/authorization bridge. No fake friends or automatic acceptance. Preserve existing conversations if a friendship is removed. Export a transparent white PNG from supplied vector geometry without redrawing the logo. Refine Chats/Friends spacing, bubbles and mobile dock toward the supplied references without implementing their voice/media/call examples.

The user then requested username/password-only registration/sign-in with optional email. Remove display-name/confirmation requirements from the form; default profile display name to username, keeping later profile editing available. Keep existing API clients with explicit display names compatible. A sixth additive migration is necessary to store nullable, private, unverified email on User; it is not a login/recovery identifier and is never returned by discovery or account DTOs. No email delivery/verification provider is added. The web checkout has no local auth configuration; add an explicit local development command using a real persistent, loopback-only PostgreSQL cluster owned by this checkout. It generates its own ignored credentials and migrates only that known cluster; it never reads/adopts the existing env-configured database. Normal hosted setup remains separate.

Latest navigation refinement: hide primary navigation whenever a conversation detail is open; restore it on the shared Chats inbox and other destinations. Use a shared conversation-open marker so future group detail screens follow the same rule. Add an explicit Back-to-Chats control at desktop and mobile widths; reclaim the hidden dock/sidebar space and retain bottom safe-area composer padding. Group messaging itself remains outside the Phase 5 implementation.
