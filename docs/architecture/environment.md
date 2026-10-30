# Environment ownership — Phase 4

| Owner                        | Variable               | Behavior                                                                                       |
| ---------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------- |
| Next server / Prisma adapter | DATABASE_URL           | Server-only PostgreSQL runtime URL; Supabase transaction pooler when hosted                    |
| Next server / Prisma adapter | DATABASE_CA_CERT       | Optional server-only PEM root CA; requires verify-full and no sslrootcert parameter            |
| Next HTTP adapter            | APP_ORIGIN             | Exact browser origin, no credentials/path/query/trailing slash; HTTPS in production            |
| Next runtime                 | NODE_ENV               | Set by Next; development/production cookie policy                                              |
| Prisma migration CLI         | DIRECT_URL             | Direct/session-mode connection; existing config falls back to DATABASE_URL                     |
| Integration runner only      | TEST_DATABASE_URL      | Generated isolated database; never consumed by product code                                    |
| Auth server                  | AUTH_RATE_LIMIT_SECRET | Required 32-byte random shared secret encoded as 64 hex characters; HMAC limiter slots only    |
| Vercel platform              | VERCEL                 | Production auth requires the platform-supplied value `1`; never derive it from request headers |
| Vercel platform              | VERCEL_ENV, VERCEL_URL | Preview-only exact-origin fallback from trusted platform configuration                         |

`API_INTERNAL_URL` is retired. No API_HOST, API_PORT, LOG_LEVEL or cookie-signing
secret is required by Next. Sessions use random opaque tokens and database hashes.

Local: copy `apps/web/.env.example` to `apps/web/.env.local`, supply a known local
DATABASE_URL, `APP_ORIGIN=http://localhost:3000` (or your exact local origin), and
a random AUTH_RATE_LIMIT_SECRET. Generate the secret once with
`node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`;
store it server-side, shared across instances. Rotation resets limiter slot mapping;
do not rotate it casually during an attack. It is not a password pepper and does
not encrypt or recover passwords.
Next loads env files relative to `apps/web`. Root `.env.example` is a reference;
the unrelated root Prisma scaffold is not the product schema. Review the intended
database before moving any existing env values.

Alternatively, `npm run dev:local` provisions only a fresh/previously owned real
loopback development PostgreSQL cluster under `artifacts/local-development`.
Its generated credentials and shared auth secret stay in an ignored settings
file and are passed only to child processes. It never adopts DATABASE_URL from
an env file. It overrides live Supabase configuration to empty for this ordinary
local PostgreSQL database, so there is no mismatched hosted subscription. Data
persists across runs; do not delete this directory to stop the app. Use Ctrl+C.
MERKAT_LOCAL_PORT optionally changes its web port (default 3000).

Prisma CLI does not automatically load env files. Explicitly export DATABASE_URL
and DIRECT_URL in the migration shell. The authoritative config is
`packages/database/prisma.config.ts`. Review the target before `npm run db:migrate`;
never use an unknown/production database. Install/build/start do not run migrations.

Phase 4 adds `202610160001_password_authentication` for credentials and shared rate
counters. Apply it to the reviewed local/staging target before registration. It
does not assign passwords to legacy accounts, rename users or alter identity
mappings. Existing legacy usernames cannot be registered over or implicitly linked.

Phase 5 additionally requires direct messaging, friendships and optional-email
migrations (six migrations total). Email is nullable, unverified and private on
User. It is not exposed through account/profile/discovery DTOs, used for login,
verified automatically or connected to recovery. Registration requires only a
username/password and defaults the display name to the username.

For isolated staging and production, use separate Supabase projects/data/credentials. Copy URLs
from the project's Connect panel: transaction pooling for runtime, direct/session
pooling for the migration job. Keep TLS verification enabled using the provider's
certificate settings. Runtime reuses one bounded pg pool (max 5 connections) per
warm process; budget for concurrent Vercel instances. Keep migration/DDL privileges
out of browser clients.

Production rejects non-loopback DATABASE_URL values unless they explicitly set
`sslmode=verify-full`, which verifies the certificate chain and hostname. Download
the project's root certificate from its Database settings when the system trust
store is insufficient. Local runtimes can use `sslrootcert` in the server-only
connection URL. Hosted runtimes can instead supply the PEM as `DATABASE_CA_CERT`,
keeping `sslmode=verify-full` and omitting `sslrootcert`. The parsed pg configuration
passes this CA with `rejectUnauthorized=true`; no machine-specific file path is
needed in Vercel. Conflicting CA settings are rejected. Do not use `no-verify` or
disable certificate verification. Production also
rejects a `host` query parameter that could override the URL's hostname. This
validation does not contact or migrate a database; loopback test/development
clusters remain supported. The separate Prisma migration connection needs the
same verified TLS setup.

On Vercel Preview only, an omitted APP_ORIGIN uses `https://${VERCEL_URL}` when
VERCEL=1, VERCEL_ENV=preview and the platform hostname is one valid DNS label under
vercel.app. Explicit APP_ORIGIN takes precedence. Request Host/Forwarded headers
never select the origin. Production and custom domains require an explicit exact
HTTPS APP_ORIGIN; use the canonical production domain to sign in.

The verified Vercel monorepo settings are root directory `apps/web`, framework
Next.js, Node 22.x and files outside the root enabled. Install with
`npx --yes npm@11.21.1 --prefix ../.. ci`, then build with
`npx --yes npm@11.21.1 --prefix ../.. run build`. Next's output tracing root includes
the repository workspace packages and native password module. Functions run in
Frankfurt (`fra1`), near the Merkat Supabase project. These are project settings;
installation and build do not apply database migrations.

At the user's request, the already validated Merkat Supabase project is also the
backend of the initial production deployment. Existing protected Preview builds
and local hosted development therefore share its data. Further mutating automated
tests must use the isolated local database or a separately provisioned staging
project; do not rerun generated-account acceptance tests against production data.

The existing RLS migration is unchanged. Merkat sessions are not Supabase Auth
JWTs; no `auth.uid()` policy or anonymous browser access is introduced. Use a
server-only database role deliberately authorized for these tables and review its
privileges/RLS behavior in isolated staging. If using only Prisma, disable the
unused Data API per the [Supabase Prisma guide](https://supabase.com/docs/guides/database/prisma).

Signed-out pages and liveness work without a database. Missing dependent runtime
configuration produces a bounded 503; anonymous account reads return 401 with a
valid APP_ORIGIN. No environment flag simulates authenticated access. Local HTTP
uses the development cookie; production uses Secure, HttpOnly, SameSite=Lax,
host-only cookies.

Production auth additionally requires a valid platform-provided source IP in
`x-vercel-forwarded-for`. A missing/invalid trusted source, absent secret, unavailable
limiter or missing migration fails closed. Do not trust arbitrary X-Forwarded-For
values on a self-hosted server. Local `next dev` intentionally uses one shared
local source quota; it still uses the persistent limiter and real password checks.
Standalone local `next start` is not a supported production auth ingress. The test
HTTPS harness explicitly models Vercel by replacing source headers itself.

Phase 5 private Realtime additionally uses server-side SUPABASE_REALTIME_URL,
SUPABASE_PUBLISHABLE_KEY and MERKAT_REALTIME_SIGNING_JWK. The last is a private
ES256 signing JWK imported and activated in the same Supabase project; never
prefix it NEXT_PUBLIC or put it in committed files. The authenticated capability
endpoint sends only the project URL, publishable key and a session-bound 90-second
JWT to the browser. No Supabase Auth user/session is created. See the
[reviewed setup and authorization boundaries](phase-5-messaging.md).

For a dedicated hosted project, apply `infra/supabase/realtime.sql`, then
`infra/supabase/server-role.sql` after the six Prisma migrations. Provision the
server-only `merkat_runtime` login separately with a generated password; keep
migration ownership on a different role. The runtime receives only application
CRUD and content-free Broadcast insertion, with no superuser, BYPASSRLS, role
creation, schema creation or migration-table access. Its explicit RLS policies
apply only to that trusted backend role. Browser roles retain no application
table access. The private Realtime helper still validates the actual Merkat
session, status and exact topic. See [hosted validation](phase-5.5-validation.md)
for the configured Merkat project, Vercel evidence and remaining device checks.

Keep the database timezone UTC, Supabase's default. Prisma's installed pg adapter
formats UTC timestamps without an offset and normalizes timestamptz output as
UTC; changing the database timezone causes incorrect expiry and history values.
The isolated runner explicitly starts PostgreSQL with timezone=UTC and verifies
round-trip timestamps against its clock. No existing timestamps were rewritten.

No NEXT_PUBLIC variable, Supabase service-role key, Matrix admin token, LiveKit
key, storage credential or Redis connection is needed. Legacy phone/Matrix
adapters stay disconnected regardless of old env values.

Phase 6 adds the seventh additive Prisma migration, `202610170003_groups_privacy`.
It requires no new environment variables or authentication provider. On a known
isolated Supabase staging target, apply `infra/supabase/groups-privacy.sql` after
the seven migrations and the existing `realtime.sql` / `server-role.sql` setup.
The new setup grants bounded backend access and INSERT-only report storage; a
separate NOLOGIN `merkat_moderator` role can SELECT reports only when explicitly
granted to a reviewed operator. Browser roles retain no content/report access.

Do not apply this Phase 6 migration/setup to the current production project or
deploy the new code using its existing Preview credentials: those also share the
production backend. Use `npm run dev:local` with supported Node 22.17+ for the
owned isolated local development database. Plain `npm run dev` still reads the
existing hosted `.env.local`. Its Merkat development process was stopped during
Phase 6 to avoid hot-reloading unreleased code against that production backend.
The live Vercel deployment is unchanged. See [Phase 6](phase-6-groups-privacy.md)
for validation and release gates.

Phone installation uses public manifest/icon files and standard browser install
UI; no service worker, push subscription, offline message cache, new secret or
billing setting is introduced. Physical installation remains a release check.

Compose additionally reads POSTGRES_USER, POSTGRES_PASSWORD and POSTGRES_DB from
`infra/local/.env`; DATABASE_URL must address its internal postgres service.
Examples contain blank placeholders. Real `.env*` files remain ignored.
