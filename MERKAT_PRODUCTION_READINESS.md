# MERKAT production readiness

October 30, 2026, Europe/Istanbul. Decision: **NO-GO for production deployment**. Source recovery, available local verification and handoff are completed; full release acceptance is blocked. No production deployment or infrastructure change was performed.

## Release gates

| Gate                                              | State             | Required evidence before release                                                                                                                                   |
| ------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Recover and preserve baseline                     | PASS              | Commit 466a2ac recovered cleanly; continuation branch and private source backup created. Final source includes recoverable Git history.                            |
| Web/worker build, types, lint, native unit checks | PASS              | Evidence in MERKAT_TEST_RESULTS.md and source archive.                                                                                                             |
| Exact migrations and selected SQL persistence     | PASS at SQL layer | Fourteen migrations and second-process persistence verified against native PostgreSQL.                                                                             |
| Real API/Prisma/PostgreSQL integration            | BLOCKED           | Run the full suite on a host permitting loopback; investigate and fix all failures.                                                                                |
| Real multi-user browser acceptance                | BLOCKED           | Run full Playwright against the isolated HTTPS app/database. No mocked HTTP component pass substitutes for this.                                                   |
| Clean install and supply-chain review             | PENDING           | npm ci on a clean runner, dependency/security review and successful reproducible build.                                                                            |
| Hosted private realtime                           | PENDING           | Separate staging Supabase setup, signed private channels, RLS and two/three-device reconnect/unread/receipt acceptance.                                            |
| Matrix integration                                | INACTIVE          | No current functioning Matrix service. Decide separately if the project should migrate back; no Matrix delivery is certified.                                      |
| Hosted reminder worker                            | PENDING           | Deploy only to authorized staging; configure supervision/restart, queue monitoring and failure recovery.                                                           |
| Provider push acceptance                          | PENDING           | Staging HTTPS origin, VAPID keys and valid opt-in test subscriptions; inspect provider outcomes.                                                                   |
| Actual device notification display                | PENDING           | Supported physical browsers/devices, including the user's Xiaomi 15T. Permission/background/OS battery restrictions can prevent display after provider acceptance. |
| Accessibility and physical UX                     | PARTIAL           | Component controls/layout/focus pass. Full accessibility automation, screen reader and physical mobile/landscape tests remain.                                     |
| Production rollout                                | NOT AUTHORIZED    | Separate owner authorization only after staging and rollback evidence.                                                                                             |

## Keep notification stages separate

| Stage                       | Evidence                                           | Meaning                                                                                                                  |
| --------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Scheduled                   | Pending durable PlanReminder row                   | Work is stored, not delivered.                                                                                           |
| In-app notification created | Unique Notification row; reminder marked DELIVERED | Server created an inbox item. It does not establish browser/device receipt.                                              |
| Push queued                 | PushDelivery row                                   | An opted-in session/device was selected for a send attempt.                                                              |
| Provider accepted           | Successful web-push response, state ACCEPTED       | Push provider accepted the request; device display is not proved.                                                        |
| Device displayed            | Observation on the actual target device            | Physical acceptance evidence. The application does not currently implement a display-acknowledgement telemetry protocol. |

None of the local checks proves provider acceptance or device display. Missing VAPID config is verified to fail closed.

## Required isolated staging configuration

- A separate private PostgreSQL/Supabase database with UTC timezone, reviewed migration history and verified TLS. An old preview sharing production data is not staging.
- Exact HTTPS APP_ORIGIN, AUTH_RATE_LIMIT_SECRET and supported trusted ingress. Keep all database credentials and signing/private keys server-side. Do not manually pretend a public self-hosted ingress is Vercel.
- Existing private Supabase Broadcast configuration: SUPABASE_REALTIME_URL, SUPABASE_PUBLISHABLE_KEY and server-only MERKAT_REALTIME_SIGNING_JWK, plus reviewed authorization/RLS setup.
- A supervised worker built with shared packages and `npm run build -w @merkat/worker`, started with `npm start -w @merkat/worker`. Durable PostgreSQL jobs survive restarts; this behavior needs real concurrent service acceptance.
- Optional MERKAT_PUSH_PUBLIC_KEY/PRIVATE_KEY/SUBJECT shared appropriately between web and worker. Generate keys privately. Web push requires HTTPS, service worker support and explicit user permission. Do not log or embed private keys in browser bundles.
- If using `/api/internal/reminders` for in-app reminders, configure CRON_SECRET of at least 32 characters and a scheduler at least every minute. This does not replace the push worker. Monitor queue lateness, errors, retries and dead subscriptions.

No staging service or paid resource was provisioned in this continuation. The source includes a manual isolated CI workflow ready for an authorized private repository/runner.

## Remaining acceptance sequence

1. Run clean CI and all real service/browser tests. Verify at least three separately authenticated users. Fix resulting assertions or implementation errors, then rerun affected checks.
2. Verify username/password registration with email blank, immediate login without verification, session cookie properties/rotation/revocation, password change, single-use recovery and account switching. Check persistent limits and safe errors.
3. Upload real PNG/JPG below/at/above 2 MB, corrupted/mismatched files and oversized dimensions. Verify server response, normalized private storage, reload persistence, deletion, blocked/unrelated access and cache headers.
4. Test DM/group history, sequence/dedupe, unread/read receipts, blocks, role changes, invitation acceptance, leaving/removal and reconnect using real private Supabase transport. Verify HTTP persistence independently from websocket delivery.
5. Test personal/DM/group calendar creation, optional invitations, native cards/composer shortcuts, RSVP/subscription, all views, UTC/IANA/DST behavior, ICS, updates/cancellation and cross-client synchronization. Exercise version conflicts and privacy changes. There is no later invitee-management screen.
6. With deterministic clocks in disposable service tests, verify both 24-hour and 5-hour due jobs. Run duplicate/concurrent workers, restart them, reschedule/cancel events, opt out/re-enable, remove participants and confirm no duplicate or stale inbox/push items. Never time-travel production data.
7. Reproduce the 1,350 TRY example; verify individual/editable own orders, equal/quantity/custom splits, consent/decline, exact integer remainders, concurrent stale versions and idempotent retries. Distinguish consumption, venue payments and peer repayments. Confirm closed expense snapshots/history remain immutable and recipient confirmation is mandatory.
8. Test real notification permissions, no config, permission denied, expired endpoints, retry/restart, opt-out/logout/account switching, deep links and foreground/background behavior on physical devices. Record provider acceptance separately from observed device display.
9. Review keyboard navigation, focus trap/return, larger text, OS theme changes, reduced motion, contrast, screen readers, long content and physical mobile safe areas. Component tests do not certify complete accessibility.
10. Establish observability, retention/capacity, a backup/restore rehearsal and a reviewed rollout/rollback plan. Production migrations are forward changes; rollback must account for existing data. Obtain explicit production authorization afterward.

## Functional limits

No silent editing of confirmed shared expenses, no closed-expense reopening/unanimous correction workflow, no automated taxes/discounts/refunds, no external money transfer, no recurring-event editor, no calls/media messaging and no active Matrix/phone system. These are documented limits rather than hidden functioning controls. Do not advertise them as supported.

## Handoff and recovery

The downloadable source ZIP contains reports, textual check evidence, revision metadata and `MERKAT_HISTORY.bundle`. To restore Git history in a new private directory, use `git clone MERKAT_HISTORY.bundle merkat` and select `new-chat/work/merkat-audit`. Inspect `SOURCE_REVISION.txt` for the final snapshot revision. This creates a new recovery checkout without touching the existing one.

Do not publish the archive or bundle to a public repository automatically. The original source checkout and public production app remain unchanged.
