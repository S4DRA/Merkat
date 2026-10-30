import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mockRealtime } from "../support/mock-realtime";

test.use({ storageState: "artifacts/dm-first-state.json" });
const origin = "https://127.0.0.1:3100";
async function post(page: Page, endpoint: string, data: unknown) {
  const response = await page.request.post(`/api/${endpoint}`, {
    headers: { origin },
    data,
  });
  expect(response.ok(), `${endpoint}: ${response.status()}`).toBe(true);
  return response.json();
}

for (const width of [320, 360, 390, 430]) {
  test(`real two-account messaging, read state, Back and keyboard viewport at ${width}px (mock socket)`, async ({
    page,
    browser,
  }) => {
    const context = await browser.newContext({
      baseURL: origin,
      ignoreHTTPSErrors: true,
      storageState: "artifacts/dm-second-state.json",
      viewport: { width, height: 844 },
    });
    const peer = await context.newPage();
    try {
      await page.setViewportSize({ width, height: 844 });
      const firstSocket = await mockRealtime(page);
      const peerSocket = await mockRealtime(peer);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      peer.on("pageerror", (error) => errors.push(error.message));
      await page.goto("/chats");
      await expect(
        page.getByRole("status").filter({ hasText: /^Live$/ }),
      ).toBeVisible();
      await page
        .getByRole("navigation")
        .getByRole("link", { name: "New chat", exact: true })
        .click();
      await page.getByLabel("Username", { exact: true }).fill("DM_SECOND_TEST");
      await page.getByRole("button", { name: "Find", exact: true }).click();
      await expect(
        page.getByRole("dialog").getByText("@dm_second_test"),
      ).toBeVisible();
      await page.getByRole("button", { name: "Chat", exact: true }).click();
      await expect(page).toHaveURL(/\/chats\?conversation=[a-f0-9-]+$/);
      await expect(
        page.getByRole("navigation", { name: "Main navigation" }),
      ).not.toBeVisible();
      const selectedUrl = page.url();
      const id = new URL(selectedUrl).searchParams.get("conversation")!;
      const message = `Hello at ${width}px ${randomUUID()}`;
      await page.getByLabel("Message", { exact: true }).fill(message);
      const sent = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/direct/send") &&
          response.request().method() === "POST",
      );
      await page.getByRole("button", { name: "Send message" }).click();
      expect((await sent).ok()).toBe(true);
      await expect(
        page.locator(".direct-message").filter({ hasText: message }),
      ).toHaveCount(1);
      await expect(page.getByLabel("Message", { exact: true })).toHaveValue("");
      await peer.goto("/chats");
      await expect(
        peer.getByRole("link").filter({ hasText: "DM first" }),
      ).toBeVisible();
      await expect(peer.locator(".direct-list-item .badge")).toBeVisible();
      await peer.getByRole("link").filter({ hasText: "DM first" }).click();
      await expect(
        peer.locator(".direct-message").filter({ hasText: message }),
      ).toHaveCount(1);
      await peer.bringToFront();
      await expect
        .poll(
          async () =>
            (await post(peer, "direct/messages", { conversationId: id }))
              .conversation.readSequence,
        )
        .toBeGreaterThan(0);
      await firstSocket.notify();
      await expect(
        page
          .locator(".direct-message")
          .filter({ hasText: message })
          .getByLabel("Read", { exact: true }),
      ).toBeVisible();
      const reply = `Reply ${randomUUID()}`;
      await peer.getByLabel("Message", { exact: true }).fill(reply);
      const replied = peer.waitForResponse(
        (response) =>
          response.url().endsWith("/api/direct/send") &&
          response.request().method() === "POST",
      );
      await peer.getByRole("button", { name: "Send message" }).click();
      // Pending bubbles appear before commit. A mocked change signal must wait
      // for the real HTTP transaction, as a hosted database trigger would.
      expect((await replied).ok()).toBe(true);
      await expect(
        peer.locator(".direct-message").filter({ hasText: reply }),
      ).toHaveCount(1);
      await firstSocket.notify();
      await expect(
        page.locator(".direct-message").filter({ hasText: reply }),
      ).toHaveCount(1);
      await peerSocket.notify();
      await page.reload();
      await expect(
        page.locator(".direct-message").filter({ hasText: reply }),
      ).toHaveCount(1);
      await page
        .getByLabel("Message", { exact: true })
        .fill("draft kept with Back");
      await page.getByRole("link", { name: "Back to Chats" }).click();
      await expect(page).toHaveURL(/\/chats$/);
      await expect(
        page.getByRole("navigation", { name: "Main navigation" }),
      ).toBeVisible();
      await page.goBack();
      await expect(page).toHaveURL(selectedUrl);
      await expect(
        page.getByRole("navigation", { name: "Main navigation" }),
      ).not.toBeVisible();
      await expect(page.getByLabel("Message", { exact: true })).toHaveValue(
        "draft kept with Back",
      );
      await page.bringToFront();
      await page.getByLabel("Message", { exact: true }).focus();
      await page.setViewportSize({ width, height: 380 });
      const composer = page.locator(".direct-composer");
      await expect
        .poll(async () => {
          const box = (await composer.boundingBox())!;
          return box.y > 0 && box.y + box.height <= 380;
        })
        .toBe(true);
      expect(
        (await page
          .getByRole("button", { name: "Send message" })
          .boundingBox())!.height,
      ).toBeGreaterThanOrEqual(44);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.setViewportSize({ width, height: 844 });
      await page.getByLabel("Message", { exact: true }).fill("");
      await page.screenshot({
        path: `artifacts/phase-5-thread-${width}.png`,
        fullPage: true,
      });
      await page.getByRole("link", { name: "Back to Chats" }).click();
      await expect(page).toHaveURL(/\/chats$/);
      await expect(
        page.getByRole("navigation", { name: "Main navigation" }),
      ).toBeVisible();
      const logo = page
        .getByRole("navigation")
        .getByRole("link", { name: "New chat", exact: true });
      await expect(logo).toHaveAttribute("href", "/chats?new=1");
      await expect(logo.locator("img")).toHaveAttribute(
        "src",
        "/brand/merkat-white-transparent.png",
      );
      await page.screenshot({
        path: `artifacts/phase-5-list-${width}.png`,
        fullPage: true,
      });
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
}

test("lost send response retries the same submission once; offline catch-up does not duplicate (mock socket)", async ({
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const socket = await mockRealtime(page);
  const { conversation } = await post(page, "direct/open", {
    username: "dm_second_test",
  });
  await page.goto(`/chats?conversation=${conversation.id}`);
  await expect(page.getByLabel("Message", { exact: true })).toBeEnabled();
  // Finish initial history/receipt reconciliation before injecting an ambiguous
  // send response. Otherwise an initial fetch can legitimately confirm the send
  // before the failed-response Retry state is observed.
  await page.waitForLoadState("networkidle");
  const text = `Lost reply ${randomUUID()}`;
  let firstClientId: string | undefined;
  let retryClientId: string | undefined;
  await page.route("**/api/direct/send", async (route) => {
    const body = route.request().postDataJSON();
    if (!firstClientId) {
      firstClientId = body.clientId;
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      await route.abort("failed");
    } else {
      retryClientId = body.clientId;
      await route.continue();
    }
  });
  await page.getByLabel("Message", { exact: true }).fill(text);
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(
    page.getByRole("button", { name: "Retry message" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Retry message" }).click();
  await expect.poll(() => retryClientId).toBe(firstClientId);
  await expect(
    page.locator(".direct-message").filter({ hasText: text }),
  ).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Retry message" })).toHaveCount(
    0,
  );
  const context = await browser.newContext({
    baseURL: origin,
    ignoreHTTPSErrors: true,
    storageState: "artifacts/dm-second-state.json",
  });
  try {
    const peer = await context.newPage();
    socket.pause();
    const missed = `Missed while offline ${randomUUID()}`;
    await post(peer, "direct/send", {
      conversationId: conversation.id,
      clientId: randomUUID(),
      text: missed,
    });
    await socket.reconnect();
    await expect(
      page.locator(".direct-message").filter({ hasText: missed }),
    ).toHaveCount(1);
    await socket.notify();
    await expect(
      page.locator(".direct-message").filter({ hasText: missed }),
    ).toHaveCount(1);
  } finally {
    await context.close();
  }
});

test("older history, scroll restoration, new-message positioning, unavailable state and unauthorized URLs", async ({
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const socket = await mockRealtime(page);
  const { conversation } = await post(page, "direct/open", {
    username: "dm_second_test",
  });
  for (let i = 0; i < 42; i++)
    await post(page, "direct/send", {
      conversationId: conversation.id,
      clientId: randomUUID(),
      text: `Scroll history ${i}\n${randomUUID()}`,
    });
  await page.goto(`/chats?conversation=${conversation.id}`);
  await expect(page.locator(".direct-message")).toHaveCount(40);
  const history = page.getByLabel("Message history");
  await history.evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.getByRole("button", { name: "Load older messages" }).click();
  await expect(page.locator(".direct-message")).not.toHaveCount(40);
  const top = await history.evaluate((el) => el.scrollTop);
  expect(top).toBeGreaterThan(0);
  const selectedUrl = page.url();
  await page.getByRole("link", { name: "Back to Chats" }).click();
  await expect(page).toHaveURL(/\/chats$/);
  await page.goBack();
  await expect(page).toHaveURL(selectedUrl);
  await expect
    .poll(() => history.evaluate((el) => el.scrollTop), {
      message: `Restore message scroll offset ${top}`,
    })
    .toBe(top);
  const context = await browser.newContext({
    baseURL: origin,
    ignoreHTTPSErrors: true,
    storageState: "artifacts/dm-second-state.json",
  });
  try {
    const peer = await context.newPage();
    const text = `Arrives while reading ${randomUUID()}`;
    await post(peer, "direct/send", {
      conversationId: conversation.id,
      clientId: randomUUID(),
      text,
    });
    await socket.notify();
    await expect(
      page.getByRole("button", { name: "New messages", exact: true }),
    ).toBeVisible();
    expect(await history.evaluate((el) => el.scrollTop)).toBeCloseTo(top, 0);
    await page
      .getByRole("button", { name: "New messages", exact: true })
      .click();
    await expect(
      page.locator(".direct-message").filter({ hasText: text }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
  await page.goto(`/chats?conversation=${randomUUID()}`);
  await expect(
    page
      .getByRole("region", { name: "Conversation", exact: true })
      .getByRole("alert"),
  ).toHaveText(/Not found/);
  await expect(page.getByLabel("Message", { exact: true })).toBeDisabled();
  await page.route("**/api/direct/realtime", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "REALTIME_UNAVAILABLE" }),
    }),
  );
  await page.goto("/chats");
  await expect(
    page.getByText("Live updates unavailable", { exact: true }),
  ).toBeVisible();
});

test("conversation hides navigation and reclaims the desktop sidebar; inbox and other pages restore it", async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: origin,
    ignoreHTTPSErrors: true,
    storageState: "artifacts/dm-second-state.json",
  });
  try {
    const page = await context.newPage();
    const { conversation } = await post(page, "direct/open", {
      username: "dm_first_test",
    });
    for (const width of [768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/chats?conversation=${conversation.id}`);
      await expect(
        page.getByRole("navigation", { name: "Main navigation" }),
      ).not.toBeVisible();
      const box = (await page.locator(".shell-workspace").boundingBox())!;
      expect(box.width).toBe(width);
      await page.getByRole("link", { name: "Back to Chats" }).click();
      await expect(page).toHaveURL(/\/chats$/);
      await expect(
        page.getByRole("navigation", { name: "Main navigation" }),
      ).toBeVisible();
    }
    await page.goto("/groups");
    await expect(
      page.getByRole("navigation", { name: "Main navigation" }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

test("logout blocks content and capability renewal for an existing socket (mock socket)", async ({
  page,
}) => {
  const socket = await mockRealtime(page);
  await page.goto("/chats");
  await expect(
    page.getByRole("status").filter({ hasText: /^Live$/ }),
  ).toBeVisible();
  const logout = await page.request.post("/api/auth/logout", {
    headers: { origin },
    data: {},
  });
  expect(logout.status()).toBe(204);
  expect(
    (
      await page.request.post("/api/direct/realtime", {
        headers: { origin },
        data: {},
      })
    ).status(),
  ).toBe(401);
  await socket.notify();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator(".direct-message")).toHaveCount(0);
});
