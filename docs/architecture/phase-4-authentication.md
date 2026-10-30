# Phase 4 — username/password authentication

## Inspection and implementation plan

Phase 3.5 has secure session persistence and profile authorization, but no active
credential verifier. Reuse AccountService, Session and Profile; keep existing UUIDs,
ExternalIdentity mappings, plans, shell/navigation and all supplied brand files.

A new migration is necessary for a one-to-one PasswordCredential record and a
shared AuthRateLimit table. The limiter uses atomic PostgreSQL upserts and database
time, six fixed scopes and bounded HMAC slots; it does not depend on a warm Vercel
instance, another paid provider or background cleanup. Expired counters reset on
access. No raw username, IP, password or password hash is stored in limiter keys.
Production auth fails closed without its shared secret and trusted Vercel source
header. Development uses one local source bucket, never arbitrary forwarded IPs.

Registration will validate shared username/password rules, hash with Argon2id,
then atomically create User/Profile/PasswordCredential/Session with onboarding
complete. Login will perform one real-or-dummy Argon2 verification, then recheck
credential/account/profile state while issuing the existing 30-day session. No
recovery/reset, phone authentication or automatic legacy-account linking is added.

Usernames retain lowercase normalization and database constraints; add an explicit
case-insensitive unique index and reject reserved names for new/changed values.
Existing records are not renamed or backfilled. Existing migrations remain intact.

Add concise login/registration forms with password confirmation/visibility,
autofill and a short no-recovery warning. Verify entry into the real app, profile
editing, logout, multiple devices, rate limits and mobile widths using isolated
PostgreSQL. Do not migrate the existing env-configured database or deploy.

Review official security releases rather than applying audit fixes blindly. The
October 14 release requires Next 16.4.1 even though the npm audit initially suggests
16.3.8 for older advisories; validate the smallest fully patched compatible release
and matching eslint-config-next. Fix the existing plan-component lint issue
without activating it. Format only touched application source; leave bundled skills
and inactive references outside unrelated formatting changes.

## Implementation and verification

### A. Existing architecture inspected

Read the Phase 3/3.5 reports, current Next/Fastify transports, auth/profile forms,
all session operations/repositories, contracts, Prisma schema and migrations,
tests, env ownership and package/lockfile. No existing credential table or working
username/password verifier existed. The Fastify/phone/Matrix reference code stays
inactive. No supplied logo or navigation configuration was changed.

### B. Database and migration

`202610160001_password_authentication` adds PasswordCredential (UUID owner, Argon2id
hash, creation time) and AuthRateLimit (scope/slot, capped attempts, expiry).
Registration creates user/profile/credential/session in one transaction. Credential
ownership cascades only on deliberate user deletion; UUID updates remain restricted.

The existing lowercase username CHECK and unique constraint remain. A unique
lower(username) index explicitly enforces insensitive uniqueness. A reserved-name
CHECK is NOT VALID for historical rows so no existing name is silently rewritten;
new/updated rows are checked immediately. The earlier two migrations are unchanged.
Index creation can block profile writes; review the migration window before any
future production application. No hosted/unknown database was migrated here.

Both new tables enable RLS and revoke PUBLIC privileges. Merkat server authorization
is retained; no Supabase Auth JWT policy or anonymous client credential access is
added. Staging must validate the Prisma role's grants and Data API exposure.

### C–E. Registration, login and sessions

POST `/api/auth/register` and `/api/auth/login` are also available through existing
browser transport aliases `/api/account/register` and `/api/account/login`.
Registration requires display name, normalized unique username and password; the
UI also requires matching confirmation. Registration marks onboarding complete and
enters `/chats` with a valid profile and session. Optional bio uses existing editing.

Shared contracts enforce 3–30 lowercase ASCII username characters (letter first),
normalization and reserved names. Passwords accept 15–128 characters, Unicode,
spaces, paste and password managers; passwords are never trimmed or normalized.
No arbitrary composition rule, phone or email is required.

Pinned `argon2@0.45.1` uses Argon2id v19, 19 MiB, two iterations, one lane and
32-byte output with library-generated random salts. These match the
[OWASP minimum parameters](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).
No plaintext/reversible password is persisted. Every login performs one real or
dummy Argon2 verification, including missing/credential-less/suspended accounts;
the same dummy readiness promise is awaited on both paths. No quick existing-user
branch returns before hashing. Login errors are generic 401s; no session is created.
Registration performs hashing before discovering uniqueness conflicts and returns
a generic account-creation conflict. Public registration necessarily reveals
success versus failure; shared quotas bound that residual availability signal.
There is no standalone username-availability endpoint.

After verification, login locks and rechecks the active user, credential hash and
current username. Reauthentication locks the prior session first, matching profile
write lock order. Session material uses the existing 256-bit token/SHA-256 hash and
30-day lifetime. Same-user current-device replacement, independent device sessions,
expiry, rotation and logout/revocation remain intact. Only HttpOnly Set-Cookie
receives the raw token; account JSON never contains a token or credential hash.

Existing ExternalIdentity mappings remain untouched. Registration never attaches a
password to an existing legacy identity by matching its username. Legacy accounts
without credentials remain credential-less; no default password or recovery bypass
is created.

### F. Shared abuse protection

| Operation    | Source quota    | Account quota   | Global quota |
| ------------ | --------------- | --------------- | ------------ |
| Login        | 30 / 15 minutes | 10 / 15 minutes | 120 / minute |
| Registration | 10 / hour       | 3 / hour        | 60 / hour    |

All instances consume PostgreSQL counters through atomic UPSERTs in short
transactions. Database statement time controls expiry; expired windows reset
lazily. Denied attempts commit capped counters. Source/account checks precede the
global counter so already-rejected attempts do not consume the global hash budget.
No locks are held during Argon2 work. No in-memory limiter or paid provider exists.

HMAC slots prevent storing raw names/IPs, and SQL constraints bound the table to
262,146 possible rows (four 65,536-slot scopes and two single-row global scopes).
No cleanup daemon is required for correctness or storage bounds. Slot collisions
conservatively share quotas; shared NATs and attacked usernames can temporarily
throttle legitimate users. Limits are initial pilot values; validate legitimate
traffic and coordinated-abuse behavior in staging before a public release.

Production requires Vercel's platform-provided source header, a valid IP and a
shared 64-hex AUTH_RATE_LIMIT_SECRET. IPv6 is canonicalized/grouped by /64; mapped
IPv4 and ordinary IPv4 share a source. Untrusted X-Forwarded-For and malformed chains
cannot choose fresh buckets. Missing trusted ingress, secret or limiter fails
closed with 503. VERCEL must come from the platform, not be enabled manually on
arbitrary public servers. Local development uses one real shared local source
bucket. The HTTPS browser harness models the platform by replacing input headers.
These controls do not claim to eliminate volumetric denial of service or replace
deployment-level traffic protection.

### G. Mobile UI/UX

Login/registration reuse AccountFrame, Button, colors, typography, approved PNGs
and account primitives. No shell redesign, radial navigation or fake activity.
Fields have explicit labels, autofill attributes, visibility buttons, accessible
errors, focus states and comfortable targets. POST form methods prevent passwords
falling into a default GET query before hydration. Submission stays disabled during
requests and successful navigation. Reserved feedback space reduces error shifts;
input scroll margins and existing safe-area/dynamic-viewport CSS are preserved.

“Lost passwords can’t be recovered.” appears before account creation. No recovery
link/endpoint, administrator disclosure or encryption-key restoration claim exists.
Tests cover all requested widths, shortened viewports, landscape, navigation Back,
network failures, visibility controls, loading and reduced motion. Visual review
covered 320px registration and 390px login. Real OS keyboards, third-party password
manager software and physical cutouts remain unverified.

### H. Security review and compatibility fixes

- Existing exact-origin/Fetch Metadata CSRF checks and bounded JSON body parsing
  apply before credential operations. No permissive CORS or unsafe return URL.
- Production cookies keep __Host-, Secure, HttpOnly, SameSite=Lax, Path=/, no Domain.
  Account/profile responses retain no-store and session-owned authorization.
- No credential/hash/request body is logged. Failure logs contain fixed text only.
  No server secret, repository or Argon2 implementation is imported by client code.
- SQL values use Prisma/tagged parameters; no client-selected identity is trusted.
- Next server bundles can load distinct constructor copies. Domain errors now use
  a non-enumerable shared Symbol brand, allowing HTTP adapters to recognize errors
  from the cached service bundle. Unknown errors remain bounded 503s. Browser tests
  caught and now verify wrong-password 401, duplicate-account 409 and throttled 429.
- The inactive plan component now initializes query state through useSearchParams
  under Suspense, and its async fetch updates use callbacks with unmount protection.
  This resolves the existing lint error without enabling that component.

### I. Files changed

| Area               | Files                                                                                                                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contracts          | `packages/contracts/src/account.ts`, `index.ts`, `plans.ts` (format only)                                                                                                                                                             |
| Domain             | `packages/backend/src/authentication.ts`, `domain-error.ts`, `account/account-service.ts`, `index.ts`, `plan-service.ts` (error recognition), `plans.ts` (format only); backend `package.json`, `README.md`                           |
| Database           | `packages/database/prisma/schema.prisma`, new `202610160001_password_authentication/migration.sql`; `src/credential-repository.ts`, `authentication-limiter.ts`, `account-repository.ts` (DTO helper export), `index.ts`; `README.md` |
| Next server/routes | `apps/web/src/lib/server/authentication-environment.ts`, `runtime.ts`, `http-api.ts`; `app/api/account/[...path]/route.ts`; `app/login/page.tsx`, `app/register/page.tsx`                                                             |
| UI                 | `components/account/authentication-form.tsx`, `profile-form.tsx`, `components/plans/plan-workspace.tsx`; `app/account.css`                                                                                                            |
| Packages           | Root `package.json`, `package-lock.json`; `apps/web/package.json`; generated `apps/web/next-env.d.ts`                                                                                                                                 |
| Environment/docs   | Root `.env.example`, `README.md`; `apps/web/.env.example`; `infra/local/.env.example`, `compose.yaml`, `README.md`; `infra/deployment/README.md`; `docs/architecture/environment.md`, this report and Phase 3.5 historical notice     |
| Tests              | `tests/integration/authentication.test.ts`; `tests/browser/auth.spec.ts`, `password-auth.spec.ts`; `tests/support/browser-server.ts`, `run-integration.ts`                                                                            |

Supplied assets, navigation config and shell CSS are unchanged. Real env files are
untouched. The two pre-existing migrations compare byte-for-byte unchanged.

### J. Exact validation results

Supported validation runtime: Node 22.17.0, npm 11.4.2. Commands were invoked with
`npm exec --yes --package=node@22.17.0 -- <command>` because the host defaults to
Node 24.21.0. No external database/provider credentials were used for tests.

| Command                               | Result                                                                                                                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm test`                            | Exit 0: 2 reference unit tests and 24 isolated PostgreSQL integration tests passed                                                                                             |
| `npm run test:ui -- --max-failures=1` | Exit 0: all 25 Chromium tests passed in 32.9 seconds using built Next over test HTTPS; actual registration/login/cookies/401/409/429 and Phase 3.5 shell regression coverage   |
| `npm run typecheck`                   | Exit 0 across workspaces and test files                                                                                                                                        |
| `npm run lint`                        | Exit 0, zero warnings; existing application lint error resolved                                                                                                                |
| `npm run db:validate`                 | Exit 0; Prisma schema valid                                                                                                                                                    |
| `npm run build`                       | Exit 0; generation/shared packages/optimized Next 16.4.1 build passed                                                                                                          |
| `npm run test:unconfigured`           | Exit 0; login/liveness/redirect/fail-closed assertions passed without credentials, APP_ORIGIN absent and set                                                                   |
| `npm run format:check`                | Repository-wide check retains 78 existing failures: 71 bundled skill files, 6 inactive Fastify references, 1 inactive phone form. No active project source remains unformatted |

New integration tests cover atomic registration and conflicts, normalization,
reserved/invalid input, Unicode/password hashing, generic missing/wrong/suspended
credentials with one verification each, device sessions, expiry/rotation/revocation,
renaming/ownership, independent limiter clients/concurrent increments/expiry,
bounded scopes/slots, legacy identity protection, CSRF/cookies, missing recovery,
trusted source normalization, limiter failure and concurrent profile/reauth locks.
Integration files run serially to avoid cross-file fixture-count races; explicit
concurrency tests still use independent database clients and simultaneous requests.
Actual route-export tests additionally verify local HTTP registration/login/logout,
immediate onboarding completion and development cookie flags without Vercel mode.

Initial failures corrected before passing reruns: the Argon2 library serializes
PHC parameter order as m,p,t (the reviewed CHECK accepts both equivalent orders),
a missing shared contract export, cross-bundle error identity and a test navigation
wait. No initial failed attempt is reported as passing.

### K. Dependency advisory status

Next and eslint-config-next move from 16.3.4 to 16.4.1; Sharp moves to 0.35.5 through
Next's dependencies. Official October 14 advisories require 16.4.1; the older
16.3.8 patch would not cover the newly disclosed issue. 16.4.2 contains subsequent
maintenance fixes; 16.4.1 is the smallest patched compatible upgrade requested.
The local app builds and browser tests pass on it. No audit fix --force was run.

The runtime audit reports **2 unresolved advisories**: fast-uri (moderate) and
source-map-js (high). The full audit reports **11** (2 moderate, 7 high, 2 critical),
including development-only concurrently/shell-quote criticals and lint/reference
tooling. Next/Sharp are no longer listed. Remaining dependency remediation and
deployment review are required before a production-ready claim; unrelated tooling
upgrades were not mixed into this phase.

Sources: [Next security release](https://nextjs.org/blog/nextjs-security-update-october-14-2026),
[Next typed-array advisory](https://github.com/vercel/next.js/security/advisories/GHSA-673q-mjm6-r5xr),
[16.4.2 maintenance changes](https://github.com/vercel/next.js/releases/tag/v16.4.2),
[Vercel source headers](https://vercel.com/docs/headers/request-headers#x-vercel-forwarded-for),
[node-argon2](https://github.com/ranisalt/node-argon2).

### L. Required setup

1. Use Node 22/npm 11 and install from the root with `npm ci`.
2. Configure a **reviewed local/staging** PostgreSQL target. Supabase runtime uses
   the pooled connection; DIRECT_URL is the migration connection. Do not assume an
   existing root/infra env URL is safe to migrate. The root env is not Next's env.
3. Copy `apps/web/.env.example` to `apps/web/.env.local`; set DATABASE_URL,
   `APP_ORIGIN=http://localhost:3000` (or the exact local origin), and a random
   64-hex AUTH_RATE_LIMIT_SECRET. Generate it with
   `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.
4. Export reviewed DATABASE_URL/DIRECT_URL for the Prisma CLI, then run
   `npm run db:migrate` against that local/staging target. Do not run it against
   unknown/production data. No migration runs on install/build/start.
5. Restart `npm run dev`, open `http://localhost:3000/register`, and create a real
   account. No seeded login or external Supabase Auth key is required.

For Vercel, supply the same server-only limiter secret across instances, exact HTTPS
APP_ORIGIN and pooled DATABASE_URL. Validate trusted source headers, new-table role
access, RLS/Data API isolation and native Argon2 file tracing in staging. See
[environment ownership](environment.md) and [deployment settings](../../infra/deployment/README.md).
Standalone public self-hosted production auth is intentionally unsupported without
a separately validated trusted ingress; do not spoof VERCEL=1 to enable it.

### M. Blockers and unverified behavior

No implementation blocker remains in isolated local validation. The user's actual
database is not configured/migrated by this work: local use still needs the reviewed
env values and new migration above. Production migration/deployment, Supabase
pooling/TLS/role grants, real Vercel header guarantees/native tracing, load/abuse
calibration, Docker execution, physical devices and actual password-manager apps
remain unverified. The known dependency advisories and 78 inactive/bundled formatting
failures remain accurately reported. No production-ready claim is made.

No password recovery, Matrix, messaging, groups, calls, radial navigation, phone
verification/discovery or additional product feature was started. No encryption
key restoration or E2EE claim. Stop after Phase 4.
