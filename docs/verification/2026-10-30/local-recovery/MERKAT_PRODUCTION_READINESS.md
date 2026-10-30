# MERKAT production readiness

**Current task is local-only.** The normal dev command now uses the owned local
PostgreSQL launcher and all seven migrations. Real three-user HTTP/browser checks
and a PostgreSQL/app restart pass. See `MERKAT_LOCAL_503_REPORT.md`. Local repair
does not depend on production owner access. No production deployment or database
contact was performed during this latest repair. The separate production gate
below is historical and remains unclaimed.

October 30, 2026. **APPROVED; BLOCKED on migration-owner access.** The user has
explicitly approved the existing production database repair. Supabase remains
disconnected and the available application credential cannot apply migrations.
No additional production approval is needed. Local success does not mean
production is repaired.

The production application already contains groups/privacy code but its
configured Supabase project database is missing nine new tables and three quota
columns from `202610170003_groups_privacy`. See the exact catalog findings and
repair procedure in `infra/deployment/PRODUCTION_RECOVERY.md`.

| Gate                                       | Status                               | Evidence/remaining work                                                                                         |
| ------------------------------------------ | ------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Production source/log inspection           | VERIFIED WORKING                     | Vercel READY deployment `6ea62ba`; three failing API endpoints                                                  |
| Actual schema inspection                   | VERIFIED WORKING                     | Read-only catalog/CLI shows missing groups/privacy schema; restricted runtime credentials only                  |
| Existing repair SQL                        | VERIFIED WORKING locally             | Exact migration + repeated runtime SQL restore real authenticated HTTP/service operations and preserve messages |
| Runtime schema/permission preflight        | VERIFIED WORKING locally             | Rejects missing schema and migration-without-grants; passes after reviewed runtime setup                        |
| Live database repair                       | BLOCKED                              | Approval received; target/backup confirmation and owner-capable access remain                                   |
| Post-repair hosted browser/realtime        | BLOCKED                              | Run after authorized repair; local SQL invalidations do not prove hosted websocket delivery                     |
| Larger attached mobile/calendar assignment | NOT IMPLEMENTED in deployed baseline | Recovered candidate is a different checkout/revision; see UX/PWA reports                                        |

No new schema design or migration is necessary for this incident. Apply the
existing pending migration and runtime setup; do not bypass privacy checks,
weaken RLS/TLS, use application credentials for DDL, reset production or run all
fourteen recovered-candidate migrations as part of this fix.

## Connection-error follow-up

The user's new local Next logs also expose a transaction-acquisition `P2028` at
2 seconds and a session-read connection timeout at 5 seconds. Fault tests against
real isolated PostgreSQL reproduce premature transaction failure with a 2.3-second
connection, an unrecovered dropped session read and no bounded retry on outage.
The client now allows 6 seconds for acquisition against its unchanged 5-second
driver connection deadline. Existing per-transaction duration limits stay fixed.
Session reads retry only once for classified transport failures, rechecking
expiry using elapsed time. Schema/authorization errors and writes are not retried;
persistent outages remain errors. These changes are local, not deployed.
