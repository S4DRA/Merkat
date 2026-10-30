import { test, expect } from "@playwright/test";
import { navigationDestinations } from "../../apps/web/src/lib/navigation";

for (const width of [320, 360, 390, 430, 768, 1024, 1280, 1440]) {
  test(`navigation, panels and touch targets at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/");
    await expect(page).toHaveURL(/\/chats$/);
    const navigation = page.getByRole("navigation", {
      name: "Main navigation",
    });
    await expect(navigation).toHaveCount(1);
    await expect(navigation.getByRole("link")).toHaveCount(4);
    await expect(
      navigation.getByRole("button", { name: "Create a chat or group" }),
    ).toHaveCount(1);
    await expect(navigation.locator(".badge")).toHaveCount(0);
    for (const [label, heading] of [
      ["Calendar", "Calendar"],
      ["Friends", "Friends"],
      ["Profile", "Profile"],
      ["Chats", "Chats"],
    ] as const) {
      const link = navigation.getByRole("link", { name: label, exact: true });
      await link.click();
      if (label === "Calendar" || label === "Profile")
        await expect(page.locator(".brand-header .brand-link")).toHaveText(
          heading,
        );
      else
        await expect(
          page.getByRole("heading", { name: heading, exact: true }).first(),
        ).toBeVisible();
      if (label === "Calendar")
        await expect(page.locator(".calendar-grid")).toBeVisible();
      await expect(link).toHaveAttribute("aria-current", "page");
      const rect = await link.boundingBox();
      expect(rect!.height).toBeGreaterThanOrEqual(44);
      expect(rect!.width).toBeGreaterThanOrEqual(44);
    }
    await expect(
      page.getByRole("navigation").getByRole("button", { name: "Create a chat or group", exact: true }),
    ).toBeVisible();
    await page.goto("/calls");
    const overview = page.getByRole("region", { name: "Calls overview" });
    if (width < 768) {
      await expect(overview).not.toBeVisible();
      await page.getByRole("button", { name: "Explore this space" }).click();
      await expect(overview).toBeVisible();
      await expect(overview).toBeFocused();
      await expect(
        page.getByRole("region", { name: "Calls context" }),
      ).not.toBeVisible();
      await page.getByRole("button", { name: "Back to Calls" }).click();
      await expect(
        page.getByRole("button", { name: "Explore this space" }),
      ).toBeFocused();
    } else {
      await expect(overview).toBeVisible();
      await expect(
        page.getByRole("region", { name: "Calls context" }),
      ).toBeVisible();
    }
    const dimensions = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      viewport: innerWidth,
      navBottom: document
        .querySelector(".primary-navigation")!
        .getBoundingClientRect().bottom,
      height: innerHeight,
    }));
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.viewport);
    expect(dimensions.navBottom).toBeLessThanOrEqual(dimensions.height);
    await page.screenshot({
      path: `artifacts/phase-2-${width}.png`,
      fullPage: true,
    });
    expect(errors).toEqual([]);
  });
}

test("keyboard, dialog focus, secondary routes and reduced motion", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/calls");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();
  const info = page
    .getByRole("button", { name: "About this space", exact: true })
    .first();
  await info.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Close information" }),
  ).toBeFocused();
  await expect(
    dialog.getByText("Design examples only — not live activity."),
  ).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Loading" })).toBeDisabled();
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(() => !!document.activeElement?.closest("dialog")),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(info).toBeFocused();
  await page.getByRole("link", { name: "Global search" }).click();
  await expect(page).toHaveURL(/\/search$/);
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Profile" })
    .click();
  await page
    .getByRole("link", { name: "Settings", exact: true })
    .last()
    .click();
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue(
          "--motion-fast",
        ),
      ),
    ),
  ).toBe(0);
  const manifest = await (
    await page.request.get("/manifest.webmanifest")
  ).json();
  expect(manifest.display).toBe("standalone");
  expect(manifest.theme_color).toBe("#F55105");
  expect(navigationDestinations("central")).toEqual(
    navigationDestinations("classic"),
  );
  expect(navigationDestinations("central").map((item) => item.id)).toEqual([
    "plans",
    "friends",
    "new-chat",
    "chats",
    "profile",
  ]);
  expect((await page.request.get("/not-a-destination")).status()).toBe(404);
});

test("mobile information and landscape remain usable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto("/calls");
  await page.getByRole("button", { name: "Explore this space" }).click();
  await page
    .getByRole("button", { name: "About this space", exact: true })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Close information" }).click();
  await page.setViewportSize({ width: 767, height: 360 });
  await expect(
    page.getByRole("button", { name: "Back to Calls" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Back to Calls" }).click();
  await page.goto("/calls");
  await expect(
    page.getByRole("heading", { name: "Calls", exact: true }),
  ).toBeVisible();
});
