import { test, expect, type BrowserContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { GroupList, CalendarEventView } from "@merkat/contracts";

test("native touch hold-drag selects only the two creation actions and cancellation never navigates", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL: baseURL!,
    ignoreHTTPSErrors: true,
    hasTouch: true,
    viewport: { width: 320, height: 676 },
    storageState: "artifacts/authenticated-state.json",
  });
  try {
    const page = await context.newPage(),
      cdp = await context.newCDPSession(page);
    const button = page.getByRole("button", {
      name: "Create a chat or group",
      exact: true,
    });
    async function hold() {
      const b = (await button.boundingBox())!;
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x: b.x + b.width / 2, y: b.y + b.height / 2, id: 1 }],
      });
      await expect(
        page.getByRole("menu", { name: "Create", exact: true }),
      ).toBeVisible();
    }
    await page.goto("/chats");
    await hold();
    await expect(page.getByRole("menuitem")).toHaveText([
      "New Chat",
      "New Group",
    ]);
    const chat = (await page
      .getByRole("menuitem", { name: "New Chat", exact: true })
      .boundingBox())!;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { x: chat.x + chat.width / 2, y: chat.y + chat.height / 2, id: 1 },
      ],
    });
    await expect(
      page.getByRole("menuitem", { name: "New Chat", exact: true }),
    ).toHaveAttribute("data-targeted", "true");
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect(page).toHaveURL(/\/chats\?new=1$/);
    await expect(
      page.getByRole("dialog", { name: "New chat", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Close new chat", exact: true })
      .click();
    await hold();
    const group = (await page
      .getByRole("menuitem", { name: "New Group", exact: true })
      .boundingBox())!;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { x: group.x + group.width / 2, y: group.y + group.height / 2, id: 1 },
      ],
    });
    await expect(
      page.getByRole("menuitem", { name: "New Group", exact: true }),
    ).toHaveAttribute("data-targeted", "true");
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect(page).toHaveURL(/\/groups\?new=1$/);
    await expect(
      page.getByRole("dialog", { name: "Create group", exact: true }),
    ).toBeVisible();
    await page.goto("/chats");
    await hold();
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchCancel",
      touchPoints: [],
    });
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(page).toHaveURL(/\/chats$/);
    await hold();
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: 5, y: 180, id: 1 }],
    });
    await expect(
      page.locator('[role="menuitem"][data-targeted="true"]'),
    ).toHaveCount(0);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect(page).toHaveURL(/\/chats$/);
    await expect(page.getByRole("menu")).toHaveCount(0);
    await hold();
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        { x: 160, y: 620, id: 1 },
        { x: 20, y: 200, id: 2 },
      ],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(page).toHaveURL(/\/chats$/);
  } finally {
    await context.close();
  }
});

test("creation menu supports tap, mouse, keyboard focus, Escape and reduced motion without clipping", async ({
  page,
}) => {
  await page.setViewportSize({ width: 301, height: 677 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/plans");
  const button = page.getByRole("button", {
    name: "Create a chat or group",
    exact: true,
  });
  await button.click();
  await expect(page).toHaveURL(/\/plans$/);
  const menu = page.getByRole("menu", { name: "Create", exact: true }),
    box = (await menu.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(301);
  expect(
    await menu.evaluate((element) => getComputedStyle(element).animationName),
  ).toBe("none");
  await expect(
    page.getByRole("menuitem", { name: "New Chat", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("menuitem", { name: "New Group", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(button).toBeFocused();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/chats\?new=1$/);
});

test("calendar fits the initial viewport, has one visible page title and floating navigation has no footer layer", async ({
  page,
}) => {
  for (const [width, height] of [
    [301, 677],
    [320, 676],
    [360, 740],
    [390, 844],
    [430, 900],
    [768, 768],
    [1024, 768],
    [1440, 900],
  ]) {
    await page.setViewportSize({ width: width!, height: height! });
    await page.goto("/plans");
    await expect(page.locator(".calendar-grid")).toBeVisible();
    await expect(page.locator(".calendar-day")).toHaveCount(42);
    await expect(
      page.getByText("Updating calendar…", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.locator('.calendar-day[aria-current="date"]'),
    ).toHaveCount(1);
    await expect(page.locator(".brand-header .brand-link")).toHaveText(
      "Calendar",
    );
    await expect(page.locator(".brand-header img")).toHaveCount(0);
    const bounds = await page.evaluate(() => {
      const grid = document
          .querySelector(".calendar-grid")!
          .getBoundingClientRect(),
        nav = document
          .querySelector(".primary-navigation")!
          .getBoundingClientRect(),
        create = document
          .querySelector(".destination--create")!
          .getBoundingClientRect();
      const main = document.querySelector("main")!.getBoundingClientRect(),
        calendar = document.querySelector(".calendar-workspace")!;
      return {
        top: grid.top,
        bottom: grid.bottom,
        limit:
          innerWidth < 768 ? Math.min(main.bottom, create.top) : innerHeight,
        overflow:
          document.documentElement.scrollWidth > innerWidth ||
          calendar.scrollWidth > calendar.clientWidth,
        scrollbar: getComputedStyle(calendar).scrollbarWidth,
        mainBottom: main.bottom,
        navBottom: nav.bottom,
        height: innerHeight,
      };
    });
    expect(bounds.overflow).toBe(false);
    expect(bounds.scrollbar).toBe("none");
    expect(bounds.bottom).toBeLessThanOrEqual(bounds.limit);
    expect(bounds.top).toBeGreaterThanOrEqual(0);
    expect(bounds.navBottom).toBeLessThanOrEqual(height!);
    if (width! < 768) {
      expect(Math.abs(bounds.mainBottom - height!)).toBeLessThanOrEqual(1);
      expect(
        await page
          .locator(".primary-navigation")
          .evaluate((e) => getComputedStyle(e).position),
      ).toBe("fixed");
    }
  }
  await page.setViewportSize({ width: 320, height: 676 });
  for (const route of [
    "plans",
    "settings",
    "profile",
    "friends",
    "groups",
    "chats",
    "search",
  ]) {
    await page.goto(`/${route}`);
    await expect(page.locator("main")).toBeVisible();
    const padding = await page.locator("main").evaluate((element) => {
      const scrollers = Array.from(
        element.querySelectorAll<HTMLElement>(
          ".calendar-workspace,.settings-workspace,.profile-workspace,.friends-list,.direct-list-scroll,.search-workspace",
        ),
      );
      scrollers.forEach((item) => (item.scrollTop = item.scrollHeight));
      return scrollers.map((item) =>
        parseFloat(getComputedStyle(item).paddingBottom),
      );
    });
    expect(padding.length, route).toBeGreaterThan(0);
    expect(
      padding.every((value) => value >= 124),
      route,
    ).toBe(true);
  }
});

test("selected-day sheet creates a persisted personal activity, shows its dot and preserves drafts on close", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/plans");
  const today = page.locator('.calendar-day[aria-current="date"]');
  await today.click();
  const day = page.getByRole("dialog", { name: "Day activities", exact: true });
  await expect(day).toBeVisible();
  await day
    .getByRole("button", { name: "Create Activity", exact: true })
    .click();
  const start = page.getByLabel("Starts", { exact: true });
  const expected = await page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  expect(await start.inputValue()).toMatch(new RegExp(`^${expected}T`));
  const title = `Personal browser activity ${randomUUID().slice(0, 8)}`;
  await page.getByLabel(/What.s the plan/).fill(title);
  await page
    .getByRole("button", { name: "Close calendar details", exact: true })
    .click();
  await page.getByRole("button", { name: "New plan", exact: true }).click();
  await expect(page.getByLabel(/What.s the plan/)).toHaveValue(title);
  await page.getByRole("button", { name: "Create plan", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Close calendar details", exact: true })
    .click();
  await page.reload();
  await expect(
    page.locator('.calendar-day[aria-current="date"] .calendar-dot'),
  ).toHaveCount(1);
  await page.locator('.calendar-day[aria-current="date"]').click();
  await expect(
    page.getByRole("dialog", { name: "Day activities", exact: true }),
  ).toContainText(title);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("real group creation reviews two invitations, retries an avatar failure once, and keeps private membership checks", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(90000);
  const contexts: BrowserContext[] = [];
  try {
    for (const fixture of [
      "authenticated",
      "dm-acceptance_second",
      "dm-acceptance_third",
    ]) {
      contexts.push(
        await browser.newContext({
          baseURL: baseURL!,
          ignoreHTTPSErrors: true,
          storageState: `artifacts/${fixture}-state.json`,
        }),
      );
    }
    const [owner, peer, third] = contexts as [
      BrowserContext,
      BrowserContext,
      BrowserContext,
    ];
    async function post<T>(
      context: BrowserContext,
      endpoint: string,
      data: unknown,
      status = 200,
    ): Promise<T> {
      const response = await context.request.post(`/api/${endpoint}`, {
        headers: { origin: baseURL! },
        data,
      });
      expect(response.status(), endpoint).toBe(status);
      return response.status() === 204 ? (undefined as T) : response.json();
    }
    const names: string[] = [];
    for (const context of [peer, third]) {
      await post(context, "privacy/update", {
        allowNonFriendDms: true,
        groupInvitesFrom: "EVERYONE",
      });
      const session = await context.request.get("/api/auth/session");
      names.push((await session.json()).user.profile.username);
    }
    const page = await owner.newPage();
    await page.goto("/groups?new=1");
    const dialog = page.getByRole("dialog", {
      name: "Create group",
      exact: true,
    });
    const name = `Reviewed group ${randomUUID().slice(0, 8)}`;
    await dialog.getByLabel("Group name", { exact: true }).fill(name);
    for (const username of names) {
      await dialog
        .getByLabel("Search by username", { exact: true })
        .fill(username);
      await dialog
        .getByRole("button", { name: "Find person", exact: true })
        .click();
      await dialog
        .getByRole("button", { name: "Add person", exact: true })
        .click();
    }
    await expect(
      dialog.getByLabel("Selected people").locator("li"),
    ).toHaveCount(2);
    await dialog
      .getByLabel("Group avatar (optional)")
      .setInputFiles(resolve("apps/web/public/icons/merkat-192.png"));
    await dialog
      .getByRole("button", { name: "Review group", exact: true })
      .click();
    await expect(dialog.getByLabel("Review group")).toContainText(
      "2 invitations",
    );
    let creates = 0;
    page.on("request", (request) => {
      if (request.url().endsWith("/api/groups/create")) creates++;
    });
    await page.route("**/api/groups/*/avatar", (route) =>
      route.request().method() === "PUT"
        ? route.abort("connectionrefused")
        : route.continue(),
    );
    await dialog
      .getByRole("button", { name: "Create group", exact: true })
      .click();
    await expect(
      dialog.getByRole("button", { name: "Retry avatar", exact: true }),
    ).toBeVisible();
    await page.unroute("**/api/groups/*/avatar");
    await dialog
      .getByRole("button", { name: "Retry avatar", exact: true })
      .click();
    await expect(page).toHaveURL(/\/chats\?group=/);
    expect(creates).toBe(1);
    const groupId = new URL(page.url()).searchParams.get("group")!;
    const photo = await owner.request.get(`/api/groups/${groupId}/avatar`);
    expect(photo.status()).toBe(200);
    expect(photo.headers()["cache-control"]).toBe("private, no-store");
    expect(photo.headers()["content-type"]).toBe("image/jpeg");
    for (const context of [peer, third]) {
      const pending = await post<GroupList>(context, "groups/list", {});
      expect(pending.groups.some((g) => g.id === groupId)).toBe(false);
      expect(
        (await context.request.get(`/api/groups/${groupId}/avatar`)).status(),
      ).toBe(404);
      const invitation = pending.invitations.find(
        (item) => item.groupId === groupId,
      )!;
      await post(
        context,
        "groups/invitation",
        { id: invitation.id, action: "ACCEPT" },
        204,
      );
      expect(
        (await context.request.get(`/api/groups/${groupId}/avatar`)).status(),
      ).toBe(200);
    }
    const unauthorizedEdit = await peer.request.delete(
      `/api/groups/${groupId}/avatar`,
      { headers: { origin: baseURL! } },
    );
    expect(unauthorizedEdit.status()).toBe(403);
    await page.goto("/plans");
    await page.getByRole("button", { name: "New plan", exact: true }).click();
    await page.getByLabel(/What.s the plan/).fill(`Group activity ${name}`);
    await page.getByLabel("Activity visibility").selectOption("group");
    await page
      .getByLabel("Share with group", { exact: true })
      .selectOption(groupId);
    const created = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/calendar/create") &&
        response.status() === 201,
    );
    await page
      .getByRole("button", { name: "Create plan", exact: true })
      .click();
    const event = (
      (await (await created).json()) as { event: CalendarEventView }
    ).event;
    expect(event.scope?.id).toBe(groupId);
    expect(event.participants).toHaveLength(3);
    expect(event.participants.filter((p) => p.subscribed)).toHaveLength(1);
    const recipient = await peer.newPage();
    await recipient.goto(`/plans?event=${event.id}`);
    await recipient.getByRole("button", { name: "Going", exact: true }).click();
    await expect(
      recipient.getByRole("button", {
        name: "Remove from my calendar",
        exact: true,
      }),
    ).toBeVisible();
    await recipient
      .getByRole("button", { name: "Close calendar details", exact: true })
      .click();
    await recipient.reload();
    const label = await recipient.evaluate(
      (start) => new Date(start).toLocaleDateString([], { dateStyle: "full" }),
      event.startsAt,
    );
    await expect(
      recipient.locator(`.calendar-day[aria-label^="${label},"] .calendar-dot`),
    ).toHaveCount(1);
    await page
      .getByRole("button", { name: "Cancel plan", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Yes, cancel plan", exact: true })
      .click();
    await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
    await recipient.reload();
    await expect(
      recipient.locator(`.calendar-day[aria-label^="${label},"] .calendar-dot`),
    ).toHaveCount(0);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
