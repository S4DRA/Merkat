import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),
  transpilePackages: [
    "@merkat/backend",
    "@merkat/contracts",
    "@merkat/database",
  ],
};
export default config;
