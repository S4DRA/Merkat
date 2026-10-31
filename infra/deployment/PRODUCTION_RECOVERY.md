> Historical phase procedure. The current candidate requires all 15 migrations, recovery/appearance/calendar/tab schemas and operational reminder execution. Follow [current readiness](../../MERKAT_PRODUCTION_READINESS.md) and the final CI evidence before release.

# Chats and groups production recovery

October 30, 2026, Europe/Istanbul. Scope: the reported Retry states in chats/groups.
This procedure is prepared and locally tested. It has **not** been applied to production.
The user has now explicitly approved this exact migration/runtime repair.
Execution remains blocked on migration-owner access; do not ask for approval again.

## Evidence and cause

Vercel production deployment `dpl_FpvmSXjKh2jnmUXriLDvmN3NWcax` serves Git commit
`6ea62ba1d04f7627914c30d198c2953ed955626e` from `main` at
`https://merkat-umber.vercel.app`. Runtime logs show failures from `direct/list`,
`groups/list` and `people/find`, matching the user's Retry report.

The existing local server environment connects to the same Supabase project as
production's configured Realtime URL. A read-only catalog check using that
configured database found the six-migration application schema: all nine new
group/privacy tables and `MessagingRateLimit.discoveryCount`, `managedCount` and
`reportCount` are missing. Migration history is deliberately inaccessible to the
restricted application role; this diagnosis uses actual tables/columns instead.
The production DATABASE_URL itself was not downloaded or printed.

Existing DMs now check `UserBlock`, discovery uses the new quota columns, and
group lists query the new group tables. Retrying cannot repair missing schema.
Skipping privacy checks or returning fake empty lists would hide the failure and
weaken the application, so those behaviors were preserved.

## Exact repair, after owner authorization

Use this checkout (`D:\Github Repo\Conduit\Merkat`) and the existing seven-migration
history matching the deployed source. Do not substitute the other recovered
checkout's fourteen-migration history during this incident repair.

1. Confirm the intended production database/project and the actual production
   connection target privately. Confirm a usable backup/restore point. Supply a
   reviewed migration-owner **session/direct** connection as `DIRECT_URL` through
   the operator's secure environment; do not paste credentials into chat or logs.
2. Review the pending migration with the same owner environment:

   ```powershell
   npx prisma migrate status --config packages/database/prisma.config.ts
   ```

   Only `202610170003_groups_privacy` should be pending for the observed baseline.
   Stop and investigate if history differs, a migration failed, or the target differs.

3. Apply the existing additive migration; no new Prisma schema edit is needed:

   ```powershell
   npm run db:migrate
   ```

4. Apply the existing transaction-wrapped runtime setup using that same reviewed
   owner target. This grants the trusted backend access through RLS and installs
   private invalidation triggers. It keeps browser roles denied and reports
   insert-only. Prisma's config selects `DIRECT_URL` ahead of `DATABASE_URL`.

   ```powershell
   npx prisma db execute --config packages/database/prisma.config.ts --file infra/supabase/groups-privacy.sql
   ```

5. Switch to the **application's restricted** `DATABASE_URL`, preserving verified
   remote TLS and its CA configuration, and run:

   ```powershell
   npm run build:packages
   npm run db:check-runtime
   ```

   Require `ready: true`, no issues, exit 0. The command does not use DIRECT_URL,
   read migration history, read private rows, apply SQL changes or print credentials.
   It checks model tables/columns, RLS, runtime grants/policies and report-read denial;
   it does not certify hosted realtime delivery or physical-device behavior.

6. In real signed-in browsers verify existing chat history/list, username search,
   new DM, group creation, invitation acceptance, group list/history/send and
   reconnect. Inspect production logs for new errors. Do not send test content to
   existing users without explicit instruction. A source redeployment is not
   necessary to repair these missing database objects; the diagnostics source can
   be released separately after approval.

The migration and runtime setup are separate transactions. If step 4 fails after
step 3 succeeds, fix and rerun the repeatable runtime setup; do not reset the
database, drop the new tables or mark an unapplied migration as completed. The
regression test specifically checks that schema without runtime grants is not ready.

## Verification and rollback limits

`tests/integration/production-recovery.test.ts` reproduces the old schema, original
HTTP 503s and preexisting messages with three real independently authenticated
users in disposable PostgreSQL. It applies the exact migration and runtime SQL,
then verifies restored HTTP 200s, preserved history, retry-safe DM sends, group
invitations/messaging, outsider denial, browser table denial and empty invalidation
payloads. Reapplying runtime SQL also passes. Supabase SQL is represented by a
local contract fixture; hosted websocket delivery is not claimed.

Production migration/permissions and post-repair hosted acceptance remain blocked
on owner-capable access. Authorization has been received. The available database credential is a
restricted runtime account. Supabase's connector is available but not connected.
Do not broaden that runtime role to perform migrations. Source rollback cannot
undo newly created production groups/messages safely; preserve new data and prefer
a reviewed forward correction after upgrade.

## New connection errors

`P2028` at roughly 2 seconds is consistent with Prisma 7.10's default transaction
acquisition wait expiring before the driver's 5-second connection deadline. This
failure is reproduced using a real 2.3-second local TCP connection and corrected
by a 6-second acquisition wait. Transaction execution limits remain unchanged.
One classified dropped session read is retried on a fresh connection, with expiry
rechecked. A persistent outage still throws. Neither change creates missing tables:
the observed `P2021` still needs the already-approved migration/runtime repair.

The configured hosted database was reachable in three read-only probes in this
follow-up (459/43/44ms), and `ChatGroup` remained absent. These probes do not
establish the cause of the earlier hosted 5-second network timeout or certify
provider health. No connection URL, pool mode, pool size or TLS setting was changed.
Restart the local dev server after updating/rebuilding these shared packages;
its global runtime singleton retains the existing Prisma client until restart.
