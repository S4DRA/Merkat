# MERKAT production readiness

October 30, 2026. **BLOCKED: live repair requires owner authorization and
migration-owner access.** Local success does not mean production is repaired.

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
| Live database repair                       | BLOCKED                              | Explicit approval, confirmed target/backup, owner-capable access                                                |
| Post-repair hosted browser/realtime        | BLOCKED                              | Run after authorized repair; local SQL invalidations do not prove hosted websocket delivery                     |
| Larger attached mobile/calendar assignment | NOT IMPLEMENTED in deployed baseline | Recovered candidate is a different checkout/revision; see UX/PWA reports                                        |

No new schema design or migration is necessary for this incident. Apply the
existing pending migration and runtime setup; do not bypass privacy checks,
weaken RLS/TLS, use application credentials for DDL, reset production or run all
fourteen recovered-candidate migrations as part of this fix.
