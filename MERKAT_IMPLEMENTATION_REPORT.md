# MERKAT implementation — 31 October 2026

Status: RELEASE BLOCKED. This report supersedes older local-only verification claims. Production has not been updated.

## Preserved implementation

Repository: S4DRA/Merkat (public). Recovery branch: fix/production-release-recovery. Development baseline fdb6944a02d2fe67be5ad6f9abb9aa87b0ff6b60 includes the previous repair branch 65fb7bf8d1e5279f74faa71657c3e8fba8553de0. No existing development work was discarded. A complete pre-recovery Git bundle was verified, and recovery commits are backed up remotely.

Architecture remains Next.js App Router, React, Prisma 7/PostgreSQL, application-managed username/password sessions, database-authoritative messaging, and private Supabase Broadcast invalidations. Matrix and phone providers remain inactive. Supabase Auth was not introduced.

## Repairs in this recovery

- Updated Zod to 4.6.7 in all consuming workspaces and Fastify to 5.12.7 in the compatibility API test workspace; refreshed compatible fast-uri resolutions. The production-only npm audit reports zero vulnerabilities.
- Removed duplicate notification-inbox realtime subscriptions on Chats, Friends and Groups. These screens reuse the existing reconciliation event; Calendar/Profile/Settings retain an inbox subscription.
- Made creation-menu focus happen at layout commit, preventing fast keyboard activation from toggling the menu closed before focus moved.
- Marked unsaved profile changes and active saves so the PWA update guard can preserve those drafts.
- Clear corrected authentication validation errors while typing, preventing a blur-triggered layout shift from moving the submit button during a click.
- Gave the calendar group picker an explicit, stable accessible label.
- Added real PostgreSQL TLS tests: trusted CA, hostname verification, unrelated CA rejection, and application-session persistence after an actual database process restart.
- Added persisted light/dark/system appearance and comfort checks. Screenshot publication was removed after automatic review rejected authenticated-image uploads.

## Feature classification

“VERIFIED WORKING” below means the isolated services and stated tests, not production acceptance.

| Feature | Classification | Evidence / limit |
|---|---|---|
| Username/password registration/login without verification | VERIFIED WORKING | Real PostgreSQL services and production HTTP browser journeys; secure cookies and shared throttling |
| Profiles, privacy, sessions, recovery codes | VERIFIED WORKING | Repository integration tests and real browser profile/session flows |
| PNG/JPG decoding, 2,000,000-byte maximum | VERIFIED WORKING | Exact-boundary and content/dimension tests; persisted real PNG upload; physical camera/gallery behavior unverified |
| DM/group HTTP state and history | VERIFIED WORKING | Three independently authenticated clients, real HTTP/PostgreSQL, refresh, authorization, invitations |
| Hosted private Broadcast | BLOCKED | Isolated socket simulations are not hosted delivery evidence; staging signing-key import and live acceptance remain |
| Calendar, optional invitations, RSVP, edits/cancellation | VERIFIED WORKING | Database integration and real HTTP/browser journeys; latest selector repair passed final browser acceptance |
| 24-hour / 5-hour reminder scheduling | VERIFIED WORKING | Deterministic database clocks, deduplication, cancellation and reconstructed workers |
| Hosted worker and actual device notifications | BLOCKED | No operational hosted execution or physical-device delivery accepted |
| Chat-only spending tabs | VERIFIED WORKING | Consent, exact minor units, 1,350 TRY example, concurrency, repayments, closing and persisted snapshots |
| Light/dark/system and comfort settings | VERIFIED WORKING | Persisted browser appearance journey; real physical devices unverified |
| PWA install and update implementation | IMPLEMENTED BUT NOT VERIFIED | Manifest/SW/offline/browser checks exist; actual Android/iOS installation and update lifecycle remain |
| Calls | NOT IMPLEMENTED | Legacy structural shell only; no calling-provider acceptance |

## Hosted environment

Existing Vercel project is retained. Production remains on main at 6ea62ba1d04f7627914c30d198c2953ed955626e.

A separate Supabase project, merkat-staging (sclhbqsprowujdmyonsc), was quoted at $0/month and created in the existing organization. No plan upgrade was performed. Paid branching failed because the organization is Free; no paid development branch was provisioned.

All 15 committed SQL migrations were applied to the empty staging database through the Supabase Management API. A Prisma-compatible baseline records their exact source SHA-256 checksums. This was not a hosted Prisma CLI migrate-deploy run. The runtime role and base grants exist; group/privacy permission confirmation expired, and its completion remains blocked. The role now has a private LOGIN credential configured only for the recovery branch Preview. Its trusted endpoint connection is not yet accepted. The staging realtime signer is deliberately unconfigured until a key is imported; production signing keys are not reused.

See MERKAT_TEST_RESULTS.md and MERKAT_PRODUCTION_READINESS.md for acceptance boundaries.
