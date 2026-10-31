# MERKAT test results — 31 October 2026

Isolated acceptance: PASS. Hosted/production acceptance: BLOCKED. No build or mocked transport result is represented as proof of hosted end-to-end operation.

## Reproducible environment

Node 22.17.0, npm 11.21.1, committed lockfile, Prisma 7.10.0, Next.js 16.4.1. Local clean installation completed (629 packages before the reviewed dependency refresh). The local host permits loopback but cannot safely run PostgreSQL as a non-root user. No root-guard or authentication bypass was used.

Real database and browser checks run on standard GitHub-hosted Ubuntu through .github/workflows/production-recovery.yml. Each harness creates its own random loopback PostgreSQL cluster, applies migrations, and uses synthetic accounts. No production credentials or production rows are supplied to CI.

## Recorded results

| Check | Result | Evidence |
|---|---|---|
| Clean npm ci | PASS | Local log and CI |
| Type checks, lint | PASS | Local repaired checks and CI |
| Prisma schema validation | PASS | Actual Prisma validate |
| Unit tests | 15 PASS | Final CI run 41208292200 |
| Compatibility API workspace tests | 2 PASS | Same run |
| PostgreSQL integration tests | 82 PASS | Final run 41208292200, including TLS and database-process restart |
| Web production build | PASS | Local webpack build and CI |
| Worker build | PASS | Local and CI |
| Full browser suite before final selector repair | 59 PASS / 2 FAIL | Run 41206448752 |
| Focused browser suite after auth correction | 11 PASS / 1 FAIL | Run 41207316101 |
| Final focused browser acceptance | 12 PASS | Run 41208292200; subset repeated before full regression |
| Final full browser acceptance | 61 PASS | Run 41208292200, source e9691d290e73b7ce28b5738459dceeceec3a3477 |
| Mocked HTTP component browser harness | 40 checks PASS / 0 browser errors | Explicit mocked HTTP, recorded separately from real service tests |
| Runtime dependency audit | 0 vulnerabilities | npm audit --omit=dev |
| Complete dependency audit | 16 moderate, 0 high/critical | Remaining minimatch/ESLint development-tool chains |

Earlier failures were retained as evidence. They are not counted as passes. The final group-selector change passed the affected journey and full regression suite. The 12 focused tests repeat a subset of the 61; they are not additional unique tests.

## What the real tests establish

- Registration needs only username/password and enters immediately; invalid credentials, duplicates, shared limits, CSRF, expiration, account isolation and logout are exercised.
- Recovery codes are hashed and single-use; recovery revokes prior sessions. Profile/privacy data and avatars persist.
- Three distinct authenticated browser contexts exercise real DM/group HTTP and PostgreSQL state. Socket lifecycle tests explicitly mock Phoenix transport and cannot establish Supabase delivery.
- Exact money calculations keep consumption separate from venue payments. A/B/C consumption is 500/550/300 TRY; payments, consent, retries, version conflicts and closed snapshots are checked.
- Durable reminders at both 24 and 5 hours are delivered under deterministic clocks. Concurrent runs do not duplicate inbox records; editing, cancellation and opt-out are covered. New repository workers read existing durable rows.
- Real TLS tests accept a trusted server, reject an unrelated CA and a mismatched hostname, and verify a registered application session after PostgreSQL stops and restarts.
- Browser PWA tests exercise manifest parsing, service-worker registration, public-only cache contents, offline fallback and install controls. Synthetic installation events verify UI behavior only.

## Hosted checks and exclusions

Production metadata confirms six finished Prisma migrations, 18 missing application tables and 13 missing columns relative to the current client. Existing public tables have RLS; merkat_runtime is restricted and cannot read migration metadata.

The configured CA parses as Supabase Root 2021 CA, valid until 26 April 2031. A public TLS handshake from this host failed at DNS resolution; it did not verify the database endpoint. The production database URL is a non-readable Vercel secret. Supabase management queries do not prove a Prisma connection under the runtime credential.

Staging has all 31 model tables, 32 RLS-enabled public tables including the migration ledger, and 15 recorded checksums. Its restricted LOGIN credential and branch-scoped Vercel environment are now configured. Group runtime permissions and realtime signing remain incomplete. Deployment dpl_DmVuj5EnWw5ZFN85J7e3NA6u5Wvc is READY, but authenticated HTTPS acceptance and endpoint TLS are not established. No synthetic hosted accounts were created. Automatic review rejected creating a bearer share link to access the protected Preview; that path was not bypassed.

Not accepted: hosted three-user Broadcast, staging HTTPS authenticated journeys, production login/write paths, practical production backup restoration, hosted worker restarts, provider push acceptance, real device display, installed-app logout/reopen/update, Xiaomi/iOS physical accessibility, and comprehensive assistive-technology testing.
