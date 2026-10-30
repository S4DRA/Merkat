import { defineConfig } from "@playwright/test";

// Optional live local acceptance uses the running owned development app only.
// The normal suite still starts its isolated HTTPS server/database below.
const localOrigin = process.env.MERKAT_ACCEPTANCE_ORIGIN;
if (localOrigin) {
  const target = new URL(localOrigin);
  if (
    target.origin !== localOrigin ||
    !["localhost", "127.0.0.1"].includes(target.hostname)
  )
    throw new Error("Acceptance overrides require an exact loopback origin.");
}

export default defineConfig({
  testDir: "./tests/browser",
  outputDir: "artifacts/browser",
  workers: 1,
  use: {
    baseURL: localOrigin || "https://127.0.0.1:3100",
    ignoreHTTPSErrors: true,
    // The isolated HTTPS ingress has a committed test certificate. Context-only
    // ignoreHTTPSErrors does not cover Chromium service-worker registration.
    // Every origin supported by this configuration is restricted to loopback.
    launchOptions: { args: ["--ignore-certificate-errors"] },
    browserName: "chromium",
    ...(process.env.PLAYWRIGHT_CHANNEL
      ? { channel: process.env.PLAYWRIGHT_CHANNEL }
      : {}),
    headless: true,
    storageState: localOrigin
      ? { cookies: [], origins: [] }
      : "artifacts/authenticated-state.json",
  },
  webServer: localOrigin
    ? []
    : {
        command: "tsx tests/support/browser-server.ts",
        url: "https://127.0.0.1:3100/login",
        ignoreHTTPSErrors: true,
        reuseExistingServer: false,
        timeout: 120000,
      },
});
