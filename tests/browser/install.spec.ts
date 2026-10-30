import { test, expect } from "@playwright/test";
test.use({ storageState: { cookies: [], origins: [] } });
test("manifest, tab icon, Apple icon and square approved logo assets are available", async ({
  page,
}) => {
  await page.goto("/register");
  const manifest = await (
    await page.request.get("/manifest.webmanifest")
  ).json();
  expect(manifest.display).toBe("standalone");
  expect(manifest.name).toBe("Merkat");
  expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toEqual([
    "192x192",
    "512x512",
  ]);
  for (const icon of manifest.icons) {
    expect(icon.purpose).toBe("any");
    expect((await page.request.get(icon.src)).status()).toBe(200);
    const size = Number(icon.sizes.split("x")[0]);
    const dimensions = await page.evaluate(async (src: string) => {
      const image = new Image();
      image.src = src;
      await image.decode();
      return { width: image.naturalWidth, height: image.naturalHeight };
    }, icon.src);
    expect(dimensions).toEqual({ width: size, height: size });
  }
  await expect(
    page.locator('link[rel="icon"][href="/favicon.ico"]'),
  ).toHaveCount(1);
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
    "href",
    "/icons/merkat-180.png",
  );
  expect((await page.request.get("/favicon.ico")).status()).toBe(200);
  expect(
    await page.evaluate(async () => ({
      secure: isSecureContext,
      serviceWorkers: (await navigator.serviceWorker.getRegistrations()).length,
      cacheNames: await caches.keys(),
    })),
  ).toEqual({ secure: true, serviceWorkers: 0, cacheNames: [] });
  const cdp = await page.context().newCDPSession(page);
  const app = await cdp.send("Page.getAppManifest");
  expect(app.errors).toEqual([]);
  expect(app.data).toBeTruthy();
  expect(JSON.parse(app.data!).short_name).toBe("Merkat");
});
test("install controls preserve user gesture, show manual guidance and hide in standalone mode", async ({
  page,
}) => {
  await page.goto("/login");
  await page
    .getByRole("button", { name: "Install Merkat", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Install Merkat", exact: true }),
  ).toContainText("Add to Home screen");
  await page
    .getByRole("button", { name: "Close install", exact: true })
    .click();
  await page.evaluate(() => {
    const event = new Event("beforeinstallprompt", { cancelable: true });
    Object.assign(event, {
      prompt: () => {
        document.documentElement.dataset.installPrompt = "requested";
        return Promise.resolve();
      },
      userChoice: Promise.resolve({ outcome: "accepted" }),
    });
    window.dispatchEvent(event);
  });
  await page
    .getByRole("button", { name: "Install Merkat", exact: true })
    .click();
  await page.getByRole("button", { name: "Install app", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-install-prompt",
    "requested",
  );
  await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
  await expect(
    page.getByRole("button", { name: "Install Merkat", exact: true }),
  ).toHaveCount(0);
  // Synthetic install events exercise the UI only, not a physical installation.
});
