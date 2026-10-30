# Vercel build warnings

October 30, 2026, Europe/Istanbul. Read-only inspection of the linked Merkat
project confirms preview `dpl_33KZvTcNB5rueGjMWFqP7xeBNhSu`, commit `84e017a`,
branch `new-chat/work/merkat-audit`, is **READY**. Its build and deployment completed.
The preceding `b0d2b3e` preview is canceled. Production remains on `6ea62ba`.
No deployment, project-setting change or production database change was performed.

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
- **IMPLEMENTED, NOT LIVE-VERIFIED:** these repository settings will apply to a
  future Vercel build. No new hosted build was triggered for this check.

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
