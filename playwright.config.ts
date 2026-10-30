import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  outputDir: "artifacts/browser",
  workers: 1,
  use: {
    baseURL: "https://127.0.0.1:3100",
    ignoreHTTPSErrors: true,
    browserName: "chromium",
    ...(process.env.PLAYWRIGHT_CHANNEL
      ? { channel: process.env.PLAYWRIGHT_CHANNEL }
      : {}),
    headless: true,
    storageState: "artifacts/authenticated-state.json",
  },
  webServer: {
    command: "tsx tests/support/browser-server.ts",
    url: "https://127.0.0.1:3100/login",
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
    timeout: 120000,
  },
});
