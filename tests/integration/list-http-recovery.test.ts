import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { createServer as createTcpServer } from "node:net";
import {
  AccountService,
  MessagingService,
  GroupService,
  PlanService,
  hashSessionToken,
} from "@merkat/backend";
import {
  createDatabase,
  createAccountRepository,
  createMessagingRepository,
  createGroupRepository,
  createPlanRepository,
} from "@merkat/database";
import { createApiHandler } from "../../apps/web/src/lib/server/http-api.js";

test("real HTTP list endpoints return persisted data, distinguish expired sessions from DB outages, and recover without losing conversations", async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || new URL(url).hostname !== "127.0.0.1")
    throw new Error("Use the owned isolated database runner");
  const db = createDatabase({ DATABASE_URL: url });
  const portReservation = createTcpServer();
  await new Promise<void>((resolve) =>
    portReservation.listen(0, "127.0.0.1", resolve),
  );
  const reserved = portReservation.address();
  if (!reserved || typeof reserved === "string")
    throw new Error("No local port");
  await new Promise<void>((resolve) => portReservation.close(() => resolve()));
  const unavailableUrl = new URL(url);
  unavailableUrl.port = String(reserved.port);
  const unavailable = createDatabase({ DATABASE_URL: unavailableUrl.href });
  const services = (database: typeof db) => {
    const accounts = new AccountService(createAccountRepository(database));
    return {
      accounts,
      messaging: new MessagingService(createMessagingRepository(database)),
      groups: new GroupService(createGroupRepository(database)),
      plans: new PlanService(accounts, createPlanRepository(database)),
    };
  };
  const healthy = services(db),
    outage = services(unavailable);
  let offline = false,
    origin = "";
  const handle = createApiHandler(
    () => (offline ? outage : healthy),
    () => ({ appOrigin: origin, production: false }),
  );
  const server = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const result = await handle(
        new Request(new URL(request.url!, origin), {
          method: request.method!,
          headers: request.headers as Record<string, string>,
          body: Buffer.concat(chunks).toString(),
        }),
        request.url!.replace(/^\/api\//, ""),
      );
      const headers: Record<string, string> = {};
      result.headers.forEach((value, key) => {
        headers[key] = value;
      });
      response.writeHead(result.status, headers);
      response.end(await result.text());
    } catch {
      response.writeHead(500);
      response.end();
    }
  });
  try {
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("No HTTP port");
    origin = `http://127.0.0.1:${address.port}`;
    const register = async () => {
      const account = await healthy.accounts.signIn(
        {
          async verifyCredential() {
            return { issuer: "http-list-test", subject: randomUUID() };
          },
        },
        "isolated fixture",
      );
      await healthy.accounts.saveProfile(account.token, {
        username: `http_${randomUUID().replaceAll("-", "").slice(0, 20)}`,
        displayName: "HTTP test",
        bio: "",
      });
      return account;
    };
    const [a, b] = await Promise.all([register(), register()]);
    const peer = await healthy.accounts.current(b.token);
    const dm = await healthy.messaging.open(a.token, {
      username: peer!.profile.username,
    });
    await healthy.messaging.send(a.token, {
      conversationId: dm.id,
      clientId: randomUUID(),
      text: "Preserved through the outage",
    });
    const group = await healthy.groups.create(a.token, {
      clientId: randomUUID(),
      name: "HTTP recovery group",
      usernames: [],
    });
    await healthy.groups.send(a.token, {
      groupId: group.id,
      channelId: group.defaultChannelId,
      clientId: randomUUID(),
      text: "Group history survives",
    });
    const expired = randomBytes(32).toString("base64url");
    await db.session.create({
      data: {
        userId: a.user.id,
        tokenHash: hashSessionToken(expired),
        createdAt: new Date(Date.now() - 3600000),
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    const request = (endpoint: string, token = a.token) =>
      fetch(`${origin}/api/${endpoint}`, {
        method: "POST",
        headers: {
          origin,
          "content-type": "application/json",
          ...(token ? { cookie: `merkat_session=${token}` } : {}),
        },
        body: "{}",
      });
    for (const endpoint of ["direct/list", "groups/list"]) {
      assert.equal((await request(endpoint, "")).status, 401);
      assert.equal((await request(endpoint, expired)).status, 401);
      assert.equal((await request(endpoint)).status, 200);
    }
    offline = true;
    for (const endpoint of ["direct/list", "groups/list"]) {
      const result = await request(endpoint);
      assert.equal(result.status, 503);
      assert.equal(result.headers.get("cache-control"), "no-store");
      assert.deepEqual(await result.json(), { error: "SERVICE_UNAVAILABLE" });
      assert.equal((await request(endpoint, "")).status, 401);
    }
    offline = false;
    const directs = await request("direct/list");
    assert.equal(directs.status, 200);
    assert.ok(
      (await directs.json()).conversations.some(
        (item: { id: string }) => item.id === dm.id,
      ),
    );
    const groups = await request("groups/list");
    assert.equal(groups.status, 200);
    assert.ok(
      (await groups.json()).groups.some(
        (item: { id: string }) => item.id === group.id,
      ),
    );
    assert.equal(
      (await healthy.messaging.messages(b.token, { conversationId: dm.id }))
        .messages[0]!.text,
      "Preserved through the outage",
    );
    assert.equal(
      (
        await healthy.groups.messages(a.token, {
          groupId: group.id,
          channelId: group.defaultChannelId,
        })
      ).messages[0]!.text,
      "Group history survives",
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.$disconnect();
    await unavailable.$disconnect();
  }
});
