# MERKAT release report — 31 October 2026

Release outcome: NOT DEPLOYED TO PRODUCTION. The owner's requested production updates remain pending critical acceptance and infrastructure gates.

## Candidate and preservation

Repository S4DRA/Merkat, recovery branch fix/production-release-recovery.
Development baseline fdb6944a02d2fe67be5ad6f9abb9aa87b0ff6b60.
Latest implementation candidate e9691d290e73b7ce28b5738459dceeceec3a3477.
Recovery changes preserve earlier development and repair commits. No force push, main reset, data deletion or production test data was performed.

The handoff revision will be recorded in the archive's REVISION.txt and the final response. Report-only changes do not establish a new deployed application revision.

## Deployments inspected

Production deployment dpl_BPQ4xQDRopDAwjcpKQXnogTBBxPp is on main at 6ea62ba1d04f7627914c30d198c2953ed955626e.
Canonical observed production URL: https://merkat-umber.vercel.app

Verified recovery Preview at candidate 7d12c991:
https://merkat-lzhma51zh-s4dras-projects.vercel.app
Deployment dpl_ELnfE9E8jkw1ZrcG1EhyfNeHvm58.

Its login page returned HTTP 200 and correctly displayed that sign-in is unavailable with incomplete Preview configuration. READY and a visible login page do not qualify it as working staging. Later recovery commits create newer Preview deployments through the same existing project.

Configured protected staging build: https://merkat-rhkffbdcu-s4dras-projects.vercel.app
Deployment dpl_DmVuj5EnWw5ZFN85J7e3NA6u5Wvc, candidate e9691d290e73b7ce28b5738459dceeceec3a3477, API target staging, READY. This is not a verified working authenticated staging application. A temporary share-link request was rejected by automatic review because bearer sharing was not explicitly authorized. No alternative public-sharing path was used.

## Root causes

The reported SSL exception is the strict database-environment validator rejecting a CA/URL configuration conflict before opening a connection. The non-readable production URL prevents identifying and safely editing the exact conflicting parameter. Trusted certificate parsing alone is insufficient.

Production also has only six migrations. The newer application requires fifteen; 18 tables and 13 columns are missing. Isolated recovery tests reproduce list failures with the old schema and restore behavior after the full reviewed upgrade, without losing seeded history. These are infrastructure failures, separate from ordinary 401 invalid credentials.

## Free staging status

A separate merkat-staging Supabase project was quoted at $0/month and created without upgrading plans. All fifteen source migrations were applied through Management API SQL and checksummed into a Prisma-compatible baseline. There are 31 model tables and RLS is enabled. Runtime base grants exist; the group/privacy confirmation expired. A separate restricted LOGIN credential and sensitive branch-scoped Vercel environment are configured. No actual hosted application session or Broadcast delivery has been accepted.

## Monitoring and rollback

Recent production searches returned no matching SSL log entries; there were no authenticated acceptance requests, so this does not establish recovery. No production rollout occurred and no post-release monitoring result exists.

Retain the existing production deployment as the rollback target. Before release, verify backup restoration, migration compatibility with both app versions and the exact production environment. On a critical post-release failure, restore the compatible application deployment/alias while preserving additive schema and user data.

## Outstanding handoff gates

Secure production TLS credential repair, production backup/restore, nine pending production migrations, isolated staging runtime/realtime configuration, hosted three-user acceptance, free reminder execution, provider/device push, and physical installed-app verification.

See the other five reports for exact scope and exclusions. MERKAT is not declared production-ready.

## Final isolated CI

Run https://github.com/S4DRA/Merkat/actions/runs/41208292200 completed successfully at implementation e9691d290e73b7ce28b5738459dceeceec3a3477: 15 unit tests, 2 API workspace tests, 82 PostgreSQL integration tests, 12 focused browser tests, 61 full browser tests and 40 explicitly mocked HTTP component checks. Focused browser tests repeat a subset. Type checking, lint, schema validation, clean install, runtime audit and web/worker builds passed. Hosted acceptance remains blocked.
