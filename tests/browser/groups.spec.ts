import { test, expect, type Page, type Browser } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { GroupDetail, GroupList } from "@merkat/contracts";
import { mockRealtime } from "../support/mock-realtime";
test.use({ storageState: "artifacts/dm-group_owner-state.json" });
const origin = "https://127.0.0.1:3100";
async function post<T>(
  page: Page,
  endpoint: string,
  data: unknown,
): Promise<T> {
  const response = await page.request.post(`/api/${endpoint}`, {
    headers: { origin },
    data,
  });
  expect(response.ok(), `${endpoint}: ${response.status()}`).toBe(true);
  return response.status() === 204 ? (undefined as T) : response.json();
}
async function memberPage(browser: Browser, width = 390) {
  const context = await browser.newContext({
    baseURL: origin,
    ignoreHTTPSErrors: true,
    storageState: "artifacts/dm-group_member-state.json",
    viewport: { width, height: 844 },
  });
  return { context, peer: await context.newPage() };
}
async function community(page: Page, peer: Page, name: string) {
  await post(peer, "privacy/update", {
    allowNonFriendDms: true,
    groupInvitesFrom: "EVERYONE",
  });
  const g = await post<GroupDetail>(page, "groups/create", {
    clientId: randomUUID(),
    name,
    usernames: ["dm_group_member_test"],
  });
  const invite = (
    await post<GroupList>(peer, "groups/list", {})
  ).invitations.find((i) => i.groupId === g.id)!;
  await post(peer, "groups/invitation", { id: invite.id, action: "ACCEPT" });
  return g;
}
for (const width of [320, 360, 390, 430]) {
  test(`group messaging, replies, channel sheet, Back and reduced composer at ${width}px (mock transport)`, async ({
    page,
    browser,
  }) => {
    const { context, peer } = await memberPage(browser, width);
    try {
      const g = await community(page, peer, `Group ${width}`),
        channelId = g.defaultChannelId,
        url = `/chats?group=${g.id}&channel=${channelId}`;
      await page.setViewportSize({ width, height: 844 });
      const socket = await mockRealtime(page),
        peerSocket = await mockRealtime(peer);
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      peer.on("pageerror", (e) => errors.push(e.message));
      await page.goto(url);
      await peer.goto(url);
      await expect(page.getByLabel("Message general")).toBeEnabled();
      await expect(
        page.getByRole("navigation", { name: "Main navigation" }),
      ).not.toBeVisible();
      const text = `Group message ${width} ${randomUUID()}`;
      await page.getByLabel("Message general").fill(text);
      const sent = page.waitForResponse(
        (r) =>
          r.url().endsWith("/api/groups/send") &&
          r.request().method() === "POST",
      );
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      expect((await sent).ok()).toBe(true);
      await peerSocket.notify();
      await expect(
        peer.locator(".group-message").filter({ hasText: text }),
      ).toHaveCount(1);
      await peer
        .getByRole("button", { name: "Reply to message 1", exact: true })
        .click();
      const reply = `Reply ${width} ${randomUUID()}`;
      await peer.getByLabel("Message general").fill(reply);
      const replied = peer.waitForResponse(
        (r) =>
          r.url().endsWith("/api/groups/send") &&
          r.request().method() === "POST",
      );
      await peer
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      expect((await replied).ok()).toBe(true);
      await socket.notify();
      const bubble = page.locator(".group-message").filter({ hasText: reply });
      await expect(bubble).toHaveCount(1);
      await expect(bubble.locator("blockquote")).toContainText(text);
      await peer.bringToFront();
      await expect
        .poll(
          async () =>
            (
              await post<GroupDetail>(peer, "groups/detail", { groupId: g.id })
            ).channels.find((c) => c.id === channelId)!.readSequence,
        )
        .toBe(2);
      await page
        .getByRole("button", { name: "Group settings", exact: true })
        .click();
      const settings = page.getByRole("dialog", {
        name: "Group settings",
        exact: true,
      });
      await expect(settings).toBeVisible();
      await settings
        .getByLabel("New channel", { exact: true })
        .fill(`weekend_${width}`);
      const created = page.waitForResponse((r) =>
        r.url().endsWith("/api/groups/channel/create"),
      );
      await settings
        .getByRole("button", { name: "Create channel", exact: true })
        .click();
      expect((await created).status()).toBe(201);
      await expect(
        settings.getByLabel(`Rename weekend_${width}`, { exact: true }),
      ).toBeVisible();
      await settings
        .getByRole("button", { name: "Close group settings", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Switch channel: general", exact: true })
        .click();
      const sheet = page.getByRole("dialog", { name: "Channels", exact: true });
      await expect(sheet).toBeVisible();
      const bounds = await sheet.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.width).toBeLessThanOrEqual(width);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(845);
      await sheet
        .getByRole("link", { name: `weekend_${width}`, exact: true })
        .click();
      const composer = page.getByLabel(`Message weekend_${width}`, {
        exact: true,
      });
      await expect(composer).toBeEnabled();
      await composer.fill("Channel draft");
      await page.goBack();
      await expect(
        page.getByLabel("Message general", { exact: true }),
      ).toBeEnabled();
      await page.goForward();
      await expect(composer).toHaveValue("Channel draft");
      await page.setViewportSize({ width, height: 380 });
      const rect = await composer.boundingBox();
      expect(rect!.y + rect!.height).toBeLessThanOrEqual(380);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.setViewportSize({ width, height: 844 });
      await page
        .getByRole("link", { name: "Back to Chats", exact: true })
        .last()
        .click();
      await expect(
        page.getByRole("navigation", { name: "Main navigation" }),
      ).toBeVisible();
      await expect(
        page.getByRole("link").filter({ hasText: `Group ${width}` }),
      ).toBeVisible();
      await page.goBack();
      await expect(composer).toHaveValue("Channel draft");
      await page.screenshot({
        path: `artifacts/phase-6/group-${width}.png`,
        fullPage: true,
      });
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
}

test("desktop group management, role controls and removed-member content denial (mock transport)", async ({
  page,
  browser,
}) => {
  const { context, peer } = await memberPage(browser, 1440);
  try {
    const g = await community(page, peer, "Desktop roles");
    await page.setViewportSize({ width: 1440, height: 1000 });
    await mockRealtime(page);
    const peerSocket = await mockRealtime(peer);
    await page.goto(`/chats?group=${g.id}&channel=${g.defaultChannelId}`);
    await peer.goto(`/chats?group=${g.id}&channel=${g.defaultChannelId}`);
    await expect(
      page.getByRole("navigation", { name: "Main navigation" }),
    ).not.toBeVisible();
    await page
      .getByRole("button", { name: "Group settings", exact: true })
      .click();
    const settings = page.getByRole("dialog", {
      name: "Group settings",
      exact: true,
    });
    const member = settings
      .locator(".social-member")
      .filter({ hasText: "@dm_group_member_test" });
    await member
      .getByRole("button", { name: "Make admin", exact: true })
      .click();
    await expect(
      member.getByRole("button", { name: "Make member", exact: true }),
    ).toBeVisible();
    await peerSocket.notify();
    await peer
      .getByRole("button", { name: "Group settings", exact: true })
      .click();
    await expect(peer.getByLabel("New channel", { exact: true })).toBeVisible();
    await peer
      .getByRole("button", { name: "Close group settings", exact: true })
      .click();
    await member.getByRole("button", { name: "Remove", exact: true }).click();
    await settings
      .getByRole("group", { name: "Confirm group action" })
      .getByRole("button", { name: "Confirm", exact: true })
      .click();
    await expect(
      settings.getByText("@dm_group_member_test", { exact: true }),
    ).toHaveCount(0);
    await peerSocket.notify();
    await expect(peer).toHaveURL(/\/chats\?notice=unavailable$/);
    await expect(
      peer.getByRole("navigation", { name: "Main navigation" }),
    ).toBeVisible();
    const denied = await peer.request.post("/api/groups/messages", {
      headers: { origin },
      data: { groupId: g.id, channelId: g.defaultChannelId },
    });
    expect(denied.status()).toBe(404);
    await page.screenshot({
      path: "artifacts/phase-6/group-desktop-settings.png",
      fullPage: true,
    });
  } finally {
    await context.close();
  }
});

test("group reconnect catches missed messages and ambiguous sends retry one persisted submission (mock transport)", async ({
  page,
  browser,
}) => {
  const { context, peer } = await memberPage(browser);
  try {
    const g = await community(page, peer, "Recovery group"),
      channelId = g.defaultChannelId;
    const socket = await mockRealtime(page);
    await page.goto(`/chats?group=${g.id}&channel=${channelId}`);
    await expect(
      page.getByLabel("Message general", { exact: true }),
    ).toBeEnabled();
    await socket.pause();
    const missed = await post<{ id: string }>(peer, "groups/send", {
      groupId: g.id,
      channelId,
      clientId: randomUUID(),
      text: "Missed during disconnect",
    });
    await expect(page.locator(`[data-message-id="${missed.id}"]`)).toHaveCount(
      0,
    );
    await socket.reconnect();
    await expect(page.locator(`[data-message-id="${missed.id}"]`)).toHaveCount(
      1,
    );
    // Finish reconnect/history/receipt reconciliation before dropping a send
    // response; otherwise the successful automatic catch-up legitimately hides Retry.
    await page.waitForLoadState("networkidle");
    let fault = true;
    await page.route("**/api/groups/send", async (route) => {
      if (!fault) return route.continue();
      fault = false;
      await route.fetch();
      await route.abort("failed");
    });
    await page
      .getByLabel("Message general", { exact: true })
      .fill("Ambiguous group send");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Retry message", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Retry message", exact: true })
      .click();
    await expect(
      page
        .locator(".group-message")
        .filter({ hasText: "Ambiguous group send" }),
    ).toHaveCount(1);
    const persisted = await post<{ messages: { text: string }[] }>(
      page,
      "groups/messages",
      { groupId: g.id, channelId },
    );
    expect(
      persisted.messages.filter((m) => m.text === "Ambiguous group send"),
    ).toHaveLength(1);
  } finally {
    await context.close();
  }
});

test("DM blocking/unblocking, private reports and settings remain functional (mock transport)", async ({
  page,
  browser,
}) => {
  const { context, peer } = await memberPage(browser);
  try {
    await mockRealtime(page);
    await mockRealtime(peer);
    const conversation = await post<{ conversation: { id: string } }>(
      page,
      "direct/open",
      { username: "dm_group_member_test" },
    );
    await page.goto(`/chats?conversation=${conversation.conversation.id}`);
    await expect(page.getByLabel("Message", { exact: true })).toBeEnabled();
    await page
      .getByRole("button", { name: "Conversation options", exact: true })
      .click();
    await page.getByRole("button", { name: "Block user", exact: true }).click();
    await expect(page.getByLabel("Message", { exact: true })).toBeDisabled();
    const denied = await peer.request.post("/api/direct/send", {
      headers: { origin },
      data: {
        conversationId: conversation.conversation.id,
        clientId: randomUUID(),
        text: "Unwanted",
      },
    });
    expect(denied.status()).toBe(403);
    await page
      .getByRole("button", { name: "Conversation options", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Report user", exact: true })
      .click();
    await page
      .getByLabel("Reason", { exact: true })
      .fill("Private browser report");
    await page
      .getByRole("button", { name: "Save report", exact: true })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "Report saved privately." }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page
      .getByRole("button", { name: "Conversation options", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Unblock user", exact: true })
      .click();
    await expect(page.getByLabel("Message", { exact: true })).toBeEnabled();
    await page.goto("/settings");
    await expect(
      page.getByRole("region", { name: "Privacy", exact: true }),
    ).toBeVisible();
    await page.getByLabel("Allow new DMs from non-friends").uncheck();
    await page
      .getByRole("button", { name: "Save privacy", exact: true })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: /^Saved\.$/ }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByLabel("Allow new DMs from non-friends"),
    ).not.toBeChecked();
  } finally {
    await context.close();
  }
});

test("group creation and invitation acceptance work through the approved New chat entry (mock transport)", async ({
  page,
  browser,
}) => {
  const context = await browser.newContext({
      baseURL: origin,
      ignoreHTTPSErrors: true,
      storageState: "artifacts/dm-group_outsider-state.json",
      viewport: { width: 390, height: 844 },
    }),
    peer = await context.newPage();
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    const ownerSocket = await mockRealtime(page);
    await mockRealtime(peer);
    await post(peer, "privacy/update", {
      allowNonFriendDms: true,
      groupInvitesFrom: "EVERYONE",
    });
    await page.goto("/chats");
    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "New chat", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("link", { name: "Create group", exact: true })
      .click();
    const create = page.getByRole("dialog", {
      name: "Create group",
      exact: true,
    });
    const name = `Created in browser ${randomUUID().slice(0, 8)}`;
    await create.getByLabel("Group name", { exact: true }).fill(name);
    await create
      .getByLabel("Description (optional)")
      .fill("Real creation form");
    await create
      .getByRole("button", { name: "Create group", exact: true })
      .click();
    await expect(
      page.getByLabel("Message general", { exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "Group settings", exact: true })
      .click();
    const settings = page.getByRole("dialog", {
      name: "Group settings",
      exact: true,
    });
    await settings
      .getByLabel("Invite by username", { exact: true })
      .fill("dm_group_outsider_test");
    await settings
      .getByRole("button", { name: "Invite member", exact: true })
      .click();
    await expect(
      settings.getByText("Pending · @dm_group_outsider_test", { exact: true }),
    ).toBeVisible();
    await peer.goto("/groups");
    await peer.getByRole("button", { name: "Join group", exact: true }).click();
    await expect(
      peer.getByRole("link").filter({ hasText: name }),
    ).toBeVisible();
    await ownerSocket.notify();
    await expect(
      settings
        .locator(".social-member")
        .filter({ hasText: "@dm_group_outsider_test" }),
    ).toBeVisible();
    await peer.getByRole("link").filter({ hasText: name }).click();
    await expect(
      peer.getByLabel("Message general", { exact: true }),
    ).toBeEnabled();
  } finally {
    await context.close();
  }
});

test("older history preserves scroll and incoming messages; desktop and touch keyboard behavior (mock transport)", async ({
  page,
  browser,
}) => {
  const { context, peer } = await memberPage(browser);
  try {
    const g = await community(page, peer, "Scroll and keyboard"),
      channelId = g.defaultChannelId;
    for (let i = 0; i < 45; i++)
      await post(peer, "groups/send", {
        groupId: g.id,
        channelId,
        clientId: randomUUID(),
        text: `Older row ${i}`,
      });
    await page.setViewportSize({ width: 1440, height: 900 });
    const socket = await mockRealtime(page);
    await page.goto(`/chats?group=${g.id}&channel=${channelId}`);
    await expect(page.locator(".group-message")).toHaveCount(40);
    const scroller = page.getByLabel("Channel message history", {
      exact: true,
    });
    await scroller.evaluate((e) => {
      e.scrollTop = 0;
      e.dispatchEvent(new Event("scroll"));
    });
    const anchor = page.locator('[data-sequence="6"]');
    const before = (await anchor.boundingBox())!.y;
    await page
      .getByRole("button", { name: "Load older messages", exact: true })
      .click();
    await expect(page.locator(".group-message")).toHaveCount(45);
    expect(Math.abs((await anchor.boundingBox())!.y - before)).toBeLessThan(6);
    const top = await scroller.evaluate((e) => e.scrollTop);
    await post(peer, "groups/send", {
      groupId: g.id,
      channelId,
      clientId: randomUUID(),
      text: "Arrived while reading older history",
    });
    await socket.notify();
    await expect(
      page.getByRole("button", { name: "New messages", exact: true }),
    ).toBeVisible();
    expect(
      Math.abs((await scroller.evaluate((e) => e.scrollTop)) - top),
    ).toBeLessThan(6);
    await page
      .getByRole("button", { name: "New messages", exact: true })
      .click();
    const composer = page.getByLabel("Message general", { exact: true });
    await composer.fill("Composition stays in draft");
    await composer.dispatchEvent("keydown", {
      key: "Enter",
      isComposing: true,
      keyCode: 229,
    });
    await expect(composer).toHaveValue("Composition stays in draft");
    await composer.press("Shift+Enter");
    await expect(composer).toHaveValue("Composition stays in draft\n");
    await composer.press("Enter");
    await expect(
      page
        .locator(".group-message")
        .filter({ hasText: "Composition stays in draft" }),
    ).toHaveCount(1);
    const touch = await browser.newContext({
      baseURL: origin,
      ignoreHTTPSErrors: true,
      storageState: "artifacts/dm-group_owner-state.json",
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    try {
      const phone = await touch.newPage();
      await mockRealtime(phone);
      await phone.goto(`/chats?group=${g.id}&channel=${channelId}`);
      const input = phone.getByLabel("Message general", { exact: true });
      await input.fill("Mobile newline");
      await input.press("Enter");
      await expect(input).toHaveValue("Mobile newline\n");
      await expect(
        phone.locator(".group-message").filter({ hasText: "Mobile newline" }),
      ).toHaveCount(0);
    } finally {
      await touch.close();
    }
  } finally {
    await context.close();
  }
});

test("a delayed group receipt drains a newer visible cursor without a second notification (mock transport)", async ({
  page,
  browser,
}) => {
  const { context, peer } = await memberPage(browser);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: () => void;
  const captured = new Promise<void>((resolve) => {
    started = resolve;
  });
  try {
    const g = await community(page, peer, "Overlapping receipts"),
      channelId = g.defaultChannelId;
    const socket = await mockRealtime(page);
    await page.goto(`/chats?group=${g.id}&channel=${channelId}`);
    await expect(
      page.getByLabel("Message general", { exact: true }),
    ).toBeEnabled();
    await page.bringToFront();
    await page.waitForLoadState("networkidle");
    let first = true;
    await page.route("**/api/groups/receipt", async (route) => {
      if (!first) return route.continue();
      first = false;
      const response = await route.fetch();
      started();
      await gate;
      await route.fulfill({ response });
    });
    await post(peer, "groups/send", {
      groupId: g.id,
      channelId,
      clientId: randomUUID(),
      text: "First visible receipt",
    });
    await socket.notify();
    await captured;
    await post(peer, "groups/send", {
      groupId: g.id,
      channelId,
      clientId: randomUUID(),
      text: "Second arrived while receipt pending",
    });
    await socket.notify();
    await expect(page.locator(".group-message")).toHaveCount(2);
    expect(
      (
        await post<GroupDetail>(page, "groups/detail", { groupId: g.id })
      ).channels.find((c) => c.id === channelId)!.readSequence,
    ).toBe(1);
    release();
    await expect
      .poll(
        async () =>
          (
            await post<GroupDetail>(page, "groups/detail", { groupId: g.id })
          ).channels.find((c) => c.id === channelId)!.readSequence,
      )
      .toBe(2);
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
    await context.close();
  }
});
