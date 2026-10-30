import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

test.use({ storageState: { cookies: [], origins: [] } });
const password = "a browser test password phrase";
const username = () =>
  `mobile_${randomUUID().replaceAll("-", "").slice(0, 15)}`;

for (const width of [320, 360, 390, 430]) {
  test(`real registration, immediate entry, profile and login at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/login");
    await page
      .getByRole("link", { name: "Create account", exact: true })
      .click();
    await expect(page).toHaveURL(/\/register$/);
    await expect(
      page.getByText("Lost passwords can’t be recovered."),
    ).toBeVisible();
    const name = username();
    await expect(page.getByLabel("Display name")).toHaveCount(0);
    await expect(
      page.getByLabel("Confirm password", { exact: true }),
    ).toHaveCount(0);
    await page.getByLabel("Username", { exact: true }).fill(name.toUpperCase());
    const input = page.getByLabel("Password", { exact: true });
    await expect(input).toHaveAttribute("autocomplete", "new-password");
    await expect(page.getByLabel("Email (optional)")).not.toHaveAttribute(
      "required",
    );
    if (width === 360)
      await page.getByLabel("Email (optional)").fill("optional@example.test");
    await input.fill(password);
    await page
      .getByRole("button", { name: "Show password", exact: true })
      .click();
    await expect(input).toHaveAttribute("type", "text");
    await expect(input).toHaveValue(password);
    await page
      .getByRole("button", { name: "Hide password", exact: true })
      .click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    for (const label of ["Username", "Password", "Email (optional)"]) {
      const field = page.getByLabel(label, { exact: true });
      expect((await field.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({
      path: `artifacts/phase-4-register-${width}.png`,
      fullPage: true,
    });
    let release: (() => void) | undefined;
    if (width === 390) {
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route("**/api/account/register", async (route) => {
        await gate;
        await route.continue();
      });
    }
    await page
      .getByRole("button", { name: "Create account", exact: true })
      .click();
    if (release) {
      try {
        await expect(
          page.getByRole("button", { name: "Create account", exact: true }),
        ).toBeDisabled();
        await expect(input).toBeDisabled();
        await expect(page.locator("form")).toHaveAttribute("aria-busy", "true");
      } finally {
        release();
      }
    }
    await expect(page).toHaveURL(/\/chats$/);
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    await expect(
      nav.getByRole("link", { name: "New chat", exact: true }).locator("img"),
    ).toHaveAttribute("src", "/brand/merkat-white-transparent.png");
    await nav.getByRole("link", { name: "Profile", exact: true }).click();
    await expect(page.getByText(`@${name}`, { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Edit profile" }).click();
    await page.getByLabel("Bio").fill("Real profile");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page).toHaveURL(/\/profile$/);
    await expect(page.getByText("Real profile", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.cookie)).not.toContain(
      "merkat_session",
    );
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/);
    if (width === 320) {
      await page
        .getByRole("link", { name: "Create account", exact: true })
        .click();
      await expect(page).toHaveURL(/\/register$/);
      await expect(
        page.getByLabel("Password", { exact: true }),
      ).toHaveAttribute("autocomplete", "new-password");
      await page.getByLabel("Username", { exact: true }).fill(name);
      await page.getByLabel("Password", { exact: true }).fill(password);
      const duplicate = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/account/register") &&
          response.request().method() === "POST",
      );
      await page
        .getByRole("button", { name: "Create account", exact: true })
        .click();
      expect((await duplicate).status()).toBe(409);
      await expect(page.locator("form").getByRole("alert")).toHaveText(
        "Couldn’t create account. Try different details.",
      );
      await page.getByRole("link", { name: "Sign in", exact: true }).click();
      await expect(page).toHaveURL(/\/login$/);
    }
    await page.getByLabel("Username", { exact: true }).fill(name);
    await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute(
      "autocomplete",
      "current-password",
    );
    await page
      .getByLabel("Password", { exact: true })
      .fill("incorrect password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.locator("form").getByRole("alert")).toHaveText(
      "Username or password is incorrect.",
    );
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/chats$/);
    await page.reload();
    await expect(nav).toBeVisible();
  });
}

test("registration validates optional email/reserved names, keeps inputs visible and recovers from network errors", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/register");
  await page.getByLabel("Username", { exact: true }).fill("ADMIN");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Email (optional)").fill("invalid-email");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page.getByText("Choose a valid username.")).toBeVisible();
  await expect(
    page.getByText("Enter a valid email or leave it blank."),
  ).toBeVisible();
  await page.getByLabel("Username", { exact: true }).fill(username());
  await page.getByLabel("Email (optional)").fill("");
  await page.setViewportSize({ width: 320, height: 340 });
  const confirmation = page.getByLabel("Email (optional)");
  await confirmation.focus();
  await confirmation.scrollIntoViewIfNeeded();
  const box = (await confirmation.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(340);
  await page.setViewportSize({ width: 767, height: 360 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 320, height: 700 });
  await page.route("**/api/account/register", (route) => route.abort("failed"));
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page.locator("form").getByRole("alert")).toHaveText(
    "Couldn’t connect. Try again.",
  );
  await expect(
    page.getByRole("button", { name: "Create account", exact: true }),
  ).toBeEnabled();
  await page.getByRole("link", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/register$/);
});

test("independent real login sessions survive another device signing out", async ({
  page,
  request,
}) => {
  const name = username();
  const registration = await request.post("/api/account/register", {
    headers: { origin: "https://127.0.0.1:3100" },
    data: { username: name, displayName: "Two devices", password },
  });
  expect(registration.status()).toBe(201);
  await page.goto("/login");
  await page.getByLabel("Username", { exact: true }).fill(name);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/chats$/);
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Profile", exact: true })
    .click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect((await request.get("/api/account/session")).status()).toBe(200);
  const cookies = (await request.storageState()).cookies;
  expect(
    cookies.find((cookie) => cookie.name === "__Host-merkat_session"),
  ).toMatchObject({ httpOnly: true, secure: true, sameSite: "Lax" });
});

test("built production HTTP returns shared throttling and never authenticates rejected attempts", async ({
  request,
}) => {
  const name = username();
  for (let attempt = 0; attempt < 10; attempt++) {
    const response = await request.post("/api/account/login", {
      headers: { origin: "https://127.0.0.1:3100" },
      data: { username: name, password },
    });
    expect(response.status()).toBe(401);
    expect(await response.json()).toEqual({ error: "INVALID_CREDENTIALS" });
  }
  const limited = await request.post("/api/account/login", {
    headers: { origin: "https://127.0.0.1:3100" },
    data: { username: name.toUpperCase(), password },
  });
  expect(limited.status()).toBe(429);
  expect(await limited.json()).toEqual({ error: "TRY_LATER" });
  expect(Number(limited.headers()["retry-after"])).toBeGreaterThan(0);
  expect(limited.headers()["cache-control"]).toBe("no-store");
  expect((await request.get("/api/account/session")).status()).toBe(401);
});
