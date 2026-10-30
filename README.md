# Merkat

Talk. Plan. Meet. A social communication platform where conversations lead to shared plans and real-life activity.

## Current state

Phase 5: real direct text messaging and accepted friendships use Next.js, Prisma/PostgreSQL and Merkat sessions. Registration needs username/password, with optional private email; sign-in uses username/password. Chats supports persistent history, unread/read state and retry-safe sends. The user-approved mobile bar is Calendar → Friends → white Merkat logo/New chat → Chats → Profile. Supabase private Broadcast provides live change notifications after the documented signing-key and RLS setup. Hosted delivery and physical Xiaomi verification remain pending. Phone/Matrix code remains inactive; no seeded application accounts exist.

## Requirements and local development

- Node 22.17.x or a later Node 22 release; npm 11.
- `npm ci` from the repository root.
- Run `npm run dev` (or its existing alias `npm run dev:local`), then open `http://localhost:3000/register`. Both commands build shared packages, create/start the owned persistent PostgreSQL cluster under ignored `artifacts/local-development`, apply all seven migrations only to that loopback database, and start Next.js. Hosted credentials in `apps/web/.env.local` are not used for this database or realtime connection. Register/sign in with a local account; hosted accounts/data remain separate and untouched. Data persists after restarting. Ctrl+C stops the app. Set MERKAT_LOCAL_PORT if port 3000 is occupied. Local HTTP messaging/groups work without Supabase; private Broadcast requires the separate isolated staging setup and is shown as unavailable locally.
- `npm run dev:web` preserves the previous Next-only command for an explicitly reviewed custom local/staging environment. It does not start PostgreSQL or apply migrations. Ensure that target already has all seven migrations; the previous six-migration schema causes 503s in both conversation lists.
- Repeating `npm run dev` reports the existing local address and exits successfully. A PostgreSQL process left running after an interrupted launcher is reused only after authentication and an exact data-directory check. Unknown port occupants are reported without stopping them. Unconfigured local realtime returns explicit availability information; the UI continues to show that live updates are unavailable.
- Configure a known local PostgreSQL database and `apps/web/.env.local` for account operations. Builds/tests require no external credentials. Signed-out login remains usable without external services.
- Set `DATABASE_URL`, exact `APP_ORIGIN` (usually `http://localhost:3000`), and a random 64-hex `AUTH_RATE_LIMIT_SECRET` in that web env file. Without these, auth stays unavailable. Generate the secret with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`; store it only server-side and use the same value across instances.
- Run `npm run db:migrate` only against a reviewed local/staging database, with CLI variables exported. [Docker development](infra/local/README.md) supplies a local database and migration step.
- Apply all seven migrations, including `202610170003_groups_privacy`, to a reviewed custom local/staging target. The PostgreSQL timezone must remain UTC (Supabase's default); Prisma's pg adapter expects it. No external/production database is migrated by local startup. Restart the dev server after changing environment or dependencies, then open `/register` and create your own account. The default dev/dev:local launcher handles only its own recognized local cluster.
- For live delivery, follow [Phase 5 setup](docs/architecture/phase-5-messaging.md). Local ordinary PostgreSQL supports persistent API messaging but has no Supabase Realtime service. Missing live configuration shows a visible unavailable state; no insecure public subscription is used.
- `npm run build`, `npm run lint`, `npm run typecheck`, `npm test`, and `npm run format:check` validate the foundation.
- `npm run format` formats source and documentation.
- `npm test` runs reference API checks and real PostgreSQL parity/security tests in a fresh cluster. After building, `npm run test:ui` starts built Next.js, an isolated database and test-only HTTPS ingress. Install Chromium with `npx playwright install chromium`, or set `PLAYWRIGHT_CHANNEL=msedge` for installed Edge. Session fixtures/data stay under ignored `artifacts/`; no application auth bypass exists. Public self-signed TLS fixtures must never be used for deployment.
- After building, `npm start` runs only Next.js. Fastify remains a test reference; its standalone run scripts are removed after parity passed. The worker boundary is inactive.

Shared packages build before applications. Before importing another workspace, declare that dependency explicitly. Add dependency ordering inside the shared layer if those packages begin consuming each other.

## Environment handling

Examples contain blank placeholders only. Next reads env files relative to `apps/web`; Prisma CLI variables must be exported separately. Validation never prints connection values. Install/build/start never migrate.

Never put credentials in `NEXT_PUBLIC_*`. Next uses pooled DATABASE_URL, APP_ORIGIN (exact origin, HTTPS in production) and AUTH_RATE_LIMIT_SECRET. DIRECT_URL supplies migration tooling. Production auth requires Vercel's platform-provided VERCEL=1 and trusted source header; it fails closed on unsupported ingress. Do not set VERCEL manually on a public self-hosted server. API_INTERNAL_URL is retired. See [environment boundaries](docs/architecture/environment.md) and [Vercel setup](infra/deployment/README.md).

## Documentation

- [Architecture](docs/architecture/foundation.md)
- [Approved decisions](docs/decisions/0001-phase-1-foundation.md)
- [Product and design constraints](docs/product/merkat.md)
- [Phase 2 design system and review](docs/product/phase-2-shell.md)
- [Phase 3 identity/session architecture](docs/architecture/phase-3-accounts.md)
- [Phase 3.5 migration and validation](docs/architecture/phase-3.5-migration.md)
- [Phase 4 authentication, limits and verification](docs/architecture/phase-4-authentication.md)
- [Phase 5 messaging, private Realtime setup and verification](docs/architecture/phase-5-messaging.md)
- [Docker development](infra/local/README.md)
- [Deployment constraints](infra/deployment/README.md)
- [Brand assets and pending icons](apps/web/public/brand/README.md)

Stop after Phase 5 and the explicitly approved friends/design/optional-email additions. Groups, calls, uploads and other Phase 6 work require a new brief.
