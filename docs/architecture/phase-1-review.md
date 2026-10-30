# Phase 1 review

## Established

Six npm workspaces: web, API, worker, contracts, backend and database. Root TypeScript/lint/format/build tooling, locked dependencies, environment examples, Docker development definition, provider/identity boundary, design tokens, responsive shell and basic PWA metadata are present. Original logo copies are byte-identical to the supplied files.

The database workspace is documentation/configuration preparation only; Prisma installation, schema and migrations are deferred. The API provides liveness only. The worker registers no jobs. No auth, Matrix, R2, LiveKit, Redis, product feature or provider provisioning is implemented.

## Validation

- `npm run lint`: passed, zero warnings.
- `npm run typecheck`: passed for all TypeScript workspaces.
- `npm test`: two API tests passed (liveness/absent product API and environment rejection).
- `npm run build`: passed for shared packages, API, web and worker.
- `npm run format:check`: passed.
- `npm run test:ui` with `PLAYWRIGHT_CHANNEL=msedge`: five tests passed. Widths: 1440, 900, 390 and 320 pixels. Covers navigation, selected state, horizontal overflow, browser exceptions, keyboard skip link, reduced motion, manifest and central-search exclusion.
- Desktop and mobile screenshots visually reviewed; screenshots are local ignored artifacts.
- Built worker bootstrap exits successfully without starting jobs.
- Dependency installation reported zero known vulnerabilities.

Initial browser-test assertions were corrected to use accessible button names (decorative numbers are hidden) and accept normalized zero-duration CSS units. No product behavior was changed to satisfy those assertions.

## Verification limits and follow-up

Docker was not available on PATH, so the Compose build/start workflow could not be executed. No actual iPhone, Android, installed PWA, touch gesture, offline, push, authentication, encryption or multi-user testing is claimed. Browser checks used desktop Edge with resized viewports.

ESLint 9 is retained for compatibility with Next.js's current React/import/accessibility lint plugins, whose peer ranges do not yet accept ESLint 10. npm marks ESLint 9 unsupported; revisit when the plugin stack supports a newer major. No peer checks were bypassed. Prisma's latest npm tag was a release candidate requiring a newer Node baseline; select a stable compatible release before the database phase.

The supplied artwork is landscape. Approved 192/512 square icons and a 180-pixel Apple icon are still needed at the locations in `apps/web/public/brand/README.md`. The manifest intentionally contains no missing icon references, and full installability is not claimed.

No user action is required to run the shell. Identity provider, production vendor/region and Matrix server name remain future decisions. Phase 2 awaits review.
