# MERKAT PWA verification

October 30, 2026. Scope: existing production-revision PWA assets/install UI preserved
during the chat/group database repair. No PWA features or logo assets were changed.

| Requirement                        | Finding                                                                                                                             |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Manifest                           | Existing `manifest.ts`: id/scope/start URL `/`, standalone, brand colors, name/short name `Merkat`                                  |
| Approved branding                  | Existing 192/512 PNG, favicon and 180 Apple icon retained                                                                           |
| Install UI                         | Existing deferred install event, manual platform guidance and standalone hiding                                                     |
| Automated installation evidence    | Existing browser tests exercise synthetic install events and manifest/icon resolution; synthetic events are not actual installation |
| Maskable icon                      | NOT IMPLEMENTED in current revision; both declared icons use purpose `any`                                                          |
| Offline/update service worker      | NOT IMPLEMENTED in deployed revision; existing browser test expects no service worker/cache registrations                           |
| Push/reminders                     | NOT LIVE-VERIFIED; richer implementation is in the separate recovered checkout                                                      |
| Android/Xiaomi/iPhone installation | BLOCKED on physical-device acceptance; no physical installation claimed                                                             |
| Hosted account/session reopening   | NOT LIVE-VERIFIED in this incident repair                                                                                           |

The attached full mobile PWA acceptance is not satisfied by the deployed
`6ea62ba` source. It is separate from restoring the database schema expected by
the current chat/group code. See `MERKAT_TEST_RESULTS.md` for the current run's
browser results; no historic recovered-candidate pass counts are reused.
