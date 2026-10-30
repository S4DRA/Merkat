import assert from "node:assert/strict";
import { after, test } from "node:test";
import {
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  verify,
} from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import {
  AccountService,
  AuthenticationService,
  MessagingService,
  PlanService,
  FriendshipService,
  isMessagingError,
  isAccountError,
  hashSessionToken,
} from "@merkat/backend";
import {
  createDatabase,
  createAccountRepository,
  createAuthenticationLimiter,
  createCredentialRepository,
  createMessagingRepository,
  createPlanRepository,
  createFriendshipRepository,
} from "@merkat/database";
import { createApiHandler } from "../../apps/web/src/lib/server/http-api.js";
import {
  issueRealtimeCapability,
  realtimeConfigured,
} from "../../apps/web/src/lib/server/realtime-capability.js";
import {
  mergeMessages,
  reconcileMessages,
} from "../../apps/web/src/lib/direct-client.js";
import type { DirectMessageView } from "@merkat/contracts";

if (!process.env.TEST_DATABASE_URL) throw new Error("Use the isolated runner.");
const db = createDatabase({ DATABASE_URL: process.env.TEST_DATABASE_URL });
const other = createDatabase({ DATABASE_URL: process.env.TEST_DATABASE_URL });
const accounts = new AccountService(createAccountRepository(db));
const auth = new AuthenticationService(
  createCredentialRepository(db),
  createAuthenticationLimiter(db),
  randomBytes(32).toString("hex"),
);
const messaging = new MessagingService(createMessagingRepository(db));
const second = new MessagingService(createMessagingRepository(other));
const bad = (code: string) => (error: unknown) =>
  (isMessagingError(error) || isAccountError(error)) && error.code === code;
const register = () =>
  auth.register(
    {
      username: `d${randomUUID().replaceAll("-", "").slice(0, 20)}`,
      displayName: "DM Test",
      password: "test direct messaging password",
    },
    randomUUID(),
  );
const send = (
  token: string,
  conversationId: string,
  text: string = randomUUID(),
  clientId: string = randomUUID(),
) => messaging.send(token, { conversationId, text, clientId });
async function pair() {
  const [a, b] = await Promise.all([register(), register()]);
  const c = await messaging.open(a.token, {
    username: b.user.profile.username,
  });
  return { a, b, c };
}
after(async () => {
  await db.$disconnect();
  await other.$disconnect();
});

test("two real password accounts exchange persisted messages; discovery remains minimal", async () => {
  const { a, b, c } = await pair();
  const plans = new PlanService(accounts, createPlanRepository(db));
  const person = await plans.findPerson(a.token, {
    username: ` ${b.user.profile.username!.toUpperCase()} `,
  });
  assert.deepEqual(Object.keys(person).sort(), [
    "displayName",
    "id",
    "username",
  ]);
  const one = await send(a.token, c.id, "hello <script>literal text</script>");
  const two = await send(b.token, c.id, "hello back");
  assert.equal(one.senderId, a.user.id);
  assert.equal(two.senderId, b.user.id);
  const persisted = await second.messages(b.token, { conversationId: c.id });
  assert.deepEqual(
    persisted.messages.map((m) => m.id),
    [one.id, two.id],
  );
  assert.equal(
    persisted.messages[0]!.text,
    "hello <script>literal text</script>",
  );
  assert.match(one.createdAt, /Z$/);
  assert.equal(
    (await messaging.list(a.token, {})).conversations[0]!.latestMessage!.id,
    two.id,
  );
});

test("opposite-direction concurrent creation yields one canonical pair with exactly two members", async () => {
  const [a, b] = await Promise.all([register(), register()]);
  const results = await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      (i % 2 ? messaging : second).open(i % 2 ? a.token : b.token, {
        username: i % 2 ? b.user.profile.username : a.user.profile.username,
      }),
    ),
  );
  assert.equal(new Set(results.map((c) => c.id)).size, 1);
  assert.equal(
    await db.directParticipant.count({
      where: { conversationId: results[0]!.id },
    }),
    2,
  );
  await assert.rejects(
    messaging.open(a.token, { username: a.user.profile.username }),
    bad("SELF_CONVERSATION"),
  );
  await assert.rejects(
    messaging.open(a.token, { username: "missing_person_test" }),
    bad("NOT_FOUND"),
  );
});

test("database rejects self/reversed pairs, third/missing members, reassignment and foreign senders", async () => {
  const { a, b, c } = await pair();
  const outsider = await register();
  await assert.rejects(
    db.directConversation.create({
      data: { firstUserId: a.user.id, secondUserId: a.user.id },
    }),
  );
  const [low, high] = [a.user.id, b.user.id].sort();
  await assert.rejects(
    db.directConversation.create({
      data: { firstUserId: high!, secondUserId: low! },
    }),
  );
  await assert.rejects(
    db.directParticipant.create({
      data: { conversationId: c.id, userId: outsider.user.id },
    }),
  );
  await assert.rejects(
    db.directParticipant.delete({
      where: {
        conversationId_userId: { conversationId: c.id, userId: b.user.id },
      },
    }),
  );
  await assert.rejects(
    db.directConversation.update({
      where: { id: c.id },
      data: { secondUserId: outsider.user.id },
    }),
  );
  await assert.rejects(
    db.directMessage.create({
      data: {
        conversationId: c.id,
        senderId: outsider.user.id,
        sequence: 1,
        clientId: randomUUID(),
        text: "forbidden",
      },
    }),
  );
  assert.equal(
    await db.directParticipant.count({ where: { conversationId: c.id } }),
    2,
  );
});

test("every conversation operation denies outsiders and incomplete, expired, revoked or suspended sessions", async () => {
  const { a, b, c } = await pair();
  const outsider = await register();
  await send(a.token, c.id);
  for (const id of [c.id, randomUUID()]) {
    await assert.rejects(
      messaging.messages(outsider.token, { conversationId: id }),
      bad("NOT_FOUND"),
    );
    await assert.rejects(send(outsider.token, id), bad("NOT_FOUND"));
    await assert.rejects(
      messaging.receipt(outsider.token, {
        conversationId: id,
        deliveredSequence: 1,
        readSequence: 1,
      }),
      bad("NOT_FOUND"),
    );
  }
  assert.equal(
    (await messaging.list(outsider.token, {})).conversations.length,
    0,
  );
  await accounts.logout(a.token);
  await assert.rejects(send(a.token, c.id), bad("UNAUTHORIZED"));
  await assert.rejects(
    messaging.messages(a.token, { conversationId: c.id }),
    bad("UNAUTHORIZED"),
  );
  await assert.rejects(messaging.realtimeSession(a.token), bad("UNAUTHORIZED"));
  await db.session.update({
    where: { tokenHash: hashSessionToken(b.token) },
    data: {
      createdAt: new Date(Date.now() - 2000),
      expiresAt: new Date(Date.now() - 1000),
    },
  });
  await assert.rejects(messaging.list(b.token, {}), bad("UNAUTHORIZED"));
  await db.user.update({
    where: { id: outsider.user.id },
    data: { onboardingCompletedAt: null },
  });
  await assert.rejects(
    messaging.open(outsider.token, { username: b.user.profile.username }),
    bad("UNAUTHORIZED"),
  );
  await db.user.update({
    where: { id: outsider.user.id },
    data: { onboardingCompletedAt: new Date(), status: "SUSPENDED" },
  });
  await assert.rejects(
    messaging.realtimeSession(outsider.token),
    bad("UNAUTHORIZED"),
  );
});

test("concurrent sends allocate stable sequences and same-ID retries do not duplicate or consume quota", async () => {
  const { a, b, c } = await pair();
  const clientId = randomUUID();
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      (i % 2 ? messaging : second).send(a.token, {
        conversationId: c.id,
        clientId,
        text: "one logical send",
      }),
    ),
  );
  assert.equal(new Set(results.map((m) => m.id)).size, 1);
  assert.equal(
    (
      await db.messagingRateLimit.findUniqueOrThrow({
        where: { userId: a.user.id },
      })
    ).sentCount,
    1,
  );
  await assert.rejects(
    send(a.token, c.id, "different content", clientId),
    bad("SUBMISSION_CONFLICT"),
  );
  const many = await Promise.all(
    Array.from({ length: 16 }, (_, i) =>
      send(i % 2 ? a.token : b.token, c.id, `concurrent ${i}`),
    ),
  );
  assert.deepEqual(
    many.map((m) => m.sequence).sort((x, y) => x - y),
    Array.from({ length: 16 }, (_, i) => i + 2),
  );
  const page = await messaging.messages(b.token, { conversationId: c.id });
  assert.deepEqual(
    page.messages.map((m) => m.sequence),
    Array.from({ length: 17 }, (_, i) => i + 1),
  );
});

test("keyset history survives interleaved writes and reconnect drains a fixed boundary without duplicates", async () => {
  const { a, b, c } = await pair();
  for (let i = 1; i <= 55; i++) await send(a.token, c.id, `history ${i}`);
  const latest = await messaging.messages(b.token, { conversationId: c.id });
  assert.deepEqual(
    latest.messages.map((m) => m.sequence),
    Array.from({ length: 40 }, (_, i) => i + 16),
  );
  assert.equal(latest.hasMore, true);
  await send(b.token, c.id, "arrives during pagination");
  const older = await messaging.messages(b.token, {
    conversationId: c.id,
    before: latest.messages[0]!.sequence,
  });
  assert.deepEqual(
    older.messages.map((m) => m.sequence),
    Array.from({ length: 15 }, (_, i) => i + 1),
  );
  assert.equal(older.hasMore, false);
  const first = (
    await messaging.messages(b.token, {
      conversationId: c.id,
      after: 0,
      through: 5,
    })
  ).messages;
  // A successful own send can already be rendered beyond a missed range. Its ID must not move the synchronization cursor.
  const own = await send(b.token, c.id, "own response while reconnecting");
  let reconciled: DirectMessageView[] = [];
  const pages: number[] = [];
  await reconcileMessages(
    [...first, own],
    async (after, through) => {
      pages.push(after);
      return messaging.messages(b.token, {
        conversationId: c.id,
        after,
        ...(through === undefined ? {} : { through }),
      });
    },
    (_page, messages) => {
      reconciled = messages;
    },
    5,
  );
  assert.deepEqual(pages, [5, 45]);
  assert.deepEqual(
    reconciled.map((m) => m.sequence),
    Array.from({ length: 57 }, (_, i) => i + 1),
  );
  assert.equal(mergeMessages(reconciled, reconciled).length, 57);
  assert.equal(
    (
      await messaging.messages(b.token, {
        conversationId: c.id,
        after: 5,
        through: 45,
      })
    ).messages.at(-1)!.sequence,
    45,
  );
});

test("delivery/read cursors are monotonic, bounded and exclude own messages from unread counts", async () => {
  const { a, b, c } = await pair();
  await send(a.token, c.id);
  await send(a.token, c.id);
  await send(b.token, c.id);
  assert.equal((await messaging.list(b.token, {})).unreadConversations, 1);
  let receipt = await messaging.receipt(b.token, {
    conversationId: c.id,
    deliveredSequence: 3,
    readSequence: 1,
  });
  assert.equal(receipt.unreadCount, 1);
  receipt = await messaging.receipt(b.token, {
    conversationId: c.id,
    deliveredSequence: 1,
    readSequence: 0,
  });
  assert.equal(receipt.deliveredSequence, 3);
  assert.equal(receipt.readSequence, 1);
  await assert.rejects(
    messaging.receipt(b.token, { conversationId: c.id, deliveredSequence: 99 }),
    bad("INVALID_REQUEST"),
  );
  await assert.rejects(
    messaging.receipt(b.token, {
      conversationId: c.id,
      deliveredSequence: 1,
      readSequence: 2,
    }),
    bad("INVALID_REQUEST"),
  );
  await messaging.receipt(b.token, {
    conversationId: c.id,
    deliveredSequence: 3,
    readSequence: 3,
  });
  assert.equal((await messaging.list(b.token, {})).unreadConversations, 0);
  const owner = (await messaging.messages(a.token, { conversationId: c.id }))
    .conversation;
  assert.equal(owner.peerReadSequence, 3);
  assert.equal(owner.unreadCount, 1);
  await assert.rejects(
    db.directParticipant.update({
      where: {
        conversationId_userId: { conversationId: c.id, userId: b.user.id },
      },
      data: { readSequence: 0 },
    }),
  );
});

test("shared submission quota is bounded across instances; idempotent retry still succeeds at the limit", async () => {
  const { a, c } = await pair();
  const message = await send(a.token, c.id, "retryable");
  await db.messagingRateLimit.update({
    where: { userId: a.user.id },
    data: { sentCount: 59 },
  });
  const results = await Promise.allSettled([
    send(a.token, c.id),
    second.send(a.token, {
      conversationId: c.id,
      clientId: randomUUID(),
      text: "other instance",
    }),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    results.filter((r) => r.status === "rejected" && bad("TRY_LATER")(r.reason))
      .length,
    1,
  );
  assert.equal(
    (await send(a.token, c.id, message.text, message.clientId)).id,
    message.id,
  );
  await db.messagingRateLimit.update({
    where: { userId: a.user.id },
    data: { windowStartedAt: new Date(Date.now() - 61000) },
  });
  await send(a.token, c.id);
  assert.equal(
    (
      await db.messagingRateLimit.findUniqueOrThrow({
        where: { userId: a.user.id },
      })
    ).sentCount,
    1,
  );
});

test("strict inputs, real HTTP authorization, origin, size, status and no-store behavior", async () => {
  const { a, c } = await pair();
  const origin = "https://messaging.example.test";
  const handle = createApiHandler(
    () => ({
      accounts,
      plans: new PlanService(accounts, createPlanRepository(db)),
      messaging,
    }),
    () => ({ appOrigin: origin, production: true }),
  );
  const request = (
    endpoint: string,
    body: unknown,
    token = a.token,
    requestOrigin = origin,
  ) =>
    handle(
      new Request(`${origin}/api/${endpoint}`, {
        method: "POST",
        headers: {
          origin: requestOrigin,
          cookie: `__Host-merkat_session=${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      }),
      endpoint,
    );
  assert.equal(
    (
      await request("direct/send", {
        conversationId: c.id,
        clientId: randomUUID(),
        text: "forged",
        senderId: a.user.id,
      })
    ).status,
    400,
  );
  for (const text of ["", " ", "x".repeat(4001), "bad\u0000text"])
    await assert.rejects(send(a.token, c.id, text), bad("INVALID_REQUEST"));
  assert.equal(
    (await request("direct/send", { text: "x".repeat(25000) })).status,
    413,
  );
  assert.equal(
    (await request("direct/list", {}, a.token, "https://attacker.example.test"))
      .status,
    403,
  );
  assert.equal((await request("direct/list", {}, "")).status, 401);
  const listed = await request("direct/list", {});
  assert.equal(listed.status, 200);
  assert.equal(listed.headers.get("Cache-Control"), "no-store");
  assert.equal((await request("direct/realtime", {})).status, 503);
  assert.equal(
    (await request("direct/realtime", {}, "a".repeat(43))).status,
    401,
  );
});

test("Realtime capability is ES256, purpose/session bound, short lived and contains no privileged material", async () => {
  const { a } = await pair();
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const jwk = { ...privateKey.export({ format: "jwk" }), kid: randomUUID() };
  const env = {
    SUPABASE_REALTIME_URL: "https://staging.example.test",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
    MERKAT_REALTIME_SIGNING_JWK: JSON.stringify(jwk),
  };
  assert.equal(realtimeConfigured(env), true);
  assert.equal(realtimeConfigured({}), false);
  assert.equal(
    realtimeConfigured({
      ...env,
      SUPABASE_PUBLISHABLE_KEY: "sb_secret_forbidden",
    }),
    false,
  );
  const now = Date.now();
  const capability = await issueRealtimeCapability(
    messaging,
    a.token,
    env,
    now,
  );
  const [header, payload, signature] = capability.token.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(header!, "base64url").toString()), {
    alg: "ES256",
    kid: jwk.kid,
    typ: "JWT",
  });
  const claims = JSON.parse(Buffer.from(payload!, "base64url").toString());
  assert.equal(claims.sub, a.user.id);
  assert.equal(claims.role, "authenticated");
  assert.equal(claims.merkat_purpose, "realtime");
  assert.equal(claims.exp - claims.iat, 90);
  assert.equal(
    claims.merkat_session_id,
    (await messaging.realtimeSession(a.token)).sessionId,
  );
  assert.equal(
    verify(
      "sha256",
      Buffer.from(`${header}.${payload}`),
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      Buffer.from(signature!, "base64url"),
    ),
    true,
  );
  assert.equal(JSON.stringify(capability).includes(a.token), false);
  assert.equal(JSON.stringify(capability).includes(jwk.d!), false);
  await db.session.update({
    where: { tokenHash: hashSessionToken(a.token) },
    data: { expiresAt: new Date(now + 40000) },
  });
  const timing = await db.$queryRaw<
    { delta: number }[]
  >`SELECT EXTRACT(EPOCH FROM ("expiresAt" - clock_timestamp()))::float8 AS delta FROM public."Session" WHERE "tokenHash" = ${hashSessionToken(a.token)}`;
  assert.ok(
    timing[0]!.delta > 0,
    `Short expiry must be in future; DB delta=${timing[0]!.delta}`,
  );
  assert.equal(
    (await issueRealtimeCapability(messaging, a.token, env, now)).expiresAt,
    Math.floor((now + 40000) / 1000),
  );
  await accounts.logout(a.token);
  await assert.rejects(
    issueRealtimeCapability(messaging, a.token, env),
    bad("UNAUTHORIZED"),
  );
});

test("conversation pages preserve same-time ordering, latest activity and creation limits; deleting an account cascades", async () => {
  const a = await register();
  const peers = await Promise.all(
    Array.from({ length: 32 }, () =>
      db.user.create({
        data: {
          onboardingCompletedAt: new Date(),
          profile: {
            create: {
              username: `f${randomUUID().replaceAll("-", "").slice(0, 20)}`,
              displayName: "Pagination fixture",
            },
          },
        },
      }),
    ),
  );
  const sameTime = new Date();
  for (const peer of peers) {
    const firstUserId = a.user.id < peer.id ? a.user.id : peer.id;
    const secondUserId = a.user.id < peer.id ? peer.id : a.user.id;
    await db.directConversation.create({
      data: { firstUserId, secondUserId, activityAt: sameTime },
    });
  }
  const first = await messaging.list(a.token, {});
  assert.equal(first.conversations.length, 30);
  assert.ok(first.nextCursor);
  const last = await messaging.list(a.token, { before: first.nextCursor });
  assert.equal(last.conversations.length, 2);
  assert.equal(last.nextCursor, null);
  assert.equal(
    new Set([...first.conversations, ...last.conversations].map((c) => c.id))
      .size,
    32,
  );
  const target = last.conversations[1]!;
  await send(a.token, target.id, "latest activity");
  assert.equal(
    (await messaging.list(a.token, {})).conversations[0]!.id,
    target.id,
  );
  await db.messagingRateLimit.update({
    where: { userId: a.user.id },
    data: { startedCount: 10 },
  });
  const fresh = await register();
  await assert.rejects(
    messaging.open(a.token, { username: fresh.user.profile.username }),
    bad("TRY_LATER"),
  );
  assert.equal(
    (await messaging.open(a.token, { username: target.peer.username })).id,
    target.id,
  );
  await db.user.delete({ where: { id: a.user.id } });
  assert.equal(
    await db.directConversation.count({ where: { id: target.id } }),
    0,
  );
  assert.equal(
    await db.directParticipant.count({ where: { conversationId: target.id } }),
    0,
  );
  assert.equal(
    await db.directMessage.count({ where: { conversationId: target.id } }),
    0,
  );
});

test("reviewed migration matches Prisma and UTC timestamps round-trip against the database clock", async () => {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      resolve("node_modules/prisma/build/index.js"),
      "migrate",
      "diff",
      "--from-config-datasource",
      "--to-schema",
      "prisma/schema.prisma",
      "--script",
    ],
    {
      cwd: resolve("packages/database"),
      env: {
        ...process.env,
        DATABASE_URL: process.env.TEST_DATABASE_URL,
        DIRECT_URL: process.env.TEST_DATABASE_URL,
      },
    },
  );
  // Prisma doesn't model the historical functional username index; preserve it.
  const substantive = stdout
    .replace(/--[^\n]*/g, "")
    .replace(/DROP INDEX[^;]*Profile_username_lower_key[^;]*;/g, "")
    .trim();
  assert.equal(substantive, "", `Unexpected Prisma schema drift: ${stdout}`);
  const clock = await db.$queryRaw<
    { now: Date; zone: string }[]
  >`SELECT clock_timestamp() AS now, current_setting('TimeZone') AS zone`;
  assert.equal(clock[0]!.zone, "UTC");
  assert.ok(Math.abs(clock[0]!.now.getTime() - Date.now()) < 2000);
});

test("Realtime SQL policies deny wrong subjects, sessions, purpose, topics, Presence and publishing; triggers notify only participants", async () => {
  // Contract fixture ONLY: real PostgreSQL role/RLS tests, not a hosted Realtime verification.
  const client = new Client({
    connectionString: process.env.TEST_DATABASE_URL,
  });
  await client.connect();
  const sql = await readFile(
    new URL("../../infra/supabase/realtime.sql", import.meta.url),
    "utf8",
  );
  // Prisma's PostgreSQL adapter supports one statement per call; use the underlying pg driver for this reviewed script.
  try {
    await client.query(
      "CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE SCHEMA realtime; CREATE TABLE realtime.messages (extension text, payload jsonb, topic text, private boolean); ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY; GRANT USAGE ON SCHEMA realtime TO anon, authenticated; GRANT SELECT, INSERT ON realtime.messages TO anon, authenticated;",
    );
    await client.query(
      "CREATE FUNCTION realtime.topic() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('realtime.topic', true) $$; CREATE FUNCTION realtime.send(payload jsonb, event text, topic text, private boolean) RETURNS void LANGUAGE sql AS $$ INSERT INTO realtime.messages VALUES ('broadcast', payload, topic, private) $$;",
    );
    await client.query(sql);
    await client.query(sql); // Reapplying the reviewed setup must remain safe.
  } finally {
    await client.end();
  }
  const { a, b, c } = await pair();
  const outsider = await register();
  await db.$executeRawUnsafe("TRUNCATE realtime.messages");
  await send(a.token, c.id, "secret content is not broadcast");
  const friendService = new FriendshipService(createFriendshipRepository(db));
  const friendship = await friendService.request(a.token, {
    username: b.user.profile.username,
  });
  await friendService.act(b.token, { id: friendship.id, action: "ACCEPT" });
  const broadcasts = await db.$queryRawUnsafe<
    { payload: unknown; topic: string; private: boolean }[]
  >("SELECT payload, topic, private FROM realtime.messages");
  assert.deepEqual(
    new Set(broadcasts.map((row) => row.topic)),
    new Set([`merkat:user:${a.user.id}`, `merkat:user:${b.user.id}`]),
  );
  assert.ok(
    broadcasts.every(
      (row) => row.private && JSON.stringify(row.payload) === "{}",
    ),
  );
  const session = await messaging.realtimeSession(a.token);
  const claims = {
    sub: a.user.id,
    role: "authenticated",
    merkat_purpose: "realtime",
    merkat_session_id: session.sessionId,
  };
  async function visible(
    value: unknown,
    topic = `merkat:user:${a.user.id}`,
    extension = "broadcast",
  ) {
    return db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL ROLE authenticated");
      await tx.$queryRaw`SELECT set_config('request.jwt.claims', ${JSON.stringify(value)}, true), set_config('realtime.topic', ${topic}, true)`;
      return tx.$queryRaw<
        { topic: string }[]
      >`SELECT topic FROM realtime.messages WHERE extension = ${extension}`;
    });
  }
  assert.ok((await visible(claims)).length > 0);
  await db.user.update({
    where: { id: a.user.id },
    data: { status: "SUSPENDED" },
  });
  assert.equal((await visible(claims)).length, 0);
  await db.user.update({
    where: { id: a.user.id },
    data: { status: "ACTIVE" },
  });
  for (const value of [
    { ...claims, sub: outsider.user.id },
    { ...claims, merkat_session_id: randomUUID() },
    { ...claims, merkat_purpose: "other" },
    { ...claims, sub: "invalid" },
    {},
  ])
    assert.equal((await visible(value)).length, 0);
  assert.equal((await visible(claims, `merkat:user:${b.user.id}`)).length, 0);
  await db.$executeRawUnsafe(
    "INSERT INTO realtime.messages VALUES ('presence', '{}', 'presence-test', true)",
  );
  assert.equal(
    (await visible(claims, `merkat:user:${a.user.id}`, "presence")).length,
    0,
  );
  // Even another broad permissive policy cannot defeat the restrictive guard.
  await db.$executeRawUnsafe(
    "CREATE POLICY overly_broad_fixture ON realtime.messages FOR ALL TO authenticated USING (true) WITH CHECK (true)",
  );
  assert.equal((await visible(claims, `merkat:user:${b.user.id}`)).length, 0);
  await assert.rejects(
    db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL ROLE authenticated");
      await tx.$queryRaw`SELECT set_config('request.jwt.claims', ${JSON.stringify(claims)}, true), set_config('realtime.topic', ${`merkat:user:${a.user.id}`}, true)`;
      await tx.$executeRawUnsafe(
        "INSERT INTO realtime.messages VALUES ('broadcast', '{}', 'forged', true)",
      );
    }),
  );
  await assert.rejects(
    db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL ROLE authenticated");
      await tx.$queryRawUnsafe('SELECT * FROM public."DirectMessage"');
    }),
  );
  await accounts.logout(a.token);
  assert.equal((await visible(claims)).length, 0);
  const bSession = await messaging.realtimeSession(b.token);
  await db.session.update({
    where: { id: bSession.sessionId },
    data: {
      createdAt: new Date(Date.now() - 2000),
      expiresAt: new Date(Date.now() - 1000),
    },
  });
  assert.equal(
    (
      await visible(
        { ...claims, sub: b.user.id, merkat_session_id: bSession.sessionId },
        `merkat:user:${b.user.id}`,
      )
    ).length,
    0,
  );
});
