# Phase 3 — account foundation

Historical Phase 3 snapshot. [Phase 3.5](phase-3.5-migration.md) supersedes the
Fastify transport/setup and OTP-provider next steps below. Current direction is
Next Route Handlers, Supabase PostgreSQL via Prisma, username/password in Phase 4
with no recovery mechanism, and managed providers validated in later phases.

## Ownership and schema

PostgreSQL owns Merkat accounts. Prisma 7.10 and the pg adapter keep it independent of Supabase APIs. Database-generated UUIDs are permanent Merkat user IDs; neither provider subjects nor usernames derive them.

The initial migration `202609120001_account_foundation` creates:

| Table            | Responsibility and constraints                                                                             |
| ---------------- | ---------------------------------------------------------------------------------------------------------- |
| User             | UUID, ACTIVE/SUSPENDED state, creation and onboarding timestamps                                           |
| Profile          | One row per user; display name, nullable unique normalized username, bio, reserved opaque avatar reference |
| ExternalIdentity | Unique exact issuer/subject pair mapped to a user UUID                                                     |
| Session          | UUID, owner, unique SHA-256 token hash, creation/expiry/revocation timestamps                              |

Foreign keys cascade on deliberate user deletion and restrict identity-key updates. No deletion API exists yet. Lowercase ASCII usernames (3–30 characters, start with a letter) are normalized by the shared validator and enforced by a database CHECK plus unique index. Phone numbers are not collected/stored before verification exists. Multiple sessions represent devices; a separate Device table would add no current responsibility.

## Trust and lifecycle

Only a trusted server-configured IdentityProvider can verify credentials. AccountService.signIn maps its verified issuer/subject, creates a new user/profile transactionally if needed and issues a fresh random 256-bit token. Concurrent first logins converge on the same unique identity. No public endpoint invokes signIn, and no request may supply a trusted user ID or verified-identity object. Future OTP integration must provide a real adapter, audience/issuer/signature/expiry checks, flow binding, abuse controls and recovery policy; this phase does not implement that protocol.

Sessions have a 30-day absolute lifetime. Validation checks the hash, expiration, revocation and ACTIVE account state on every account request. Rotation is atomic, revokes the old session and preserves the original expiry; two concurrent rotations cannot both succeed. Reauthentication can revoke the current session without signing out other devices. Raw tokens are returned only to the trusted issuance caller or Set-Cookie, never stored in PostgreSQL or returned in current-user JSON.

Production cookie: `__Host-merkat_session`, HttpOnly, Secure, SameSite=Lax, Path=/, no Domain. Development uses `merkat_session` without Secure for local HTTP. API runtime validates HTTPS APP_ORIGIN in production. Native authentication is deferred; browser mutations currently require an exact Origin and reject cross-site Fetch Metadata. No permissive CORS configuration. These policies must be revisited explicitly with a real OIDC callback flow, rather than relaxed globally.

## API and web

- GET `/auth/session`: current minimal account or 401, always no-store.
- POST `/auth/logout`: revoke and expire cookie; idempotent for absent sessions.
- POST `/auth/session/rotate`: replace an authenticated session token.
- PATCH `/account/profile`: validate/normalize fields and update only the session owner, completing initial onboarding atomically. No username-availability enumeration endpoint.

Next.js server components call Fastify with only the session cookie. Client components use a fixed allowlist proxy under `/api/account/*`, not a general-purpose URL proxy. It limits profile request bodies, forwards actual browser Origin, disables caching/redirect following, and forwards Set-Cookie. All account authorization stays in Fastify/domain/database boundaries; React never imports Prisma. No privileged tokens are placed in localStorage.

Protected routes redirect signed-out users to `/login` and incomplete accounts to `/onboarding`. The login form is visibly unavailable without a provider. Onboarding contains display name and username only; authenticated profile editing additionally offers bio. The approved shell geometry/CSS remains intact; Profile/Settings receive account controls and an obsolete no-accounts sentence is corrected.

## Security review and verification

Reviewed: client-supplied identity, fixation, cross-user profile writes, concurrent identity/session operations, cookie flags, session expiry/suspension/revocation, CSRF, unsafe redirect/proxy paths, error/body/query logging, provider coupling and client/server imports. SQL uses Prisma or tagged parameters. Account failures return bounded error codes; automatic request logging is disabled to prevent accidental query-string secrets. Database/provider errors do not reach the client. Profile writes lock the authorizing session and user row while persisting changes.

Tests use fresh real PostgreSQL clusters with the actual migration, generated client, repository, service and Fastify routes. Browser fixtures issue sessions only inside test infrastructure; no application bypass, fake OTP, development login endpoint or production seed exists. Cluster directories are confined to ignored artifacts and cleaned on normal shutdown. A killed test process may leave temporary artifacts; do not use them as application accounts.

Prisma CLI dependencies needed patched deepmerge-ts/mysql2 overrides. The pinned versions are tested through generation, migration and the full suite. This does not add MySQL to Merkat's architecture. Docker/cloud deployment, actual OTP, account recovery, media, device-management UI, all-session logout and retention cleanup remain unimplemented. No unrelated database has been modified.

## Manual setup and next gate

Provide DATABASE_URL and APP_ORIGIN to the API; optional DIRECT_URL to migration tooling; API_INTERNAL_URL to web. Examples contain blank placeholders. Run `npm ci`, `npm run build:packages`, `npm run db:migrate`, then `npm run dev`, or follow Docker instructions. Builds/tests do not require your own credentials.

Real sign-in cannot be completed until a provider is selected and securely integrated. Do not manually insert session hashes to bypass it. Stop after Phase 3; no Matrix, messaging or other product integration begins automatically.

## Changed-file map

- `packages/database/`: schema, initial SQL migration/lock, Prisma configuration, generated-client boundary, PostgreSQL environment validation and account repository; package/TypeScript/README/env configuration.
- `packages/backend/src/account/account-service.ts`, backend exports/package/README: identity/session orchestration and persistence port.
- `packages/contracts/src/account.ts`, contract exports/package: validated client-safe account/profile shapes and cookie naming.
- `apps/api/src/account-routes.ts`, app/bootstrap/environment/tests/package/env: account endpoints and runtime security configuration.
- `apps/web/src/lib/account-server.ts`, environment validation, `app/api/account/[...path]/route.ts`: server-only API integration and fixed proxy.
- `apps/web/src/app/login/`, `onboarding/`, `profile/edit/`, `error.tsx`, `account.css`, layout import and protected destination page; `components/account/` and the shell's account slot.
- `tests/integration/`, `tests/support/`, `tests/browser/auth.spec.ts`, test module/TypeScript configuration and `playwright.config.ts`: real-database and authenticated browser infrastructure. Existing shell assertions remain intact.
- Root package/lock/build scripts and generated-file ignores, local Compose/Docker/env docs, workspace READMEs and environment/architecture documentation.

The approved `globals.css`, design tokens, primary navigation definitions, icons and supplied brand assets are unchanged in this phase. No new environment file contains values or secrets.
