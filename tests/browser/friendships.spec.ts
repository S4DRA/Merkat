import { test, expect } from "@playwright/test";
import { mockRealtime } from "../support/mock-realtime";

test.use({ storageState: "artifacts/dm-first-state.json" });
for (const width of [320, 360, 390, 430]) {
  test(`real friend request, acceptance, messaging and removal at ${width}px (mock socket)`, async ({
    page,
    browser,
  }) => {
    const context = await browser.newContext({
      baseURL: "https://127.0.0.1:3100",
      ignoreHTTPSErrors: true,
      storageState: "artifacts/dm-second-state.json",
      viewport: { width, height: 844 },
    });
    const peer = await context.newPage();
    try {
      await page.setViewportSize({ width, height: 844 });
      const firstSocket = await mockRealtime(page);
      const peerSocket = await mockRealtime(peer);
      await page.goto("/friends");
      const nav = page.getByRole("navigation", { name: "Main navigation" });
      await expect(nav.getByRole("link").nth(0)).toHaveAccessibleName(
        "Calendar",
      );
      await expect(nav.getByRole("link").nth(1)).toHaveAccessibleName(
        "Friends",
      );
      await expect(
        nav.getByRole("button", { name: "Create a chat or group" }),
      ).toHaveAttribute("aria-haspopup", "menu");
      await expect(nav.getByRole("link").nth(2)).toHaveAccessibleName("Chats");
      await expect(nav.getByRole("link").nth(3)).toHaveAccessibleName(
        "Profile",
      );
      await page
        .getByRole("button", { name: "Find friends", exact: true })
        .first()
        .click();
      await page.getByLabel("Username", { exact: true }).fill("DM_SECOND_TEST");
      await page.getByRole("button", { name: "Find", exact: true }).click();
      await page.getByRole("button", { name: "Add", exact: true }).click();
      await expect(
        page.getByRole("tab", { name: "Sent", exact: true }),
      ).toHaveAttribute("aria-selected", "true");
      await expect(
        page.getByRole("tabpanel").getByText("@dm_second_test"),
      ).toBeVisible();
      await peer.goto("/friends");
      await peer.getByRole("tab", { name: /^Requests/ }).click();
      await expect(
        peer.getByRole("tabpanel").getByText("@dm_first_test"),
      ).toBeVisible();
      await peer.getByRole("button", { name: "Accept", exact: true }).click();
      await peer.getByRole("tab", { name: "Friends", exact: true }).click();
      await expect(
        peer.getByRole("tabpanel").getByText("@dm_first_test"),
      ).toBeVisible();
      await firstSocket.notify();
      await page.getByRole("tab", { name: "Friends", exact: true }).click();
      await expect(
        page.getByRole("tabpanel").getByText("@dm_second_test"),
      ).toBeVisible();
      await page.screenshot({
        path: `artifacts/phase-5-friends-${width}.png`,
        fullPage: true,
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page
        .getByRole("button", { name: "Message dm_second_test", exact: true })
        .click();
      await expect(page).toHaveURL(/\/chats\?conversation=/);
      await expect(
        page.getByRole("heading", { name: "DM second", exact: true }),
      ).toBeVisible();
      await page.goBack();
      await expect(page).toHaveURL(/\/friends$/);
      await page.getByRole("button", { name: "Remove", exact: true }).click();
      await expect(
        page.getByRole("tabpanel").getByText("@dm_second_test"),
      ).toHaveCount(0);
      await peerSocket.notify();
      await expect(
        peer.getByRole("tabpanel").getByText("@dm_first_test"),
      ).toHaveCount(0);
      await nav
        .getByRole("button", { name: "Create a chat or group", exact: true })
        .click();
      await page
        .getByRole("menuitem", { name: "New Chat", exact: true })
        .click();
      await expect(
        page.getByRole("dialog", { name: "New chat", exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Close new chat" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
}
