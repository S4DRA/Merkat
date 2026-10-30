# Phase 2 — design system and application shell

## Scope and previous state

Phase 1 supplied tooling, architecture boundaries, tokens and a single-route preview dominated by a brand panel. Phase 2 replaces that preview with navigation/context/content layers and an optional information dialog. Backend, identity, database and provider integrations remain unchanged.

## Navigation and composition

One primary definition supplies Chats, Calls, Plans, Groups and Profile in that order to Classic Navigation and the future Central Nav boundary. Links use real structural routes, with refresh, browser back/forward and deep linking. Search and Settings are secondary; Settings is reachable through Profile. Unknown destinations return 404. No gesture system or navigation-mode setting is exposed before it works.

Desktop: 88-pixel navigation rail, 300-pixel context column and flexible active content. At 768–1023 pixels the context column narrows to 260 pixels. Panels scroll independently when needed. Mobile below 768 pixels uses one context screen with five bottom destinations; Explore opens its overview with a Back control and managed focus. Navigation stays in the viewport grid, reserving space rather than covering content. Safe-area insets and dynamic viewport height are applied; no composer/input keyboard behavior is claimed before those controls exist.

The optional information panel uses a modal dialog, close action, Escape dismissal, focus wrapping and native focus restoration. Its UI-state examples are explicitly labelled and never appear as account activity or real unread badges.

## Design decisions

- Primary orange #F55105 for the official mark, selection lines and badges. Dark orange #AD3500 provides readable small accent text; warm white #F6F5F1 separates content from white context/navigation surfaces.
- System sans-serif typography, compact labels, 32-pixel route titles and 32–48-pixel content titles. No remote font requests.
- Existing 4-pixel spacing scale; 1-pixel separators only at meaningful boundaries. No blanket thick borders or card grid.
- Controls use 6-pixel radii; avatars are circular. A 12-pixel icon tile is an intentional small exception. Lucide provides consistent outline icons, separate from the unchanged official Merkat artwork.
- All navigation/control targets are at least 44 pixels. Focus rings are dark and visible; hover is limited to hover-capable devices; press feedback is a short one-pixel movement with inset depth.
- Button, IconButton, Avatar, Badge and Skeleton are the limited primitive set. Buttons cover primary/secondary/quiet, disabled and loading. Avatar presence is opt-in. Navigation badges accept counts but receive none in the unconnected shell.
- Motion: 120ms feedback, 200ms information-panel entry, a loading spinner only where explicitly labelled. Reduced motion disables animations/transitions. No decorative continuous motion.

## Files changed

- `apps/web/src/app/page.tsx` and `[destination]/page.tsx`: route entry and structural destinations.
- `apps/web/src/components/app-shell.tsx`: responsive shell and information panel.
- `apps/web/src/components/shell-navigation.tsx`: accessible shared navigation and optional unread state.
- `apps/web/src/components/ui/primitives.tsx`: small reusable control/state set.
- `apps/web/src/lib/navigation.ts`: primary/secondary definitions and route lookup.
- `apps/web/src/app/tokens.css`, `globals.css`: tokens, states, layout and responsive behavior.
- `apps/web/package.json`, root `package-lock.json`: Lucide dependency.
- `tests/browser/shell.spec.ts`: expanded navigation/responsive/accessibility checks.
- `README.md` and this document: current status and handoff.

## Verification and limits

Widths: 320, 360, 390, 430, 768, 1024, 1280, 1440. Tests cover each primary destination, visible/hidden panels, 44-pixel navigation targets, document overflow, navigation viewport position, mobile forward/back focus, browser errors and screenshots. Additional checks cover reduced motion, keyboard skip link, dialog focus/Escape, contextual routes, refresh, unknown routes and landscape interaction.

Visual review compares restrained orange, clear typography, varied border hierarchy and separate mobile/desktop compositions against the supplied brand/catalog references. Empty areas are deliberate unimplemented content boundaries, with no fake conversations or records. Screenshots are stored under ignored `artifacts/phase-2-*.png`.

Checks run against desktop Edge at resized viewports; actual iOS/Android hardware, on-screen keyboards, PWA installation and offline operation remain unverified. No user action is needed to review the shell. Square icon exports remain a later PWA requirement. Stop before Phase 3.
