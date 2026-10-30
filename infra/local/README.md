# Local Docker development

Requires Docker Engine and the Compose plugin (Docker Desktop with Linux containers on Windows).

Copy `infra/local/.env.example` to `infra/local/.env` and supply local values. DATABASE_URL must point to the `postgres` service using the supplied database/user/password (URL-encode password characters). APP_ORIGIN must exactly match the browser origin. Supply a random 64-hex AUTH_RATE_LIMIT_SECRET. Review any existing env file before reuse; never point Compose's migration step at a hosted/production database. Examples contain no credentials.

From the repository root:

```sh
docker compose --env-file infra/local/.env -f infra/local/compose.yaml up --build
docker compose --env-file infra/local/.env -f infra/local/compose.yaml down
```

Compose starts local PostgreSQL 18, applies the existing migrations to that local database, then starts only Next.js. DATABASE_URL and APP_ORIGIN belong to web. The database remains internal and persists in a named volume; web is loopback-only. Do not remove the volume unless you intend to erase local data. Rebuild after shared-package, dependency or configuration changes.

Compose execution is unverified. All six migrations are exercised on fresh PostgreSQL clusters by the test harness. Hosting preparation is documented in [Vercel setup](../deployment/README.md); no hosted migration or deployment is performed here.

This Dockerfile is a local-development image, not a production image. Pin a reviewed current Node 22 patch/digest and build hardened per-process production images when deployment is selected. No cloud vendor is implied.

# Quick local run without Docker

From the repository root, use Node 22.x/npm 11, run `npm ci`, then
`npm run dev:local`. Open `http://localhost:3000/register` and create an account
using username/password; email is optional. This command creates its own real,
loopback-only PostgreSQL database under ignored `artifacts/local-development`
with generated credentials. It migrates only that owned cluster, never any
existing environment DATABASE_URL. Accounts, friends and messages persist after
restart. Ctrl+C stops the app; no default accounts are added. Set
MERKAT_LOCAL_PORT to use another local web port. Live delivery still requires a
configured Supabase project; the ordinary local database has no Realtime service.
