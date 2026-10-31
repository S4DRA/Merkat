# MERKAT PWA verification — 31 October 2026

Classification: IMPLEMENTED BUT NOT FULLY VERIFIED.

## Implemented and browser-checked

The manifest identifies MERKAT, uses standalone display, root start URL/scope, orange theme colour, 192/512 PNG icons and a maskable declaration. Apple touch and favicon assets exist and decode at their declared dimensions. The approved 512 icon was visually inspected; its white symbol is padded inside the orange square.

The production service worker caches public icons, branding, static bundles and the offline page. Authenticated HTML is network-only; API JSON, avatars, calendar and financial data are not cached. Offline navigation displays the fallback rather than private conversation content.

Install UI uses the browser's deferred install event when available and shows manual Android/iOS guidance otherwise. It does not report a physical installation based on a synthetic browser event.

Updates require an explicit action. The guard checks active dialogs, writes, message drafts and dirty forms. Profile forms now mark dirty state. Logout requests notification closure, and a delayed push must verify the currently signed-in recipient through a network-only request before displaying private content.

## Evidence boundary

CI browser tests parse the manifest, register the actual service worker in a secure local HTTPS harness, inspect cache names/contents and navigate offline. Unit tests exercise account switch/logout/offline push suppression and private cache exclusion.

The local TLS fixture is explicitly a test certificate; Chromium's certificate exception is confined to the loopback test harness. Production database TLS verification is unchanged.

The install prompt test uses synthetic install events. It is UI verification, not Android/iOS installation proof. No successful provider push or device display is claimed.

## Still required

- Actual install/launch on Android, Xiaomi and iOS, standalone deep links and device safe areas.
- Logout, reopen, account switching and session expiration in an installed application.
- A real update with an open draft, intentional activation, reload and new assets.
- Physical keyboard/viewport behavior, large text, screen readers and reduced motion.
- Push subscription, provider acceptance, actual device display and stale-recipient suppression on real devices.
- HTTPS staging and production verification after secure database/realtime configuration.

Screenshot publication from authenticated test pages was rejected by automatic review. No replacement egress path was used. The CI capture code leaves images local to its disposable runner.
