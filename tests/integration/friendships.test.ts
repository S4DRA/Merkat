import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import {
  AccountService,
  AuthenticationService,
  FriendshipService,
  MessagingService,
  PlanService,
  isFriendshipError,
  isMessagingError,
  isAccountError,
} from "@merkat/backend";
import {
  createDatabase,
  createAccountRepository,
  createAuthenticationLimiter,
  createCredentialRepository,
  createFriendshipRepository,
  createMessagingRepository,
  createPlanRepository,
} from "@merkat/database";
import { createApiHandler } from "../../apps/web/src/lib/server/http-api.js";

if (!process.env.TEST_DATABASE_URL)
  throw new Error("Use the isolated integration runner.");
const db = createDatabase({ DATABASE_URL: process.env.TEST_DATABASE_URL });
const secondDb = createDatabase({
  DATABASE_URL: process.env.TEST_DATABASE_URL,
});
const accounts = new AccountService(createAccountRepository(db));
const authentication = new AuthenticationService(
  createCredentialRepository(db),
  createAuthenticationLimiter(db),
  randomBytes(32).toString("hex"),
);
const friends = new FriendshipService(createFriendshipRepository(db));
const second = new FriendshipService(createFriendshipRepository(secondDb));
const messaging = new MessagingService(createMessagingRepository(db));
const username = () => `f${randomUUID().replaceAll("-", "").slice(0, 20)}`;
const password = "a real friendship test password";
const register = (extra = {}) =>
  authentication.register(
    { username: username(), password, ...extra },
    randomUUID(),
  );
const bad = (code: string) => (error: unknown) =>
  (isFriendshipError(error) ||
    isMessagingError(error) ||
    isAccountError(error)) &&
  error.code === code;
after(async () => {
  await db.$disconnect();
  await secondDb.$disconnect();
});

test("username/password alone registers; optional email is normalized, private and never a login identity", async () => {
  const a = await register();
  assert.equal(a.user.profile.displayName, a.user.profile.username);
  assert.equal(
    (await db.user.findUniqueOrThrow({ where: { id: a.user.id } })).email,
    null,
  );
  const email = `${randomUUID()}@example.test`;
  const b = await register({ email: ` ${email.toUpperCase()} ` });
  assert.equal(
    (await db.user.findUniqueOrThrow({ where: { id: b.user.id } })).email,
    email,
  );
  assert.equal(JSON.stringify(b.user).includes(email), false);
  const person = await new PlanService(
    accounts,
    createPlanRepository(db),
  ).findPerson(a.token, { username: b.user.profile.username });
  assert.deepEqual(Object.keys(person).sort(), [
    "displayName",
    "id",
    "username",
  ]);
  const origin = "https://friends.example.test";
  const handle = createApiHandler(
    () => ({
      accounts,
      plans: new PlanService(accounts, createPlanRepository(db)),
      authentication: () => authentication,
    }),
    () => ({ production: false, appOrigin: origin }),
  );
  for (const value of ["invalid-email", "x".repeat(255) + "@example.test"]) {
    const response = await handle(
      new Request(`${origin}/api/auth/register`, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({ username: username(), password, email: value }),
      }),
      "auth/register",
    );
    // Login/registration ingress is local in this fixture, matching the isolated Next development path.
    assert.equal(response.status, 400);
  }
  const signedIn = await authentication.login(
    { username: b.user.profile.username, password },
    randomUUID(),
  );
  assert.equal(signedIn.user.id, b.user.id);
  await assert.rejects(
    authentication.login({ username: email, password }, randomUUID()),
  );
});

test("real friend request, acceptance, independent lists, removal and retained DM history", async () => {
  const [a, b] = await Promise.all([register(), register()]);
  const requested = await friends.request(a.token, {
    username: b.user.profile.username,
  });
  assert.equal(requested.status, "PENDING");
  assert.equal(requested.requestedById, a.user.id);
  assert.equal(
    (await friends.list(a.token, { section: "FRIENDS" })).people.length,
    0,
  );
  assert.equal(
    (await friends.list(a.token, { section: "OUTGOING" })).people[0]!.id,
    requested.id,
  );
  assert.equal(
    (await friends.list(b.token, { section: "INCOMING" })).incomingCount,
    1,
  );
  await friends.act(b.token, { id: requested.id, action: "ACCEPT" });
  await friends.act(b.token, { id: requested.id, action: "ACCEPT" });
  assert.equal(
    (await friends.list(a.token, { section: "FRIENDS" })).people[0]!.person.id,
    b.user.id,
  );
  assert.equal(
    (await second.list(b.token, { section: "FRIENDS" })).people[0]!.person.id,
    a.user.id,
  );
  const c = await messaging.open(a.token, {
    username: b.user.profile.username,
  });
  const message = await messaging.send(a.token, {
    conversationId: c.id,
    clientId: randomUUID(),
    text: "Friendship removal keeps this conversation",
  });
  await friends.act(a.token, { id: requested.id, action: "REMOVE" });
  assert.equal(
    (await friends.list(b.token, { section: "FRIENDS" })).people.length,
    0,
  );
  assert.equal(
    (await messaging.messages(b.token, { conversationId: c.id })).messages[0]!
      .id,
    message.id,
  );
});

test("opposite-direction concurrent requests stay one pending pair; only the recipient accepts/declines", async () => {
  const [a, b, outsider] = await Promise.all([
    register(),
    register(),
    register(),
  ]);
  const result = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      (i % 2 ? friends : second).request(i % 2 ? a.token : b.token, {
        username: i % 2 ? b.user.profile.username : a.user.profile.username,
      }),
    ),
  );
  assert.equal(new Set(result.map((f) => f.id)).size, 1);
  assert.ok(result.every((f) => f.status === "PENDING"));
  const request = result[0]!;
  const sender = request.requestedById === a.user.id ? a : b;
  const recipient = sender === a ? b : a;
  await assert.rejects(
    friends.act(sender.token, { id: request.id, action: "ACCEPT" }),
    bad("NOT_FOUND"),
  );
  await assert.rejects(
    friends.act(sender.token, { id: request.id, action: "DECLINE" }),
    bad("NOT_FOUND"),
  );
  await assert.rejects(
    friends.act(recipient.token, { id: request.id, action: "CANCEL" }),
    bad("NOT_FOUND"),
  );
  for (const action of ["ACCEPT", "DECLINE", "CANCEL", "REMOVE"])
    await assert.rejects(
      friends.act(outsider.token, { id: request.id, action }),
      bad("NOT_FOUND"),
    );
  await friends.act(recipient.token, { id: request.id, action: "DECLINE" });
  const again = await friends.request(sender.token, {
    username: recipient.user.profile.username,
  });
  await friends.act(sender.token, { id: again.id, action: "CANCEL" });
  await assert.rejects(
    friends.request(sender.token, { username: sender.user.profile.username }),
    bad("SELF_FRIENDSHIP"),
  );
  await accounts.logout(sender.token);
  await assert.rejects(
    friends.list(sender.token, { section: "FRIENDS" }),
    bad("UNAUTHORIZED"),
  );
  await assert.rejects(
    friends.request(sender.token, {
      username: recipient.user.profile.username,
    }),
    bad("UNAUTHORIZED"),
  );
});

test("friendship database integrity, keyset pages and shared request abuse bounds", async () => {
  const a = await register();
  const peers = await Promise.all(
    Array.from({ length: 33 }, () =>
      db.user.create({
        data: {
          onboardingCompletedAt: new Date(),
          profile: {
            create: {
              username: username(),
              displayName: "Friends pagination fixture",
            },
          },
        },
        include: { profile: true },
      }),
    ),
  );
  const date = new Date();
  for (const b of peers.slice(0, 32)) {
    const firstUserId = a.user.id < b.id ? a.user.id : b.id;
    const secondUserId = a.user.id < b.id ? b.id : a.user.id;
    await db.friendship.create({
      data: {
        firstUserId,
        secondUserId,
        requestedById: a.user.id,
        status: "ACCEPTED",
        acceptedAt: date,
        createdAt: date,
      },
    });
  }
  const first = await friends.list(a.token, { section: "FRIENDS" });
  const last = await friends.list(a.token, {
    section: "FRIENDS",
    before: first.nextCursor,
  });
  assert.equal(first.people.length, 30);
  assert.equal(last.people.length, 2);
  assert.equal(last.nextCursor, null);
  assert.equal(
    new Set([...first.people, ...last.people].map((f) => f.id)).size,
    32,
  );
  await assert.rejects(
    db.friendship.create({
      data: {
        firstUserId: a.user.id,
        secondUserId: a.user.id,
        requestedById: a.user.id,
      },
    }),
  );
  await assert.rejects(
    db.friendship.update({
      where: { id: first.people[0]!.id },
      data: { requestedById: peers[32]!.id },
    }),
  );
  const pending = await friends.request(a.token, {
    username: peers[32]!.profile!.username,
  });
  await db.messagingRateLimit.update({
    where: { userId: a.user.id },
    data: { friendCount: 10 },
  });
  assert.equal(
    (await friends.request(a.token, { username: peers[32]!.profile!.username }))
      .id,
    pending.id,
  );
  const fresh = await db.user.create({
    data: {
      onboardingCompletedAt: new Date(),
      profile: {
        create: { username: username(), displayName: "Rate fixture" },
      },
    },
    include: { profile: true },
  });
  await assert.rejects(
    second.request(a.token, { username: fresh.profile!.username }),
    bad("TRY_LATER"),
  );
  const remaining = await Promise.all(
    Array.from({ length: 49 }, () =>
      db.user.create({
        data: {
          onboardingCompletedAt: new Date(),
          profile: {
            create: {
              username: username(),
              displayName: "Pending limit fixture",
            },
          },
        },
      }),
    ),
  );
  await db.friendship.createMany({
    data: remaining.map((peer) => ({
      firstUserId: a.user.id < peer.id ? a.user.id : peer.id,
      secondUserId: a.user.id < peer.id ? peer.id : a.user.id,
      requestedById: a.user.id,
    })),
  });
  await db.messagingRateLimit.update({
    where: { userId: a.user.id },
    data: { friendCount: 0 },
  });
  await assert.rejects(
    friends.request(a.token, { username: fresh.profile!.username }),
    bad("PENDING_LIMIT"),
  );
});
