# Vercel build warnings

October 30, 2026, Europe/Istanbul. Live inspection confirms preview
`dpl_6EHFzZ7os1rAvrTypwMX6Se5cZRV`, commit `d1a4f4d`, branch
`new-chat/work/merkat-audit`, is **READY**. Its build log contains neither the
unsupported cache-dir warning nor the unapproved install-script warning.
The ESLint deprecation warning remains. At this inspection production is still
on `6ea62ba`; the user subsequently authorized a production release.

## Corrections

- **VERIFIED WORKING locally:** `apps/web/vercel.json` preserves the existing
  pinned npm 11.21.1 commands and monorepo prefix, removing only unsupported
  `npm_config_cache_dir` / `NPM_CONFIG_CACHE_DIR` from their environment. A real
  npm 11.21.1 `config get cache` call reproduces the warning with the injected
  setting; the same call through `env -u` has no warning and exits successfully.
- **VERIFIED WORKING locally:** reviewed the required native/toolchain installer
  entry points and recorded exact version approvals in root `package.json`.
  They cover Prisma/engines, Argon2, esbuild, the resolver, and the locked Linux
  and Windows embedded PostgreSQL packages. No blanket approval is used.
  `npm install-scripts ls --json` reports `allowScripts: []` on Windows.
- **VERIFIED WORKING on Vercel:** the `d1a4f4d` preview ran the corrected commands,
  completed installation, built successfully and deployed without those two
  warning classes. This is preview verification, not a production release claim.

The existing deployment's warnings did not prevent its successful build. npm's
review policy in the pinned release is advisory; the scripts were not shown as
failed. The policy explicitly records intent for the pinned dependencies.

## Remaining compatibility warning

**BLOCKED on upstream lint-plugin compatibility:** npm reports ESLint 9.39.5 as
deprecated. Registry inspection confirms it is the latest ESLint 9 release. The
current/latest `eslint-plugin-react` 7.37.5 declares support through ESLint 9.7,
and `eslint-plugin-jsx-a11y` 6.10.2 through ESLint 9. Their Next.js integration
cannot be upgraded to ESLint 10 within the declared peer ranges. No forced peer
override, warning suppression or removal of React/accessibility checks was made.
This is a development-tool support warning, separate from app/runtime failures.

Evidence is ignored under `artifacts/npm-{warning-before,warning-after,scripts-final}.log`,
`npm-script-approvals.log` and `eslint9-support.json`.

References: [Vercel command overrides](https://vercel.com/docs/project-configuration/vercel-json),
[npm install-script policy](https://docs.npmjs.com/cli/v11/commands/npm-install-scripts/).
