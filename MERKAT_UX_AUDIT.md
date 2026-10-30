# MERKAT route and action audit

October 30, 2026. Inventory of the actually deployed `6ea62ba` source. Scope is the
reported chat/group Retry regression; this is not full acceptance of the larger
attached redesign. Existing product visuals and controls were preserved.

| Route/screen                            | Controls and intended behavior                                     | Actual implementation                                         | Verification / remaining issue                                                                                 |
| --------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `/`                                     | App entry                                                          | Redirects to Chats                                            | Existing route tests                                                                                           |
| `/login`, `/register`                   | Username/password, optional email, install                         | Real sessions, no mandatory verification                      | Existing auth service/browser suites; no production test accounts created                                      |
| `/onboarding`, `/profile/edit`          | Profile completion/edit                                            | Persisted profile and session checks                          | Existing account service/browser suites                                                                        |
| `/chats`                                | DM/group list, retry, search, new chat/group                       | Real HTTP calls and persistent services                       | Confirmed production 503s; migration repair passes locally, live repair pending                                |
| `/chats?conversation=…`                 | History, send/retry, receipts, back, profile/privacy controls      | Member-scoped persistent DM                                   | Recovery test preserves old messages and dedupes new sends                                                     |
| `/chats?new=1`                          | Find username and open existing/new DM                             | Exact username lookup and deduped pair creation               | Missing quota columns explain failing search; restored locally                                                 |
| `/groups`, `/chats?group=…`             | Group list/invites, channels/history, send/reply, details/settings | Real group/member/role services                               | Missing group tables explain retry; creation, acceptance, send/list/history and outsider denial tested locally |
| `/friends`                              | Find/request/accept/decline/remove friends                         | Real friendship services with privacy checks                  | Existing tests; same schema gap also affects privacy-aware interactions                                        |
| `/profile`                              | View/edit identity, sign out, settings/install                     | Real profile controls                                         | Existing tests                                                                                                 |
| `/settings`                             | Profile/install/privacy/block/report controls                      | Real privacy service, requires missing tables                 | Existing tests; runtime SQL required                                                                           |
| `/plans` (Calendar navigation label)    | Shell exploration/about/back                                       | Structural shell, not the recovered candidate's calendar grid | NOT IMPLEMENTED: attached month/dots/day-sheet/calendar acceptance in deployed revision                        |
| `/calls`, `/search`                     | Shell exploration/about/back                                       | Explicit structural shells                                    | NOT IMPLEMENTED: calling/global search; no fictitious backend added                                            |
| Center logo navigation                  | Open New chat                                                      | Link to `/chats?new=1`                                        | NOT IMPLEMENTED: attached hold-and-drag interaction in deployed revision                                       |
| `/api/[...path]`                        | Canonical auth/DM/friend/group/privacy/legacy plans APIs           | Validated server handlers and no-store responses              | Real service/HTTP suite; safe error diagnostics added                                                          |
| `/api/account/[...path]`                | Account compatibility aliases                                      | Existing canonical adaptation                                 | Existing tests                                                                                                 |
| `/api/matrix/[...path]`                 | Inactive compatibility surface                                     | No active Matrix architecture                                 | No migration or redesign performed                                                                             |
| `/health/live`, `/manifest.webmanifest` | Liveness/manifest                                                  | Existing route handlers                                       | Existing tests/build                                                                                           |
| Unknown destinations                    | Reject invalid routes                                              | Next `notFound()`                                             | Existing route tests                                                                                           |

Chat-only spending tabs, the richer calendar, avatars, recovery, notifications,
theme/accessibility preferences and a durable reminder/push worker are described
in the recovered `a481829` reports. Those features are not all present in the
actual production revision; this audit does not label them live or merge them
without a separate implementation/release review. No global Tabs navigation was
added. No UI changed, so meaningful before/after design screenshots do not apply.
