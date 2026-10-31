import { test, expect } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";

test("real persisted appearance, system theme and mobile preview journeys", async ({
  page,
}) => {
  // Publishing is limited to synthetic fixture data from a fresh owned cluster.
  // No production/staging override, external database or user session is allowed.
  expect(process.env.MERKAT_ACCEPTANCE_ORIGIN).toBeUndefined();
  const fixture = JSON.parse(
    await readFile("artifacts/browser-database.json", "utf8"),
  );
  expect(fixture.owner).toBe("merkat-isolated-browser-test-v1");
  const fixtureUrl = new URL(fixture.url);
  expect(fixtureUrl.hostname).toBe("127.0.0.1");
  expect(fixtureUrl.username).toMatch(/^test_[0-9a-f]{12}$/);
  expect(fixtureUrl.pathname).toBe("/postgres");
  const account = await (await page.request.get("/api/account/session")).json();
  expect(account.user.profile.username).toBe("authenticated_test");
  expect(account.user.profile.displayName).toBe("Test Account");
  await mkdir("artifacts/release-preview", { recursive: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const origin = "https://127.0.0.1:3100";
  const settings = await (
    await page.request.post("/api/preferences/get", {
      headers: { origin },
      data: {},
    })
  ).json();
  try {
    for (const [label, theme] of [
      ["Light", "light"],
      ["Dark", "dark"],
    ] as const) {
      await page.goto("/settings");
      await page.getByRole("radio", { name: label, exact: true }).check();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(
        page.getByRole("radio", { name: label, exact: true }),
      ).toBeEnabled();
      await page.reload();
      await expect(
        page.getByRole("radio", { name: label, exact: true }),
      ).toBeChecked();
      await page.goto("/plans");
      await expect(page.locator(".calendar-grid")).toBeVisible();
      await expect(
        page.getByText("Updating calendar…", { exact: true }),
      ).toHaveCount(0);
      await page.screenshot({
        path: `artifacts/release-preview/calendar-mobile-${theme}.png`,
      });
    }
    await page.goto("/settings");
    await page.getByRole("radio", { name: "System", exact: true }).check();
    await expect(
      page.getByRole("radio", { name: "System", exact: true }),
    ).toBeEnabled();
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await expect(page.locator("html")).toHaveAttribute(
        "data-theme",
        colorScheme,
      );
    }
    await page.getByRole("checkbox", { name: /Reduce motion/ }).check();
    await expect(page.locator("html")).toHaveAttribute(
      "data-reduce-motion",
      "true",
    );
    await expect(
      page.getByRole("checkbox", { name: /Larger text/ }),
    ).toBeEnabled();
    await page.getByRole("checkbox", { name: /Larger text/ }).check();
    await expect(page.locator("html")).toHaveAttribute(
      "data-large-text",
      "true",
    );
    await expect(
      page.getByRole("checkbox", { name: /Larger text/ }),
    ).toBeEnabled();
    await page.reload();
    await expect(
      page.getByRole("checkbox", { name: /Larger text/ }),
    ).toBeChecked();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "artifacts/release-preview/comfort-mobile-dark.png",
    });
    await page.goto("/profile/edit");
    await expect(page.getByLabel("Choose profile photo")).toBeVisible();
    await page.screenshot({
      path: "artifacts/release-preview/profile-mobile-dark.png",
    });
    await page.goto("/chats");
    await page
      .getByRole("button", { name: "Create a chat or group", exact: true })
      .click();
    await expect(
      page.getByRole("menu", { name: "Create", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: "artifacts/release-preview/create-menu-mobile-dark.png",
    });
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/plans");
    await expect(page.locator(".calendar-grid")).toBeVisible();
    await expect(
      page.getByText("Updating calendar…", { exact: true }),
    ).toHaveCount(0);
    await page.screenshot({
      path: "artifacts/release-preview/calendar-desktop-dark.png",
    });
  } finally {
    const response = await page.request.post("/api/preferences/update", {
      headers: { origin },
      data: settings.settings,
    });
    expect(response.ok()).toBe(true);
  }
});
