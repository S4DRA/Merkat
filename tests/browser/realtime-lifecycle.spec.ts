import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mockRealtime } from "../support/mock-realtime";

// Actual client, capability issuer, database and HTTP APIs; mocked socket transport only.
// These tests do not establish hosted Supabase delivery or server-side JWT verification.
test.use({ storageState: "artifacts/dm-lifecycle_first-state.json" });
const origin = "https://127.0.0.1:3100";
const live = (page: Page) =>
  page
    .locator('[role="status"]:visible')
    .filter({ hasText: /^Live$/ })
    .first();

test("renews a real capability before its 90-second expiry (mock socket)", async ({
  page,
}) => {
  test.setTimeout(100000);
  let successfulCapabilities = 0;
  page.on("response", (response) => {
    if (
      response.url().endsWith("/api/direct/realtime") &&
      response.status() === 200
    )
      successfulCapabilities++;
  });
  const socket = await mockRealtime(page);
  await page.goto("/chats");
  await expect(live(page)).toBeVisible();
  const initial = socket.authorization();
  expect(initial.joins).toBe(1);
  await expect
    .poll(() => socket.authorization().expiresAt, {
      // Installed SDK heartbeats every 25s: the 30s cache margin first renews
      // around 75s. Allow that heartbeat's HTTP round trip, still before expiry.
      timeout: 85000,
      intervals: [1000],
      message:
        "The SDK heartbeat must renew authorization before the original capability expires",
    })
    .toBeGreaterThan(initial.expiresAt);
  expect(socket.authorization().authorizationUpdates).toBeGreaterThan(0);
  expect(successfulCapabilities).toBeGreaterThanOrEqual(2);
  expect(Date.now() / 1000).toBeLessThan(initial.expiresAt);
  await expect(live(page)).toBeVisible();
});

test("socket close automatically rejoins and reconciles missed messages without a notification (mock socket)", async ({
  page,
  browser,
}) => {
  const peerContext = await browser.newContext({
    baseURL: origin,
    ignoreHTTPSErrors: true,
    storageState: "artifacts/dm-lifecycle_second-state.json",
  });
  try {
    const opened = await page.request.post("/api/direct/open", {
      headers: { origin },
      data: { username: "dm_lifecycle_second_test" },
    });
    expect(opened.ok()).toBe(true);
    const { conversation } = await opened.json();
    const socket = await mockRealtime(page);
    await page.goto(`/chats?conversation=${conversation.id}`);
    await expect(live(page)).toBeVisible();
    await expect(page.getByLabel("Message", { exact: true })).toBeEnabled();
    // Let the initial subscription/history/receipt reconciliation finish before
    // creating the missed message; an initial in-flight fetch must not deliver it.
    await page.waitForLoadState("networkidle");
    const originalJoins = socket.authorization().joins;
    const text = `Missed before socket rejoin ${randomUUID()}`;
    const sent = await peerContext.request.post("/api/direct/send", {
      headers: { origin },
      data: { conversationId: conversation.id, clientId: randomUUID(), text },
    });
    expect(sent.ok()).toBe(true);
    await expect(
      page.locator(".direct-message").filter({ hasText: text }),
    ).toHaveCount(0);
    await socket.disconnect();
    await expect
      .poll(() => socket.authorization().joins, { timeout: 15000 })
      .toBeGreaterThan(originalJoins);
    await expect(live(page)).toBeVisible();
    await expect(
      page.locator(".direct-message").filter({ hasText: text }),
    ).toHaveCount(1);
    await page.reload();
    await expect(
      page.locator(".direct-message").filter({ hasText: text }),
    ).toHaveCount(1);
  } finally {
    await peerContext.close();
  }
});

test("desktop Enter, Shift+Enter, composition and touch Enter preserve composer behavior", async ({
  page,
  browser,
}) => {
  const opened = await page.request.post("/api/direct/open", {
    headers: { origin },
    data: { username: "dm_lifecycle_second_test" },
  });
  expect(opened.ok()).toBe(true);
  const { conversation } = await opened.json();
  await page.setViewportSize({ width: 1024, height: 900 });
  await mockRealtime(page);
  await page.goto(`/chats?conversation=${conversation.id}`);
  const composer = page.getByLabel("Message", { exact: true });
  await expect(composer).toBeEnabled();
  const desktop = `Desktop keyboard ${randomUUID()}`;
  await composer.fill(desktop);
  await composer.press("Shift+Enter");
  await expect(composer).toHaveValue(desktop + "\n");
  await composer.fill(desktop);
  await composer.dispatchEvent("keydown", { key: "Enter", isComposing: true });
  await expect(composer).toHaveValue(desktop);
  await expect(
    page.locator(".direct-message").filter({ hasText: desktop }),
  ).toHaveCount(0);
  await composer.press("Enter");
  await expect(
    page.locator(".direct-message").filter({ hasText: desktop }),
  ).toHaveCount(1);
  await expect(composer).toHaveValue("");

  const touchContext = await browser.newContext({
    baseURL: origin,
    ignoreHTTPSErrors: true,
    storageState: "artifacts/dm-lifecycle_first-state.json",
    viewport: { width: 390, height: 380 },
    hasTouch: true,
    isMobile: true,
  });
  try {
    const touch = await touchContext.newPage();
    await mockRealtime(touch);
    await touch.goto(`/chats?conversation=${conversation.id}`);
    expect(
      await touch.evaluate(() => matchMedia("(pointer: coarse)").matches),
    ).toBe(true);
    const input = touch.getByLabel("Message", { exact: true });
    await expect(input).toBeEnabled();
    const mobile = `Touch keyboard ${randomUUID()}`;
    await input.fill(mobile);
    await input.press("Enter");
    await expect(input).toHaveValue(mobile + "\n");
    await expect(
      touch.locator(".direct-message").filter({ hasText: mobile }),
    ).toHaveCount(0);
    await touch.getByRole("button", { name: "Send message" }).click();
    await expect(
      touch.locator(".direct-message").filter({ hasText: mobile }),
    ).toHaveCount(1);
    await expect(
      touch.getByRole("navigation", { name: "Main navigation" }),
    ).not.toBeVisible();
  } finally {
    await touchContext.close();
  }
});

test("a failed receipt clears its error after socket recovery without manual Retry (mock socket)", async ({
  page,
  browser,
}) => {
  const peer = await browser.newContext({
    baseURL: origin,
    ignoreHTTPSErrors: true,
    storageState: "artifacts/dm-lifecycle_second-state.json",
  });
  try {
    const opened = await page.request.post("/api/direct/open", {
      headers: { origin },
      data: { username: "dm_lifecycle_second_test" },
    });
    expect(opened.ok()).toBe(true);
    const { conversation } = await opened.json();
    const socket = await mockRealtime(page);
    await page.goto(`/chats?conversation=${conversation.id}`);
    await page.bringToFront();
    await expect(live(page)).toBeVisible();
    await page.waitForLoadState("networkidle");
    let failed = false;
    await page.route("**/api/direct/receipt", async (route) => {
      if (!failed) {
        failed = true;
        await route.abort("failed");
      } else await route.continue();
    });
    const text = `Receipt recovery ${randomUUID()}`;
    const sent = await peer.request.post("/api/direct/send", {
      headers: { origin },
      data: { conversationId: conversation.id, clientId: randomUUID(), text },
    });
    expect(sent.ok()).toBe(true);
    await socket.notify();
    await expect(
      page.getByRole("button", { name: "Retry", exact: true }),
    ).toBeVisible();
    const joins = socket.authorization().joins;
    await socket.disconnect();
    await expect
      .poll(() => socket.authorization().joins, { timeout: 15000 })
      .toBeGreaterThan(joins);
    await expect(live(page)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Retry", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.locator(".direct-message").filter({ hasText: text }),
    ).toHaveCount(1);
  } finally {
    await peer.close();
  }
});
