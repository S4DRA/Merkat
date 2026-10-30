# Phase 1 architecture

Historical foundation snapshot. [Phase 3.5](phase-3.5-migration.md) supersedes the
transport/deployment boundaries below: Next Route Handlers own HTTP, guarded Next
server modules may consume backend/database, Fastify is test-reference only.

```text
apps/web       Presentation, shell, metadata; no privileged data access
apps/api       Fastify transport, validation, future auth enforcement
apps/worker    Job-process boundary; no jobs or queues yet

packages/contracts  Client-safe transport definitions
packages/backend    Product services and provider ports, server-only
packages/database   PostgreSQL/Prisma ownership, schema deferred
```

No package imports another at runtime yet. Each TypeScript server workspace emits ESM independently. Shared packages build before applications; keep explicit workspace dependencies as consumption begins. API/worker may consume backend/database; web may consume contracts only. Do not share server environment configuration with client code.

## Frontend composition

The root route is a shell preview. Desktop uses a fixed-width navigation column alongside a flexible content workspace. Mobile uses a top bar and fixed bottom navigation with safe-area padding. The intermediate tablet layout keeps the sidebar and reduces content to one column. Page content can scroll naturally and reserves space for mobile navigation. No feature routes, fake accounts, notifications, or conversations exist.

One destination definition supports classic and future central navigation. Search is classic-only. The radial hold/drag/release gesture is deferred. Current selection is component state, intentionally ephemeral. Replace it with authorized route-driven selection as real destinations are implemented.

## PWA boundary

App Router manifest, app metadata, theme color, standalone display, start URL, viewport safe areas, and no-index preview metadata exist. There is no service worker, offline caching, push subscription, background messaging, or installability claim. Manifest icons are deliberately omitted until approved square exports exist. Original supplied logo PNGs are preserved unchanged, not repurposed as incorrectly sized icons.

Future browser API calls should use a same-origin reverse-proxy path to Fastify; no proxy is needed by this disconnected shell. Native clients can use the API directly later. Choose browser cookie scope, CSRF handling, and native token flows in the identity phase.

## Validation plan

Run lint separately from Next.js build, plus strict TypeScript checks and formatting. API injection tests verify actual liveness, missing product endpoints, and fail-fast environment validation. Visually inspect mobile and desktop navigation, focus, overflow, and responsive compositions. Multi-user, auth, database, encryption, push, and offline tests belong to their implementation phases.

## Implementation order

1. Phase 1 foundation and review (current).
2. Refine approved design primitives and shell only as requested.
3. Lock identity protocol/provider and runtime compatibility before Phase 4.
4. Product database, authentication, profiles, authorization.
5. Matrix authentication/device-encryption proof, then DMs.
6. Groups/channels, messaging actions and media.
7. Contacts and privacy-aware discovery/search.
8. Plans, RSVP, calendar and durable reminders.
9. Notifications and calling.
10. Full PWA/offline behavior, cross-device reliability, alpha and beta.

Security, accessibility, privacy, and responsive behavior apply throughout.
