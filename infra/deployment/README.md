# Vercel preparation — Phase 5

Target: Next.js App Router on Vercel, Supabase PostgreSQL through Prisma. No
standalone API, worker, custom production server, poller or Redis is required.
No deployment is authorized or performed in this phase.

| Setting                                     | Value                                                        |
| ------------------------------------------- | ------------------------------------------------------------ |
| Framework preset                            | Next.js                                                      |
| Root Directory                              | `apps/web`                                                   |
| Include source files outside Root Directory | Enabled for shared workspaces                                |
| Install Command                             | `cd ../.. && npm ci`                                         |
| Build Command                               | `cd ../.. && npm run build`                                  |
| Output Directory                            | Framework default `.next`, relative to `apps/web`            |
| Node.js Version                             | `22.x`, matching package engines                             |
| Runtime variables                           | DATABASE_URL, exact HTTPS APP_ORIGIN, AUTH_RATE_LIMIT_SECRET |

Build generates Prisma 7.10, builds contracts/backend/database in order, then
builds Next. Explicit generation also covers reused dependency caches. Web declares
its backend/database dependencies, and Next transpiles shared workspaces. Database
routes use the Node.js runtime. No custom server runs in a function.

Do not migrate during install/build/start. Review the target and backup/rollback
procedure, then apply the six migrations separately to isolated staging
with DIRECT_URL. No hosted database or production data was modified in this work.

Live messaging additionally requires the private Realtime setup in
[Phase 5](../../docs/architecture/phase-5-messaging.md), including the reviewed
Supabase SQL script and imported ES256 signing key. Add SUPABASE_REALTIME_URL,
SUPABASE_PUBLISHABLE_KEY and MERKAT_REALTIME_SIGNING_JWK as server-only runtime
variables. Never use the signing JWK as an API key or expose it to browser code.
Keep Supabase's default UTC database timezone. No long-running backend is needed.

Use the actual assigned origin for APP_ORIGIN; no domain is invented. Previews need
their own exact origin and staging database. Never trust incoming Host/Forwarded
headers or allow arbitrary origins to bypass CSRF. Separate preview/production
secrets and data. DATABASE_URL uses the Supabase transaction pooler; DIRECT_URL
belongs in the migration job (direct/session mode compatible with its network).
Review runtime role access to the existing RLS-protected tables. No credential
belongs in NEXT_PUBLIC variables.

Authentication requires a shared random 64-hex AUTH_RATE_LIMIT_SECRET and Vercel's
platform-provided source IP. VERCEL=1 must come from the deployment platform; do not
enable that trust mode on arbitrary public ingress. Source/account/global quotas
are PostgreSQL-backed and fail closed on errors; no paid limiter or in-memory
fallback is introduced. Validate actual ingress header replacement and concurrent
quota behavior in staging before enabling public registration.

The new PasswordCredential/AuthRateLimit tables enable RLS and revoke PUBLIC
privileges. Review access for your server-only Prisma role; never grant credential
or limiter access to browser/Supabase Auth roles. Validate separately that the
unused Data API cannot expose credentials. No password recovery is provided.

Local build/HTTPS tests do not validate deployed file tracing, cold starts,
Supabase TLS/pooling, hosted migrations, backups, regional latency or physical
mobile devices. Those remain a staging gate; the app is not production-ready.

Before Phase 5, validate managed Matrix authentication compatibility. The inactive
Synapse/password adapter is not a managed token exchange. E2EE needs real encrypted
cross-device tests before any claim. Managed LiveKit requires later validation.
Future Supabase Storage must use private buckets and server authorization. No
messaging/calling/storage provider is integrated in Phase 4.

References: [Vercel monorepos](https://vercel.com/docs/monorepos),
[Prisma on Vercel](https://www.prisma.io/docs/orm/prisma-client/deployment/serverless/deploy-to-vercel),
[Supabase Prisma](https://supabase.com/docs/guides/database/prisma).
