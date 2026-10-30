import { test, expect, type BrowserContext } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import type {
  Account,
  DirectConversationView,
  DirectMessageView,
  GroupDetail,
  GroupList,
  GroupMessageView,
  MessagePage,
  ConversationList,
} from "@merkat/contracts";

test("real three-user HTTP: lists, persisted messages and network-fault Retry recovery (no mocked responses)", async ({
  browser,
  baseURL,
}) => {
  const origin = baseURL!;
  const local = !!process.env.MERKAT_ACCEPTANCE_ORIGIN;
  const localFixtures = local && process.env.MERKAT_ACCEPTANCE_FIXTURES === "1";
  const contexts: BrowserContext[] = [];
  const users: Account[] = [];
  async function post<T>(
    context: BrowserContext,
    endpoint: string,
    data: unknown,
    status = 200,
  ): Promise<T> {
    const response = await context.request.post(`${origin}/api/${endpoint}`, {
      headers: { origin },
      data,
    });
    expect(response.status(), endpoint).toBe(status);
    return response.json() as Promise<T>;
  }
  try {
    for (const name of ["first", "second", "third"]) {
      const context = await browser.newContext({
        baseURL: origin,
        ignoreHTTPSErrors: true,
        storageState: localFixtures
          ? `artifacts/local-acceptance/fixture-${name}.json`
          : local
            ? { cookies: [], origins: [] }
            : `artifacts/dm-acceptance_${name}-state.json`,
      });
      contexts.push(context);
      if (local && !localFixtures)
        await post(
          context,
          "auth/register",
          {
            username: `qa_${randomUUID().replaceAll("-", "").slice(0, 20)}`,
            password: randomBytes(24).toString("hex"),
          },
          201,
        );
      const response = await context.request.get(`${origin}/api/auth/session`);
      expect(response.status()).toBe(200);
      users.push(((await response.json()) as { user: Account }).user);
      await post(context, "direct/list", {});
      await post(context, "groups/list", {});
    }
    const [a, b, c] = contexts as [
      BrowserContext,
      BrowserContext,
      BrowserContext,
    ];
    const { conversation: dm } = await post<{
      conversation: DirectConversationView;
    }>(a, "direct/open", { username: users[1]!.profile.username });
    expect(
      (
        await post<{ conversation: DirectConversationView }>(b, "direct/open", {
          username: users[0]!.profile.username,
        })
      ).conversation.id,
    ).toBe(dm.id);
    const texts = [`Local DM A ${randomUUID()}`, `Local DM B ${randomUUID()}`];
    const firstSend = {
      conversationId: dm.id,
      clientId: randomUUID(),
      text: texts[0],
    };
    const sent = await post<{ message: DirectMessageView }>(
      a,
      "direct/send",
      firstSend,
    );
    expect(
      (await post<{ message: DirectMessageView }>(a, "direct/send", firstSend))
        .message.id,
    ).toBe(sent.message.id);
    await post(b, "direct/send", {
      conversationId: dm.id,
      clientId: randomUUID(),
      text: texts[1],
    });
    for (const context of [a, b]) {
      expect(
        (
          await post<MessagePage>(context, "direct/messages", {
            conversationId: dm.id,
          })
        ).messages.map((m) => m.text),
      ).toEqual(texts);
      expect(
        (
          await post<ConversationList>(context, "direct/list", {})
        ).conversations.some((item) => item.id === dm.id),
      ).toBe(true);
    }
    for (const context of [b, c])
      await post(context, "privacy/update", {
        allowNonFriendDms: true,
        groupInvitesFrom: "EVERYONE",
      });
    const name = `Local group ${randomUUID().slice(0, 8)}`;
    const group = await post<GroupDetail>(
      a,
      "groups/create",
      {
        clientId: randomUUID(),
        name,
        usernames: [users[1]!.profile.username, users[2]!.profile.username],
      },
      201,
    );
    for (const context of [b, c]) {
      const list = await post<GroupList>(context, "groups/list", {});
      expect(list.groups.some((item) => item.id === group.id)).toBe(false);
      expect(list.invitations.some((item) => item.groupId === group.id)).toBe(
        true,
      );
      const page = await context.newPage();
      await page.goto("/groups");
      await page
        .locator(".group-invitation")
        .filter({ hasText: name })
        .getByRole("button", { name: "Join group", exact: true })
        .click();
      await expect(
        page.getByRole("link").filter({ hasText: name }),
      ).toBeVisible();
    }
    const groupTexts = contexts.map(
      (_, index) => `Local group ${index} ${randomUUID()}`,
    );
    for (let index = 0; index < contexts.length; index++)
      await post(
        contexts[index]!,
        "groups/send",
        {
          groupId: group.id,
          channelId: group.defaultChannelId,
          clientId: randomUUID(),
          text: groupTexts[index],
        },
        201,
      );
    for (const context of contexts) {
      const list = await post<GroupList>(context, "groups/list", {});
      expect(list.groups.some((item) => item.id === group.id)).toBe(true);
      const detail = await post<GroupDetail>(context, "groups/detail", {
        groupId: group.id,
      });
      expect(detail.members).toHaveLength(3);
      const history = await post<{ messages: GroupMessageView[] }>(
        context,
        "groups/messages",
        { groupId: group.id, channelId: group.defaultChannelId },
      );
      expect(history.messages.map((m) => m.text)).toEqual(groupTexts);
    }
    const ownerPage = await a.newPage();
    await ownerPage.goto("/chats");
    await expect(
      ownerPage.getByRole("link").filter({ hasText: name }),
    ).toBeVisible();
    await ownerPage.reload();
    await expect(
      ownerPage.getByRole("link").filter({ hasText: name }),
    ).toBeVisible();
    await ownerPage.goto(`/chats?conversation=${dm.id}`);
    for (const text of texts)
      await expect(
        ownerPage.locator(".direct-message").getByText(text, { exact: true }),
      ).toBeVisible();
    await ownerPage.reload();
    for (const text of texts)
      await expect(
        ownerPage.locator(".direct-message").getByText(text, { exact: true }),
      ).toBeVisible();
    const draft = `Unsent local draft ${randomUUID()}`;
    await ownerPage.getByLabel("Message", { exact: true }).fill(draft);
    await ownerPage.route("**/api/direct/list", (route) =>
      route.abort("connectionrefused"),
    );
    await ownerPage.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(
      ownerPage.getByRole("button", { name: "Retry connection", exact: true }),
    ).toBeVisible();
    await expect(ownerPage.getByLabel("Message", { exact: true })).toHaveValue(
      draft,
    );
    await ownerPage.unroute("**/api/direct/list");
    await ownerPage
      .getByRole("button", { name: "Retry connection", exact: true })
      .click();
    await expect(
      ownerPage.getByRole("button", { name: "Retry connection", exact: true }),
    ).toHaveCount(0);
    await expect(ownerPage.getByLabel("Message", { exact: true })).toHaveValue(
      draft,
    );
    const inbox = await a.newPage();
    await inbox.route("**/api/groups/list", (route) =>
      route.abort("connectionrefused"),
    );
    await inbox.goto("/chats");
    await expect(
      inbox.getByRole("button", { name: "Retry groups", exact: true }),
    ).toBeVisible();
    await inbox.unroute("**/api/groups/list");
    await inbox
      .getByRole("button", { name: "Retry groups", exact: true })
      .click();
    await expect(
      inbox.getByRole("link").filter({ hasText: name }),
    ).toBeVisible();
    await expect(
      inbox.getByRole("button", { name: "Retry groups", exact: true }),
    ).toHaveCount(0);
    const signedOut = await browser.newContext({
      baseURL: origin,
      ignoreHTTPSErrors: true,
      storageState: { cookies: [], origins: [] },
    });
    try {
      for (const endpoint of ["direct/list", "groups/list"])
        expect(
          (
            await signedOut.request.post(`/api/${endpoint}`, {
              headers: { origin },
              data: {},
            })
          ).status(),
        ).toBe(401);
    } finally {
      await signedOut.close();
    }
    if (local) {
      await mkdir("artifacts/local-acceptance", { recursive: true });
      for (let index = 0; index < contexts.length; index++)
        await contexts[index]!.storageState({
          path: `artifacts/local-acceptance/user-${index}.json`,
        });
      await writeFile(
        "artifacts/local-acceptance/journey.json",
        JSON.stringify({
          origin,
          dmId: dm.id,
          groupId: group.id,
          channelId: group.defaultChannelId,
          dmTexts: texts,
          groupTexts,
        }),
        { mode: 0o600 },
      );
    }
    console.log(
      JSON.stringify({
        source:
          "Real authenticated HTTP + PostgreSQL; no mocked HTTP or socket notifications",
        users: 3,
        directLists: 200,
        groupLists: 200,
        dmMessages: 2,
        groupMessages: 3,
        members: 3,
        anonymousLists: 401,
        persistedAfterPageReload: true,
      }),
    );
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
