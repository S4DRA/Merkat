import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
// Copied workspace packages in this sandbox do not have normal symlink invalidation.
const sandboxWebpack: NonNullable<NextConfig["webpack"]> = (webpackConfig) => {
  webpackConfig.cache = false;
  return webpackConfig;
};
const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  distDir: process.env.MERKAT_BUILD_DIR || ".next",
  ...(process.env.MERKAT_BUILD_DIR
    ? {
        experimental: { webpackBuildWorker: false, cpus: 1 },
        webpack: sandboxWebpack,
      }
    : {}),
  outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),
  transpilePackages: [
    "@merkat/backend",
    "@merkat/contracts",
    "@merkat/database",
  ],
};
export default config;
