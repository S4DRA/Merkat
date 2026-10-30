# MERKAT implementation report

October 30, 2026, Europe/Istanbul. Continuation baseline: `466a2ac9b1ce4a06f2cc60c5154b967c935edf31`.

## Recovery and preservation

The baseline commit was recovered with a clean working tree. The repository was on `master`, without a configured remote. The requested `new-chat/work/merkat-audit` had previously described its folder; a continuation branch with that exact name has now been created. `master` retains the baseline. No reset, source replacement or production migration was performed.

Working checkout: `C:\Users\s4dra\Documents\Codex\2026-10-30\new-chat\work\merkat-audit`. The original D: checkout was not modified. An archive of the exact recovered commit was saved privately before changes. The final archive includes the full source, a Git bundle for history recovery, revision metadata, these reports and textual verification evidence. It excludes installed dependencies, generated builds/Prisma clients, personal environment files and local test databases.

The source was not pushed into the public GitHub repository. No production infrastructure, deployment, production users or production data were changed.

## Actual architecture

The active system is a Next.js App Router web application using React, shared contracts/backend packages, Prisma/PostgreSQL and private Supabase Broadcast invalidations. Database state is authoritative; clients refetch after invalidation. The worker processes durable reminder and push-delivery rows. Fastify remains a reference test application.

Matrix and phone code are inactive. The `/api/matrix` compatibility route does not establish a functioning Matrix homeserver integration. This continuation tests the active messaging architecture; it does not silently replace it or claim Matrix delivery. Restoring Matrix would require an explicit architecture/integration decision and real test infrastructure.

## Preserved implementation

| Area                   | Behavior in source                                                                                                                                                                                                                                              | Verification limit                                                                                                                               |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Accounts               | Username/password registration and login; email optional; no phone, email or OTP verification required. Argon2id credentials, hashed HttpOnly sessions and persistent rate limits.                                                                              | Real authenticated HTTP/DB acceptance blocked by host networking.                                                                                |
| Profiles               | Editable identity/bio, related-person profile views and private avatars. Blocked/unrelated viewers are denied by repository checks.                                                                                                                             | Image processing is tested; private persistence has an added service test that could not execute.                                                |
| Avatars                | PNG/JPG only; maximum 2,000,000 input bytes; actual signature/decode checks; bounded pixels/dimensions; normalized 512-square JPEG with metadata removed.                                                                                                       | Native image unit tests pass, including exact size and dimension boundaries. Real upload/DB/browser scenario remains blocked.                    |
| Recovery/sessions      | Eight hashed single-use offline codes, current-password confirmation, password change, session revocation, logout push cleanup and session rotation.                                                                                                            | Added/expanded real-service scenarios; not executed here.                                                                                        |
| Appearance and comfort | Light/dark/system, OS changes, larger text, reduced motion, responsive layouts, visible focus and dialog focus return.                                                                                                                                          | Component/browser checks pass; no full WCAG certification or screen-reader claim.                                                                |
| Messaging/groups       | Existing persistent DM/group services, invitation acceptance, membership/role/privacy checks, ordered messages, dedupe and receipts.                                                                                                                            | Real group/DM service and HTTP tests are present but blocked. Hosted private realtime remains unverified.                                        |
| Calendar               | Month/week/day/agenda; personal/DM/group events, invitations, RSVP, independent calendar subscription, edit/cancel, ICS export, native conversation cards and composer shortcuts. UTC storage with IANA display zones and explicit DST ambiguity/gap rejection. | UI and time calculations tested independently; real synchronization, invitation and service acceptance blocked.                                  |
| Reminders              | Durable 24-hour and 5-hour jobs, versioning, opt-out, cancellation, unique notification keys and worker claims.                                                                                                                                                 | Deterministic service tests cover both offsets, duplicate workers and worker reconstruction; cannot execute without DB sockets.                  |
| Spending tabs          | Chat-only entry, group-admin/owner or DM management, own/shared orders, equal/quantity/custom allocations, explicit consent, venue payments, recipient-confirmed repayments, closure snapshot and saved cards.                                                  | Integer calculation and SQL integrity pass. Real concurrency/consent/session-history tests remain blocked.                                       |
| Notifications/push     | In-app inbox, explicit browser opt-in, session-bound subscriptions, durable delivery intents, retries/leases and dead-endpoint cleanup.                                                                                                                         | Unconfigured push is verified to fail closed. Scheduling, provider acceptance and device display are separate stages; actual push is unverified. |

## Changes made during this continuation

1. Added a loopback preflight to the isolated PostgreSQL harness. It fails with `TEST_ENVIRONMENT_BLOCKED` before starting a database when the host rejects connections, preventing the previous stalled setup/cleanup cycle. It never converts a blocked test into a pass or skip.
2. Fixed stale registration copy assertions and ambiguous Edit profile selectors in existing browser tests.
3. Expanded the real collaboration integration suite: private-avatar bytes/settings across independent clients, two-way retry-safe DMs, three-user group messages, explicit invitations, both reminder offsets, duplicate/reconstructed workers, versioned rescheduling/cancellation, tab concurrency/idempotency/rounding/decline, closed snapshots, member removal, password change and recovery.
4. Added a browser acceptance scenario using three independently authenticated contexts, real HTTPS Next routes and the isolated database. It has no mocked HTTP responses or fake realtime notifications. It explicitly reloads for persistence and does not claim hosted live delivery.
5. Extended SQL verification to reopen the same cluster in a second PostgreSQL process and assert persisted users, closed expenses and used recovery codes. Checked server-role access through new-table RLS.
6. Added exact-2-MB image and compressed-small/wide-dimension tests, and a fail-closed push test using a real lazy client without a live database.
7. Expanded component checks for system theme changes, larger text and narrow/tablet layouts.
8. Filled a product gap: personal event creation now exposes optional username invitations, reusing existing server validation and participant consent. Added form payload and service tests for it.
9. Added a manually triggered GitHub Actions verification workflow with read-only repository permissions, isolated tests and no deployment steps. It was not dispatched or published remotely.

## Deliberate limits

Confirmed shared orders cannot be silently amended, and closed expense sessions cannot be reopened. There is no unanimous shared-expense correction workflow, tax/discount/refund automation, external payment processing, recurring-event editor, calls or media messaging. Tabs record obligations; they do not transfer money. Personal-event invitees can be selected at creation; there is no subsequent invitee-management screen.

The changes are a preserved, buildable candidate. They are not certified production-ready. See `MERKAT_TEST_RESULTS.md` for evidence and `MERKAT_PRODUCTION_READINESS.md` for release blockers.
