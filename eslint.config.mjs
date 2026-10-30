import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  globalIgnores([
    "**/.next/**",
    "**/.next-*/**",
    "**/dist/**",
    "**/next-env.d.ts",
    "artifacts/**",
    "packages/database/src/generated/**",
  ]),
  ...tseslint.configs.recommended,
  ...nextVitals.map((config) => ({
    ...config,
    files: ["apps/web/**/*.{ts,tsx,js,mjs}"],
  })),
  ...nextTypescript.map((config) => ({
    ...config,
    files: ["apps/web/**/*.{ts,tsx}"],
  })),
  {
    files: ["apps/web/**/*.{ts,tsx,js,mjs}"],
    settings: { next: { rootDir: "apps/web/" } },
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            "@merkat/backend",
            "@merkat/backend/*",
            "@merkat/database",
            "@merkat/database/*",
            "@prisma/*",
          ],
        },
      ],
    },
  },
  {
    files: ["apps/web/src/lib/server/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: ["@prisma/*"] }],
    },
  },
  {
    files: ["packages/contracts/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            "@merkat/backend",
            "@merkat/database",
            "@prisma/*",
            "node:*",
          ],
        },
      ],
    },
  },
]);
