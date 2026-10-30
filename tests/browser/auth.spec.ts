import { test, expect } from "@playwright/test";

test("signed-out routes redirect to real username/password login", async ({
  browser,
}) => {
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  for (const path of [
    "/chats",
    "/profile",
    "/settings",
    "/onboarding",
    "/profile/edit",
  ]) {
    await page.goto(`https://127.0.0.1:3100${path}`);
    await expect(page).toHaveURL(/\/login$/);
    await expect(
      page.getByRole("button", { name: "Sign in", exact: true }),
    ).toBeEnabled();
    await expect(page.getByLabel("Username", { exact: true })).toBeVisible();
  }
  for (const width of [320, 360, 390, 430, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({
      path: `artifacts/phase-3-login-${width}.png`,
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  expect(
    (
      await context.request.get("https://127.0.0.1:3100/api/account/session")
    ).status(),
  ).toBe(401);
  expect(
    (
      await context.request.get("https://127.0.0.1:3100/api/account/arbitrary")
    ).status(),
  ).toBe(404);
  await context.close();
});

test("onboarding, profile save and logout use real sessions", async ({
  browser,
}) => {
  const context = await browser.newContext({
    storageState: "artifacts/onboarding-state.json",
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("https://127.0.0.1:3100/chats");
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByLabel("Display name").fill("New Account");
  await page.getByLabel("Username", { exact: true }).fill("new_account");
  await page.screenshot({
    path: "artifacts/phase-3-onboarding.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/chats$/);
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Profile" })
    .click();
  await page.getByRole("link", { name: "Edit profile" }).first().click();
  await page.getByLabel("Display name").fill("Changed Name");
  await page.getByLabel("Bio").fill("Updated profile");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await expect(
    page.getByRole("heading", { name: "Changed Name" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("Updated profile", { exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.cookie)).not.toContain(
    "merkat_session",
  );
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("https://127.0.0.1:3100/chats");
  await expect(page).toHaveURL(/\/login$/);
  await context.close();
});
