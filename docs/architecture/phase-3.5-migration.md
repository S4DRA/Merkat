# Phase 3.5 migration

Historical Phase 3.5 report. [Phase 4 authentication](phase-4-authentication.md)
supersedes its unavailable-sign-in statements and adds the reviewed password/rate
limiter migration. Earlier schema/session/transport decisions remain applicable.

## Inspection and plan (before implementation)

The checkout is an npm workspace with Next.js 16.3.4, Fastify 5.12.3,
Prisma/pg adapter 7.10.0 and PostgreSQL. Phase 3 notes describe only account
endpoints, but the actual API also registers phone, plans, people and Matrix
routes. The second existing migration adds plans and enables RLS. Both migrations
and all permanent UUID/ExternalIdentity mappings must remain intact.

Actual browser consumers use `/api/account/*` and `/api/matrix/*`; server pages
fetch Fastify through `API_INTERNAL_URL`. No middleware supplies authorization.
AccountService and the Prisma repositories own session/account authorization.
The navigation has five destinations; its middle Plans slot has a calendar icon,
not a plus. The official orange-on-white PNG is documented in public/brand.

The user confirmed that phone/Supabase Auth and self-hosted Matrix files should
remain inactive legacy code, their Next endpoints unavailable, and plan APIs
preserved. No new authentication or provider integration is authorized.

1. Add a server-only HTTP adapter around existing account/domain/repository code.
   Keep existing browser URLs and provide canonical `/api` transport URLs.
2. Test Fastify/Next response parity against the same isolated PostgreSQL cluster
   before removing Fastify from default development, build and browser execution.
   Retain its files and dependencies for reference/parity tests.
3. Replace self-fetching server pages with direct AccountService calls. Reuse a
   lazy Prisma client per Next process; retain the bounded pg pool.
4. Preserve cookies, absolute expiry, atomic rotation/revocation, ownership,
   no-store responses, exact-origin CSRF checks, bounded bodies and safe errors.
5. Keep Prisma's existing DIRECT_URL migration configuration; document Supabase
   pooled runtime URLs, isolated setup and Vercel monorepo generation/build.
6. Change only the middle navigation icon to the existing official asset. Verify
   mobile account/navigation behavior at 320/360/390/430px and landscape.

## Risks and dependencies

- In-memory OTP challenges/rate limits and Matrix token caches depend on one
  long-running process. They cannot safely become serverless authentication.
  They remain disconnected; no token exchange or E2EE claim is made.
- Production requires an explicitly configured HTTPS APP_ORIGIN. Tests must use
  an HTTPS origin for API CSRF assertions. Browser tests use production cookie
  policy over test-only HTTPS. Host/forwarded headers never choose trusted origin.
- Missing credentials must leave signed-out login usable while authenticated
  database operations fail closed. No seeded application account or auth bypass.
- A Prisma pool is per warm process, not global across Vercel instances. Use the
  Supabase transaction pooler at runtime and budget connection limits separately.
- Existing migration RLS does not replace Merkat server-side authorization or
  grant browser Data API access. Do not apply migrations to an unknown database.
- The checkout starts entirely untracked. Preserve user files; no reset, clean,
  bulk deletion, schema change, deployment or production data modification.
- The host currently runs Node 24.21.0 although package engines request Node 22.
  Record the actual validation runtime and verify a supported deployment runtime.

## Verification and completion

### A–B. Inspected implementation and final architecture

Inspected package scripts/lockfile, Fastify registration/bootstrap/provider files,
Next route handlers/pages, account/plan consumers, shared contracts/services,
Prisma schema and both migrations, session repository, cookies, account forms,
navigation/CSS/assets, environment examples/key ownership, tests, local Compose,
deployment and Phase 1–3 architecture notes. Real env values were not printed or
modified. The authoritative product schema is `packages/database/prisma`; the
unrelated empty root Prisma scaffold remains untouched.

Next now owns product HTTP in Node.js Route Handlers. Handlers dispatch to a
guarded server-only HTTP adapter; AccountService and PlanService own domain logic,
and Prisma repositories retain persistence. Server pages call AccountService
directly, without an internal HTTP hop. One lazy shared Prisma client/pool is
reused per warm process. Backend/database imports remain blocked in client files;
the explicit server directory is the only web exception.

Fastify parity passed before its run/build scripts and default process dependency
were removed. Its source stays as an inactive reference, with development-only
dependencies. The user-authorized phone/Matrix adapters remain disconnected; no
OTP state, Synapse provisioning, token cache or provider polling runs in Next.
Existing plan APIs remain available; the approved shell does not gain new plan UI.

### C. Endpoint inventory

| Existing Fastify endpoint   | Next canonical transport                    | Existing browser URL retained                      |
| --------------------------- | ------------------------------------------- | -------------------------------------------------- |
| GET `/health/live`          | GET `/api/health/live`, also `/health/live` | Liveness only                                      |
| GET `/auth/session`         | GET `/api/auth/session`                     | GET `/api/account/session`                         |
| POST `/auth/logout`         | POST `/api/auth/logout`                     | POST `/api/account/logout`                         |
| POST `/auth/session/rotate` | POST `/api/auth/session/rotate`             | POST `/api/account/rotate`                         |
| PATCH `/account/profile`    | PATCH `/api/account/profile`                | Same                                               |
| GET `/plans`                | GET `/api/plans`                            | GET `/api/account/plans`                           |
| POST `/plans`               | POST `/api/plans`                           | POST `/api/account/plans/create`                   |
| PATCH `/plans`              | PATCH `/api/plans`                          | PATCH `/api/account/plans/respond`                 |
| POST `/people/find`         | POST `/api/people/find`                     | POST `/api/account/people/find`                    |
| POST `/auth/phone/start`    | POST `/api/auth/phone/start`                | POST `/api/account/phone/start` — unavailable, 503 |
| POST `/auth/phone/verify`   | POST `/api/auth/phone/verify`               | POST `/api/account/phone/verify` — rejected, 401   |
| POST `/messaging/connect`   | POST `/api/messaging/connect`               | POST `/api/account/messaging/connect`              |
| POST `/messaging/rooms`     | POST `/api/messaging/rooms`                 | POST `/api/account/messaging/rooms`                |
| GET/POST/PUT `/matrix/*`    | GET/POST/PUT `/api/matrix/*`                | Same                                               |

Messaging returns 401 without a completed authenticated account, otherwise 503.
No provider request is made. Bare legacy product API paths move under `/api`;
`/plans` stays the existing UI route. All actual browser consumers keep their URLs.
Wrong allowlist entries return 404. JSON bodies are bounded (8 KiB account/plan,
1 KiB phone, 1 MiB inactive Matrix), malformed JSON returns 400, oversized bodies
413 and unsupported content types 415. These are deliberate transport hardening;
valid existing request/response semantics remain compatible.

### D. Preserved behavior

- Permanent database UUIDs, exact ExternalIdentity mappings, both migration files
  and schema are byte-for-byte unchanged.
- Existing session service/repository remain unchanged: 256-bit random secrets,
  SHA-256 hashes, 30-day absolute expiry, active-account validation, revocation,
  atomic rotation preserving expiry and independent device sessions.
- Cookies remain HttpOnly, host-only, Path=/, SameSite=Lax and Secure with the
  `__Host-` prefix in production. Logout expires the cookie; absent logout is
  idempotent. No token is returned in account JSON or stored in localStorage.
- Exact configured Origin and Fetch Metadata checks protect mutations. There is
  no permissive CORS, arbitrary URL proxy or user-controlled redirect destination.
  Fixed-text errors/logging omit token, profile, query and connection details.
- Session-owned profile writes, normalization/conflict semantics, onboarding,
  plan participant visibility/RSVP and owner-only cancellation are retained.
- No credential-verification endpoint is active, so no in-memory brute-force
  limiter is presented as distributed authentication protection. Phase 4 requires
  real shared abuse controls before enabling username/password.

Two existing TypeScript incompatibilities were necessary to unblock validation:
an absent plan conversationId now persists as null instead of undefined; legacy
route option types explicitly permit undefined as their existing bootstrap passes.
The integration runner now explicitly preserves failing exit status after cluster
shutdown; embedded-postgres's beforeExit hook otherwise forced an exit code of 0.

### E–F. Supabase/Prisma and Vercel

Prisma/adapter versions remain 7.10.0. Existing config already supports DIRECT_URL
for CLI migration and DATABASE_URL fallback, so no config/schema/migration rewrite
was needed. Runtime consumes pooled DATABASE_URL through the existing bounded pg
adapter; the singleton adds safe process reuse. No external database was contacted.

See [environment setup](environment.md) for local/staging/production distinctions,
TLS, roles/RLS and URL ownership, and [Vercel settings](../../infra/deployment/README.md)
for root/install/build/runtime configuration. Generation and local production build
pass without hosted credentials. No deployment or hosted migration was performed.

### G–H. Logo and mobile review

The supplied orange-on-white PNG is used directly in the middle Plans slot. Its
SHA-256 remains `efedbc064296bd4593d0bd4723d1285b8ae6f3021e68cf5fb3fb3c40d56a0987`.
No art was generated, redrawn, recolored, cropped or altered. The existing link,
label, selection, position, touch target and focus style are preserved. The
decorative image has empty alt text so the Plans link keeps one accessible name.

The disconnected phone form previously promised an SMS code. Login now says only
“Sign-in is unavailable.” with a disabled Continue button. Existing phone UI files
remain inactive. No password form or simulated authentication was added.

At 320/360/390/430px, tests verify overflow, touch sizes, navigation position,
profile focus/input sizing, short viewport input visibility, network error recovery
and browser back navigation. Existing landscape, dialog focus and reduced-motion
tests pass. Visual review covered 320px mobile shell/profile and 1440px desktop;
the existing shell composition is retained. No additional mobile layout defect
required changing approved spacing or geometry. Safe-area CSS/viewport-fit remain
unchanged; physical cutouts and real OS keyboard behavior are unverified.

### I. Files changed

| Area                     | Files                                                                                                                                                                                                                                                                   |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTP and server boundary | `apps/web/src/lib/server/http-api.ts`, `runtime.ts`; `lib/account-server.ts`, `environment.ts`; `app/api/[...path]/route.ts`, `api/account/[...path]/route.ts`, `api/matrix/[...path]/route.ts`, `health/live/route.ts`                                                 |
| Domain/database          | `packages/backend/src/plan-service.ts`, `src/index.ts`, `package.json`, `README.md`; `packages/database/src/plan-repository.ts`, `README.md`, `.env.example`                                                                                                            |
| Web/build                | `apps/web/package.json`, `next.config.ts`; root `package.json`, `package-lock.json`, `eslint.config.mjs`                                                                                                                                                                |
| Navigation/login         | `apps/web/src/components/shell-navigation.tsx`, `app/globals.css`, `app/login/page.tsx`                                                                                                                                                                                 |
| Legacy reference         | `apps/api/package.json`, `src/account-routes.ts`, `.env.example`                                                                                                                                                                                                        |
| Environment/local        | root `.env.example`; `apps/web/.env.example`; `infra/local/.env.example`, `compose.yaml`, `README.md`                                                                                                                                                                   |
| Documentation            | root `README.md`; `docs/architecture/environment.md`, `foundation.md`, `phase-3-accounts.md`, this report; `infra/deployment/README.md`                                                                                                                                 |
| Tests                    | `playwright.config.ts`; `tests/browser/auth.spec.ts`, `migration.spec.ts`; `tests/integration/migration.test.ts`; `tests/support/browser-server.ts`, `run-integration.ts`, `check-unconfigured.ts`, `tls/README.md`, `tls/localhost-test.crt`, `tls/localhost-test.key` |

All original logo files, unrelated source, real env files, schema and migrations
remain intact. Public self-signed TLS fixtures are test material, never deployment
credentials. Generated build/client/screenshots/state remain ignored.

### J. Exact validation outcomes

The host defaults to Node 24.21.0/npm 11.4.2. Supported-runtime validation used
`npm exec --yes --package=node@22.17.0 -- <command>` with these commands:

| Command                               | Result                                                                                                                                       |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`                            | Exit 0; 2 reference API tests + 11 real PostgreSQL integration/parity/security tests passed                                                  |
| `npm run test:ui -- --max-failures=1` | Exit 0; all 18 Chromium tests passed in 27.4 seconds, built Next with production Secure cookies over local HTTPS, no Fastify process         |
| `npm run test:unconfigured`           | Exit 0; two credential-free production server runs passed login/liveness/redirect/fail-closed assertions, with APP_ORIGIN absent and set     |
| `npm run typecheck`                   | Exit 0 after the two documented compatibility fixes                                                                                          |
| `npm run build`                       | Exit 0; Prisma generation, shared packages and optimized Next production build passed after final source formatting                          |
| `npm run lint`                        | Exit 1; one pre-existing set-state-in-effect error at `apps/web/src/components/plans/plan-workspace.tsx:20` (unchanged inactive component)   |
| `npm run format:check`                | Exit 1; 81 pre-existing unformatted files, primarily bundled local skills and inactive legacy/provider code; no unrelated reformat performed |

Additional checks: `npm run db:validate` exited 0; changed-file ESLint and Prettier
checks exited 0. `npm ls fastify @fastify/cookie --omit=dev` showed an empty tree.
Runtime-source and Next file-trace scans found no Fastify/API process dependency;
client chunk scans found no account repository, session hashing or Matrix admin
implementation. Schema and both migrations compared byte-for-byte unchanged.

`npm install --package-lock-only --ignore-scripts` synchronized workspace metadata;
versions were not upgraded. npm reported 13 dependency advisories overall. A
runtime-only audit reported 4 (1 moderate, 2 high, 1 critical), including the
existing pinned Next version. Dependency remediation remains a release blocker;
no automatic package upgrade was mixed into this migration.

Initial verification failures were corrected: test module ESM resolution, a
millisecond-sensitive expiry assertion, ambiguous Next route-announcer locator,
a shared-session rotation fixture and waiting for navigation before browser Back.
The passing outcomes above are the reruns after those fixes, not initial attempts.

### K–M. Setup, remaining limits and Phase 4 recommendation

Provide DATABASE_URL and exact APP_ORIGIN in `apps/web/.env.local` for local work,
or Vercel's server environment for staging. Export reviewed DIRECT_URL separately
for migrations. Use blank examples as templates; do not reuse test fixtures as
accounts or deploy the test TLS key. See the environment/deployment docs for exact
settings. No user action is required to preserve existing files; hosting still
requires the user's own project values and later explicit deployment authorization.

Unverified: hosted Supabase connectivity, TLS/pooling/role access, Vercel deployment
and file tracing, Docker execution, physical mobile safe areas/keyboards, real
Matrix/E2EE/LiveKit/Storage, backups and restore. Existing repository-wide lint,
formatting and dependency advisories remain visible. No production-ready claim.

Recommend reviewing Phase 3.5, then a separately authorized Phase 4 for
username/password only, no recovery mechanism, server-side password hashing,
shared rate limiting/abuse protection and secure credential-to-existing-UUID
mapping. Phone may only become an optional verified privacy-controlled profile
attribute later. Validate managed Matrix authentication compatibility before
Phase 5; do not invent a token exchange or claim E2EE before cross-device tests.
Managed LiveKit and private authorized Supabase Storage remain later work.

Stop here. Phase 4 and additional product features have not been started.
