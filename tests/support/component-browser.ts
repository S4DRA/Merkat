// Component/UI verification only: HTTP and Next routing primitives are explicit test doubles.
// PostgreSQL integrity is verified separately. This is not a live end-to-end claim.
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { build } from "esbuild";
import { chromium } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { tabSummary, splitMinorUnits } from "@merkat/backend";
import {
  defaultAppearance,
  type CalendarEventView,
  type TabState,
  type TabView,
} from "@merkat/contracts";
const root = resolve("artifacts/component-browser");
await mkdir(root, { recursive: true });
const adapter = resolve("tests/support/component-platform.tsx").replaceAll(
  "\\",
  "/",
);
const bundled = await build({
  entryPoints: [resolve("tests/support/component-entry.tsx")],
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "test-platform-adapters",
      setup(b) {
        b.onResolve({ filter: /^next\/(navigation|link|image)$/ }, (args) => ({
          path: args.path,
          namespace: "platform-adapter",
        }));
        b.onLoad({ filter: /.*/, namespace: "platform-adapter" }, (args) => ({
          contents:
            args.path === "next/navigation"
              ? `export {useRouter,usePathname,useSearchParams} from ${JSON.stringify(adapter)}`
              : `export {${args.path === "next/link" ? "Link" : "Image"} as default} from ${JSON.stringify(adapter)}`,
          resolveDir: process.cwd(),
        }));
      },
    },
  ],
});
const javascript = bundled.outputFiles[0]!.text;
const styles =
  (
    await Promise.all(
      [
        "tokens.css",
        "globals.css",
        "account.css",
        "chats.css",
        "social-navigation.css",
        "groups.css",
        "production.css",
        "refinements.css",
      ].map((name) => readFile(resolve("apps/web/src/app", name), "utf8")),
    )
  )
    .join("\n")
    .replace(/@import\s+"\.\/tokens\.css";/g, "") +
  "\n.fixture-tab{padding:28px;overflow:auto;height:100%;max-width:900px;margin:auto;width:100%}";
const uid = "00000000-0000-4000-8000-000000000001",
  bob = "00000000-0000-4000-8000-000000000002",
  casey = "00000000-0000-4000-8000-000000000003",
  cid = "10000000-0000-4000-8000-000000000001",
  eid = "20000000-0000-4000-8000-000000000001",
  tid = "30000000-0000-4000-8000-000000000001";
const people = [
  { id: uid, displayName: "QA Alice", username: "qa_alice" },
  { id: bob, displayName: "QA Bob", username: "qa_bob" },
  { id: casey, displayName: "QA Casey", username: "qa_casey" },
];
const tomorrow = new Date();
tomorrow.setDate(tomorrow.getDate() + 1);
tomorrow.setHours(20, 30, 0, 0);
const event: CalendarEventView = {
  id: eid,
  ownerId: uid,
  version: 1,
  title: "Saturday night out",
  description: "A little good company, a clear plan and no rush.",
  location: "The neighbourhood pub",
  startsAt: tomorrow.toISOString(),
  endsAt: new Date(tomorrow.getTime() + 7200000).toISOString(),
  timezone: "Europe/Istanbul",
  cancelled: false,
  scope: { kind: "DM", id: cid },
  participants: people.slice(0, 2).map((p) => ({
    userId: p.id,
    displayName: p.displayName,
    username: p.username,
    response: p.id === uid ? "GOING" : "INVITED",
    subscribed: p.id === uid,
  })),
};
const state: TabState = {
  participants: people,
  orders: [
    {
      id: randomUUID(),
      authorId: uid,
      name: "Amsterdam beer",
      unitPrice: 20000,
      quantity: 1,
      total: 20000,
      status: "CONFIRMED",
      createdAt: new Date().toISOString(),
      allocations: [{ userId: uid, amount: 20000, accepted: true }],
    },
    {
      id: randomUUID(),
      authorId: bob,
      name: "Craft beer",
      unitPrice: 25000,
      quantity: 1,
      total: 25000,
      status: "CONFIRMED",
      createdAt: new Date().toISOString(),
      allocations: [{ userId: bob, amount: 25000, accepted: true }],
    },
    {
      id: randomUUID(),
      authorId: uid,
      name: "Six shots",
      unitPrice: 15000,
      quantity: 6,
      total: 90000,
      status: "CONFIRMED",
      createdAt: new Date().toISOString(),
      allocations: splitMinorUnits(
        90000,
        people.map((p) => ({ userId: p.id, weight: 1 })),
      ).map((a) => ({ ...a, accepted: true })),
    },
  ],
  payments: [
    {
      id: randomUUID(),
      userId: uid,
      amount: 135000,
      createdAt: new Date().toISOString(),
    },
  ],
  settlements: [],
  audit: [],
  submissions: {},
  snapshot: null,
};
const tab: TabView = {
  id: tid,
  title: "Friday pub night",
  currency: "TRY",
  scope: {
    kind: "GROUP",
    id: "50000000-0000-4000-8000-000000000001",
    channelId: "60000000-0000-4000-8000-000000000001",
  },
  createdBy: uid,
  version: 1,
  closedAt: null,
  createdAt: new Date().toISOString(),
  state,
  summary: tabSummary(state),
  canManage: true,
};
const browser = await chromium.launch({ headless: true });
let checks = 0;
const errors: string[] = [];
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    timezoneId: "Europe/Istanbul",
    locale: "en-GB",
  });
  let settings = { ...defaultAppearance },
    events = [structuredClone(event)];
  const conversation = {
    id: cid,
    peer: {
      id: bob,
      username: "qa_bob",
      displayName: "QA Bob",
      avatarRef: null,
    },
    activityAt: new Date().toISOString(),
    lastSequence: 2,
    latestMessage: null,
    unreadCount: 0,
    deliveredSequence: 2,
    readSequence: 2,
    peerDeliveredSequence: 2,
    peerReadSequence: 2,
    canSend: true,
    blockedByYou: false,
  };
  const messages = [
    {
      id: randomUUID(),
      conversationId: cid,
      senderId: bob,
      clientId: randomUUID(),
      sequence: 1,
      text: "Shall we make a plan for tomorrow?",
      createdAt: new Date().toISOString(),
      feature: null,
    },
    {
      id: randomUUID(),
      conversationId: cid,
      senderId: uid,
      clientId: randomUUID(),
      sequence: 2,
      text: "Plan: Saturday night out",
      createdAt: new Date().toISOString(),
      feature: { kind: "EVENT", id: eid },
    },
  ];
  const requests: { path: string; body: unknown }[] = [];
  await context.route("**/*", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname;
    if (path.startsWith("/api/")) {
      let body: Record<string, unknown> = {};
      try {
        body = request.postDataJSON() as Record<string, unknown>;
      } catch {}
      requests.push({ path, body });
      const json = (value: unknown, status = 200) =>
        route.fulfill({
          status,
          contentType: "application/json",
          body: JSON.stringify(value),
        });
      if (path === "/api/preferences/get") return json({ settings });
      if (path === "/api/preferences/update") {
        settings = body as typeof settings;
        return json({ settings });
      }
      if (path === "/api/notifications/list")
        return json({ notifications: [], unread: 0 });
      if (path === "/api/privacy/settings")
        return json({ allowNonFriendDms: true, groupInvitesFrom: "FRIENDS" });
      if (path === "/api/privacy/blocks")
        return json({ people: [], nextCursor: null });
      if (path === "/api/groups/list")
        return json({
          groups: [],
          nextCursor: null,
          invitations: [],
          hasMoreInvitations: false,
        });
      if (path === "/api/direct/realtime")
        return json({ error: "LIVE_UNAVAILABLE" }, 503);
      if (path === "/api/direct/list")
        return json({
          conversations: [conversation],
          nextCursor: null,
          unreadConversations: 0,
        });
      if (path === "/api/direct/messages")
        return json({ conversation, messages, hasMore: false, through: 2 });
      if (path === "/api/direct/receipt") return json({ conversation });
      if (
        path === "/api/calendar/list" ||
        path === "/api/calendar/conversation"
      )
        return json({ events, truncated: false });
      if (path === "/api/calendar/detail")
        return json({
          event: events.find((e) => e.id === body.id) ?? events[0],
        });
      if (path === "/api/calendar/respond") {
        const e = events.find((e) => e.id === body.id)!;
        const own = e.participants.find((p) => p.userId === uid)!;
        if (body.response) own.response = body.response as typeof own.response;
        if (typeof body.subscribed === "boolean")
          own.subscribed = body.subscribed;
        else if (body.response === "GOING") own.subscribed = true;
        else if (body.response === "DECLINED") own.subscribed = false;
        return json({ event: e });
      }
      if (path === "/api/calendar/create") {
        const created = {
          ...structuredClone(event),
          ...(body.event as object),
          id: randomUUID(),
          scope: body.scope ?? null,
        } as CalendarEventView;
        events = [...events, created];
        return json({ event: created }, 201);
      }
      if (path === "/api/tabs/detail") return json({ tab });
      if (path === "/api/tabs/list") return json({ tabs: [] });
      if (path === "/api/tabs/context")
        return json({ people: people.slice(0, 2), canManage: true });
      if (path === "/api/profiles/view")
        return json({
          profile: {
            ...people.find((p) => p.id === body.userId),
            bio: "A test profile.",
            avatarRef: null,
          },
        });
      if (path === "/api/security/status") return json({ remainingCodes: 0 });
      if (path === "/api/push/config")
        return json({ available: false, publicKey: null });
      if (path === "/api/people/find")
        return json({
          person: people.find((p) => p.username === body.username) ?? null,
        });
      if (path === "/api/profile/avatar")
        return json({ avatarRef: "/fixture-avatar.jpg" });
      return json({ error: "NOT_FOUND" }, 404);
    }
    if (path === "/component.js")
      return route.fulfill({
        contentType: "text/javascript",
        body: javascript,
      });
    if (path === "/component.css")
      return route.fulfill({ contentType: "text/css", body: styles });
    if (/\.(png|svg|ico)$/.test(path)) {
      const publicRoot = resolve("apps/web/public"),
        file = resolve(publicRoot, "." + decodeURIComponent(path));
      if (file.startsWith(publicRoot + sep)) {
        try {
          return route.fulfill({
            contentType:
              extname(file) === ".svg" ? "image/svg+xml" : "image/png",
            body: await readFile(file),
          });
        } catch {}
      }
      return route.fulfill({ status: 404, body: "" });
    }
    return route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"/><link rel="stylesheet" href="/component.css"/></head><body><div id="root"></div><script src="/component.js"></script></body></html>',
    });
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  const screens = [
    { path: "/profile", wait: "Your identity" },
    { path: "/settings", wait: "Appearance & comfort" },
    { path: "/plans", wait: "New plan" },
    {
      path: `/chats?conversation=${cid}`,
      wait: "Shall we make a plan for tomorrow?",
    },
    { path: "/tabs-preview", wait: "Amsterdam beer" },
    { path: "/profile/edit", wait: "Add a photo" },
    { path: "/login", wait: "Use a recovery code" },
  ];
  for (const theme of ["LIGHT", "DARK"] as const) {
    settings = { ...defaultAppearance, theme };
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const screen of screens) {
        await page.goto("https://merkat.test" + screen.path);
        await page.getByText(screen.wait, { exact: false }).first().waitFor();
        await page.waitForTimeout(100);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        );
        assert.equal(
          overflow,
          false,
          `${screen.path} at ${width} ${theme} overflows`,
        );
        if (screen.path === "/tabs-preview") {
          const clipped = await page
            .locator(".tab-detail")
            .evaluate((el) => el.scrollWidth > el.clientWidth + 1);
          assert.equal(
            clipped,
            false,
            `Tab content clips at ${width} ${theme}`,
          );
        }
        if (screen.path.startsWith("/chats") && theme === "DARK") {
          const panel = await page
            .locator(".direct-messages")
            .evaluate((el) => getComputedStyle(el).backgroundColor);
          assert.notEqual(
            panel,
            "rgb(255, 255, 255)",
            "Dark message panel is white",
          );
        }
        await page.screenshot({
          path: resolve(
            root,
            `${screen.path.split("?")[0]!.replaceAll("/", "-").slice(1)}-${width}-${theme.toLowerCase()}.png`,
          ),
          fullPage: true,
        });
        checks++;
      }
    }
  }
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("https://merkat.test/settings");
  await page.getByText("Appearance & comfort", { exact: true }).waitFor();
  await page.getByLabel("Light", { exact: true }).check();
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === "light",
  );
  await page.getByLabel("Dark", { exact: true }).check();
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === "dark",
  );
  checks++;
  await page.getByLabel("Reduce motion", { exact: false }).check();
  await page.waitForFunction(
    () => document.documentElement.dataset.reduceMotion === "true",
  );
  checks++;
  await page.goto("https://merkat.test/profile/edit");
  await page.getByLabel("Choose profile photo").setInputFiles({
    name: "too-large.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.alloc(2_000_001),
  });
  await page.getByText("Choose a photo of 2 MB or less.").waitFor();
  assert.equal(
    requests.filter((r) => r.path === "/api/profile/avatar").length,
    0,
  );
  checks++;
  await page.goto(`https://merkat.test/chats?conversation=${cid}`);
  await page
    .getByRole("button", { name: "Conversation plans and tabs" })
    .click();
  await page.getByRole("button", { name: "Make a plan", exact: true }).click();
  await page.getByLabel(/What.s the plan/).fill("Browser-tested plan");
  await page.getByLabel("Starts", { exact: true }).fill("2026-11-10T20:30");
  await page.getByLabel("Ends", { exact: true }).fill("2026-11-10T22:30");
  await page.getByRole("button", { name: "Create plan", exact: true }).click();
  await page
    .getByRole("heading", { name: "Browser-tested plan", exact: true })
    .waitFor();
  assert.ok(requests.some((r) => r.path === "/api/calendar/create"));
  checks++;
  await page.goto("https://merkat.test/tabs-preview");
  await page
    .getByRole("button", { name: "Edit my order", exact: true })
    .first()
    .click();
  await page
    .getByRole("heading", { name: "Edit your order", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Cancel edit", exact: true }).click();
  await page
    .getByRole("heading", { name: "Add an order", exact: true })
    .waitFor();
  checks++;
  await page.goto(`https://merkat.test/chats?conversation=${cid}`);
  const profileTrigger = page.getByRole("button", {
    name: "View QA Bob's profile",
    exact: true,
  });
  await profileTrigger.click();
  await page
    .getByRole("dialog", { name: "QA Bob's profile", exact: true })
    .waitFor();
  await page.keyboard.press("Escape");
  assert.equal(
    await profileTrigger.evaluate((el) => el === document.activeElement),
    true,
    "Profile dialog returns keyboard focus",
  );
  checks++;
  assert.deepEqual(errors, [], "Product components emitted browser errors");
  await writeFile(
    resolve(root, "results.json"),
    JSON.stringify(
      {
        checks,
        transport: "Mocked HTTP and test-only Next adapters",
        errors,
        screenshots: 28,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      componentChecks: checks,
      browserErrors: errors.length,
      transport: "Explicit mocked HTTP; not live end-to-end verification",
    }),
  );
  await context.close();
} finally {
  await browser.close();
}
