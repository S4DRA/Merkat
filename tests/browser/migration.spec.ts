import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

test("approved white transparent logo opens New chat in the new navigation order", async ({
  page,
}) => {
  const asset = readFileSync(
    "apps/web/public/brand/merkat-orange-on-white.png",
  );
  expect(createHash("sha256").update(asset).digest("hex")).toBe(
    "efedbc064296bd4593d0bd4723d1285b8ae6f3021e68cf5fb3fb3c40d56a0987",
  );
  await page.goto("/chats");
  const links = page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link");
  await expect(links).toHaveText([
    "Calendar",
    "Friends",
    "",
    "Chats",
    "Profile",
  ]);
  const middle = links.nth(2);
  await expect(middle).toHaveAttribute("href", "/chats?new=1");
  const logo = middle.locator("img");
  await expect(logo).toHaveAttribute(
    "src",
    "/brand/merkat-white-transparent.png",
  );
  await expect(logo).toHaveAttribute("alt", "");
  await expect(middle.locator("svg")).toHaveCount(0);
  expect(
    await logo.evaluate(
      (image: HTMLImageElement) =>
        image.complete && image.naturalWidth === 1536,
    ),
  ).toBe(true);
  await middle.focus();
  await expect(middle).toBeFocused();
  expect(
    await middle.evaluate((element) => getComputedStyle(element).outlineStyle),
  ).not.toBe("none");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/chats\?new=1$/);
  await expect(page.getByRole("dialog", { name: "New chat" })).toBeVisible();
});

for (const width of [320, 360, 390, 430]) {
  test(`account inputs, errors, viewport resizing and back navigation at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/profile/edit");
    const username = page.getByLabel("Username", { exact: true });
    await username.focus();
    await expect(username).toBeFocused();
    expect((await username.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(
      await username.evaluate((element) => getComputedStyle(element).fontSize),
    ).toBe("16px");
    await page.setViewportSize({ width, height: 340 });
    await username.scrollIntoViewIfNeeded();
    const box = (await username.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(340);
    await page.setViewportSize({ width, height: 844 });
    await page.route("**/api/account/profile", (route) =>
      route.abort("failed"),
    );
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator(".account-form").getByRole("alert")).toHaveText(
      "Couldn’t connect. Try again.",
    );
    await expect(
      page.getByRole("button", { name: "Save", exact: true }),
    ).toBeEnabled();
    await expect(username).toBeEnabled();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `artifacts/phase-3.5-profile-${width}.png`,
      fullPage: true,
    });
    await page.goto("/profile");
    await page.getByRole("link", { name: "Edit profile" }).first().click();
    await expect(page).toHaveURL(/\/profile\/edit$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/profile$/);
  });
}

test("built Next server handles API aliases, Secure cookies and CSRF without Fastify", async ({
  playwright,
}) => {
  const request = await playwright.request.newContext({
    baseURL: "https://127.0.0.1:3100",
    ignoreHTTPSErrors: true,
    storageState: "artifacts/rotation-state.json",
  });
  const current = await request.get("/api/account/session");
  expect(current.status()).toBe(200);
  const canonical = await request.get("/api/auth/session");
  expect(await canonical.json()).toEqual(await current.json());
  expect((await request.get("/health/live")).status()).toBe(200);
  expect((await request.post("/api/account/rotate")).status()).toBe(403);
  const rotated = await request.post("/api/account/rotate", {
    headers: { origin: "https://127.0.0.1:3100" },
  });
  expect(rotated.status()).toBe(204);
  const cookie = rotated.headers()["set-cookie"]!;
  for (const flag of [
    "__Host-merkat_session=",
    "Secure",
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
  ])
    expect(cookie).toContain(flag);
  expect(cookie).not.toContain("Domain=");
  expect((await request.get("/api/account/session")).status()).toBe(200);
  expect(
    (
      await request.post("/api/account/phone/start", {
        headers: { origin: "https://127.0.0.1:3100" },
        data: { phone: "+905551234567" },
      })
    ).status(),
  ).toBe(503);
  expect(
    (await request.get("/api/matrix/_matrix/client/v3/sync")).status(),
  ).toBe(503);
  const root = JSON.parse(readFileSync("package.json", "utf8"));
  expect(root.scripts.dev).not.toContain("@merkat/api");
  expect(root.scripts.build).not.toContain("@merkat/api");
  expect(
    readFileSync("apps/web/src/lib/account-server.ts", "utf8"),
  ).not.toContain("fetch(");
  await request.dispose();
});
