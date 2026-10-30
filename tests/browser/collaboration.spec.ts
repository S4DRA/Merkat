import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  GroupDetail,
  GroupList,
  CalendarEventView,
  TabView,
} from "@merkat/contracts";

// Real HTTPS ingress -> Next handlers -> isolated PostgreSQL. No HTTP or realtime mocks.
// The local fixture has no hosted Supabase service; explicit reload tests persistence,
// not live Broadcast or device notification delivery.
const origin = "https://127.0.0.1:3100";
async function post<T>(page: Page, path: string, data: unknown): Promise<T> {
  const response = await page.request.post(`/api/${path}`, {
    headers: { origin },
    data,
  });
  expect(response.ok(), `${path}: ${response.status()}`).toBe(true);
  return response.status() === 204 ? (undefined as T) : response.json();
}
test("three authenticated users persist messages, calendar RSVP and a consented tab through real HTTP", async ({
  browser,
}) => {
  const contexts = await Promise.all(
    ["group_owner", "group_member", "group_outsider"].map((name) =>
      browser.newContext({
        baseURL: origin,
        ignoreHTTPSErrors: true,
        storageState: `artifacts/dm-${name}-state.json`,
        viewport: { width: 390, height: 844 },
      }),
    ),
  );
  try {
    const [owner, member, third] = (await Promise.all(
      contexts.map((c) => c.newPage()),
    )) as [Page, Page, Page];
    const users = await Promise.all(
      [owner, member, third].map(async (page) => {
        const response = await page.request.get("/api/account/session");
        expect(response.ok()).toBe(true);
        return (await response.json()).user as {
          id: string;
          profile: { username: string };
        };
      }),
    );
    expect(new Set(users.map((u) => u.id)).size).toBe(3);
    await owner.goto("/profile/edit");
    const png = await readFile(resolve("apps/web/public/icons/merkat-180.png"));
    await owner.getByLabel("Choose profile photo").setInputFiles({
      name: "real-avatar.png",
      mimeType: "image/png",
      buffer: png,
    });
    await expect(
      owner.getByText("Profile photo updated.", { exact: true }),
    ).toBeVisible();
    await owner.reload();
    await expect(owner.locator(".profile-photo img")).toHaveAttribute(
      "src",
      /\/api\/avatars\//,
    );
    await owner.getByLabel("Choose profile photo").setInputFiles({
      name: "oversized.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.alloc(2_000_001),
    });
    await expect(
      owner.getByText("Choose a photo of 2 MB or less.", { exact: true }),
    ).toBeVisible();
    for (const page of [member, third])
      await post(page, "privacy/update", {
        allowNonFriendDms: true,
        groupInvitesFrom: "EVERYONE",
      });
    const group = await post<GroupDetail>(owner, "groups/create", {
      clientId: randomUUID(),
      name: `Acceptance ${randomUUID().slice(0, 8)}`,
      usernames: users.slice(1).map((u) => u.profile.username),
    });
    for (const page of [member, third]) {
      const invitation = (
        await post<GroupList>(page, "groups/list", {})
      ).invitations.find((i) => i.groupId === group.id)!;
      await post(page, "groups/invitation", {
        id: invitation.id,
        action: "ACCEPT",
      });
    }
    const channelId = group.defaultChannelId;
    const texts = users.map((u) => `Real HTTP ${u.id} ${randomUUID()}`);
    await Promise.all(
      [owner, member, third].map((page, i) =>
        post(page, "groups/send", {
          groupId: group.id,
          channelId,
          clientId: randomUUID(),
          text: texts[i],
        }),
      ),
    );
    await member.goto(`/chats?group=${group.id}&channel=${channelId}`);
    for (const text of texts)
      await expect(
        member.locator(".group-message").filter({ hasText: text }),
      ).toBeVisible();
    await member.reload();
    for (const text of texts)
      await expect(
        member.locator(".group-message").filter({ hasText: text }),
      ).toBeVisible();
    const scope = { kind: "GROUP", id: group.id, channelId };
    const start = new Date(Date.now() + 48 * 3600000),
      end = new Date(start.getTime() + 3600000);
    const { event } = await post<{ event: CalendarEventView }>(
      owner,
      "calendar/create",
      {
        clientId: randomUUID(),
        scope,
        event: {
          title: `Shared event ${randomUUID().slice(0, 8)}`,
          description: "Real HTTP acceptance",
          location: "Cafe",
          startsAt: start.toISOString(),
          endsAt: end.toISOString(),
          timezone: "Europe/Istanbul",
        },
      },
    );
    for (const page of [member, third])
      await post(page, "calendar/respond", { id: event.id, response: "GOING" });
    for (const page of [owner, member, third]) {
      const list = await post<{ events: CalendarEventView[] }>(
        page,
        "calendar/list",
        {
          start: new Date(start.getTime() - 86400000).toISOString(),
          end: new Date(end.getTime() + 86400000).toISOString(),
        },
      );
      expect(list.events.some((e) => e.id === event.id)).toBe(true);
    }
    await member.goto(`/plans?event=${event.id}`);
    await expect(
      member.getByRole("heading", { name: event.title, exact: true }),
    ).toBeVisible();
    let { tab } = await post<{ tab: TabView }>(owner, "tabs/create", {
      clientId: randomUUID(),
      title: "Real HTTP tab",
      currency: "TRY",
      scope,
      participantIds: users.map((u) => u.id),
    });
    const act = async (page: Page, action: unknown) => {
      ({ tab } = await post<{ tab: TabView }>(page, "tabs/act", {
        id: tab.id,
        clientId: randomUUID(),
        version: tab.version,
        action,
      }));
    };
    await act(owner, {
      kind: "ORDER",
      name: "A shared bill",
      unitPrice: 10001,
      quantity: 1,
      split: "EQUAL",
      allocations: users.map((u) => ({ userId: u.id })),
    });
    expect(tab.summary.total).toBe(0);
    const orderId = tab.state.orders[0]!.id;
    await act(member, { kind: "ACCEPT_ORDER", orderId, accept: true });
    expect(tab.summary.total).toBe(0);
    await act(third, { kind: "ACCEPT_ORDER", orderId, accept: true });
    expect(tab.summary.total).toBe(10001);
    expect(tab.summary.people.reduce((n, p) => n + p.consumed, 0)).toBe(10001);
    await act(owner, { kind: "PAYMENT", amount: 10001 });
    await act(owner, { kind: "CLOSE", confirm: true });
    const reloaded = await post<{ tab: TabView }>(third, "tabs/detail", {
      id: tab.id,
    });
    expect(reloaded.tab.closedAt).not.toBeNull();
    expect(reloaded.tab.state.snapshot?.total).toBe(10001);
    await third.goto(`/chats?group=${group.id}&channel=${channelId}`);
    await expect(
      third.getByText("Real HTTP tab", { exact: true }),
    ).toBeVisible();
    await post(owner, "calendar/cancel", {
      id: event.id,
      version: event.version,
    });
    expect(
      (
        await post<{ event: CalendarEventView }>(member, "calendar/detail", {
          id: event.id,
        })
      ).event.cancelled,
    ).toBe(true);
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});
