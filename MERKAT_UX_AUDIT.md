# MERKAT UX audit — 31 October 2026

Scope: actual route discovery and control-source inspection, plus browser acceptance. This is not a claim that every possible dynamic interaction received manual physical-device review.

## Route inventory

Seven page files implement /, /login, /register, /recover, /onboarding, /profile/edit and /[destination].
The destination registry expands to /chats, /calls, /plans, /groups, /profile, /friends, /search and /settings. Unknown destinations call notFound.

There are dedicated avatar routes, internal reminders, health, inactive Matrix routes and a shared API handler. Static discovery found 63 quoted API method paths plus the legacy plans handler, and 291 JSX control occurrences. The accompanying route-controls inventory is a source inventory, not behavioral proof.

| Journey | Verified scope / limitation |
|---|---|
| Login/register | Real immediate entry, secure sessions, validation, small viewports, ordinary invalid credentials and offline feedback |
| Onboarding/profile/edit | Real profile save, refresh, logout; PNG upload/oversize rejection; draft marker added for safe updates |
| Chats/DMs/groups | Three separate auth contexts, lists, message persistence, invitations, roles/privacy and retry paths |
| Friends/search | Username search, requests, acceptance/removal and real HTTP state; transport simulations labeled |
| Main calendar | Current month, today, 42-day grid, date dots, navigation, day sheet and personal creation |
| Group calendar | Final accessible-selector repair passed real browser acceptance; invitations optional, RSVP controls and cancellation checked |
| Conversation calendar/tabs | Native cards and chat-only tabs, consent, payments, immutable saved history |
| Settings/appearance/security | Persisted light/dark/system, motion/text comfort, privacy, security, recovery and install entry points |
| Calls | NOT IMPLEMENTED: legacy design shell; do not imply successful calling |
| Recovery | Implemented service/integration boundary; physical device switching remains unverified |

## Confirmed repairs

Duplicate realtime clients on messaging/friends screens caused unnecessary sockets and made mocked notification targeting ambiguous. The notification inbox now consumes workspace reconciliation events there.

The creation menu's animation-frame focus allowed rapid keyboard activation to close it again. Focus now moves immediately after the portal commits. Native hold/drag, cancellation, mouse, keyboard and reduced-motion journeys passed after that repair.

Authentication errors previously cleared on blur and could move the submit button during a click. Corrected errors now clear while typing; the offline single-click submission test passed afterward.

The group picker now uses an explicit label and unique ID rather than deriving its label from option content. Final isolated acceptance passed.

Profile edits now mark unsaved state and active saves for the existing PWA update guard.

## Accessibility and comfort evidence

Browser coverage spans 301–1440 px in relevant suites; common navigation checks include 320, 360, 390, 430, 768, 1024, 1280 and 1440 px. Checks include 44 px navigation targets, overflow, keyboard focus, dialog Escape/return focus, reduced motion and viewport resizing.

Appearance tests persist preferences through a reload and verify system colour-scheme changes and larger text without horizontal overflow. These do not replace physical screen-reader, iOS keyboard/safe-area or Xiaomi installation review.

The approved MERKAT logo, orange #F55105 branding and five-position navigation remain. Tabs are not a main navigation destination.

## Remaining audit work

The final group-creation/calendar browser journey passed. Complete hosted acceptance; inspect any new errors rather than accepting empty states as successful queries. Review every dynamic control against the inventory and complete physical assistive-technology and installed-app checks. No exhaustive accessibility certification, Lighthouse score or battery measurement is claimed.
