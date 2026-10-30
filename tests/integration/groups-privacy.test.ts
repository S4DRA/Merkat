import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import {
  AccountService,
  AuthenticationService,
  MessagingService,
  FriendshipService,
  GroupService,
  PrivacyService,
  PlanService,
  isSocialError,
  isMessagingError,
  isAccountError,
  isFriendshipError,
} from "@merkat/backend";
import {
  createDatabase,
  createAccountRepository,
  createCredentialRepository,
  createAuthenticationLimiter,
  createMessagingRepository,
  createFriendshipRepository,
  createGroupRepository,
  createPrivacyRepository,
  createPlanRepository,
} from "@merkat/database";
import { createApiHandler } from "../../apps/web/src/lib/server/http-api.js";
import { startTestDatabase } from "../support/postgres.js";
if (!process.env.TEST_DATABASE_URL) throw Error("Use isolated test runner");
// Keep this expanded registration suite below the real global quota independently
// of the existing files. Do not reset or weaken production authentication limits.
const groupDatabase = await startTestDatabase();
const db = createDatabase({ DATABASE_URL: groupDatabase.url });
const db2 = createDatabase({ DATABASE_URL: groupDatabase.url });
const accounts = new AccountService(createAccountRepository(db));
const auth = new AuthenticationService(
  createCredentialRepository(db),
  createAuthenticationLimiter(db),
  randomBytes(32).toString("hex"),
);
const groups = new GroupService(createGroupRepository(db));
const second = new GroupService(createGroupRepository(db2));
const privacy = new PrivacyService(createPrivacyRepository(db));
const messaging = new MessagingService(createMessagingRepository(db));
const friends = new FriendshipService(createFriendshipRepository(db));
const plans = new PlanService(accounts, createPlanRepository(db));
const bad = (code: string) => (e: unknown) =>
  (isSocialError(e) ||
    isMessagingError(e) ||
    isAccountError(e) ||
    isFriendshipError(e)) &&
  e.code === code;
const register = () =>
  auth.register(
    {
      username: `g${randomUUID().replaceAll("-", "").slice(0, 20)}`,
      password: randomBytes(24).toString("base64url"),
    },
    randomUUID(),
  );
const send = (
  token: string,
  groupId: string,
  channelId: string,
  text: string = randomUUID(),
  clientId: string = randomUUID(),
  replyToId?: string,
) =>
  groups.send(token, {
    groupId,
    channelId,
    text,
    clientId,
    ...(replyToId ? { replyToId } : {}),
  });
async function community() {
  const [a, b, c] = await Promise.all([register(), register(), register()]);
  for (const user of [b, c])
    await privacy.update(user.token, {
      allowNonFriendDms: true,
      groupInvitesFrom: "EVERYONE",
    });
  const g = await groups.create(a.token, {
    clientId: randomUUID(),
    name: "Real group",
    description: "Three independent accounts",
    usernames: [b.user.profile.username, c.user.profile.username],
  });
  for (const user of [b, c]) {
    const invitation = (await groups.list(user.token, {})).invitations.find(
      (i) => i.groupId === g.id,
    )!;
    await groups.invitation(user.token, {
      id: invitation.id,
      action: "ACCEPT",
    });
  }
  return { a, b, c, g: await groups.detail(a.token, { groupId: g.id }) };
}
after(async () => {
  await db.$disconnect();
  await db2.$disconnect();
  await groupDatabase.stop();
});

test("group creation is atomic/idempotent and invitations require explicit recipient acceptance", async () => {
  const [a, b] = await Promise.all([register(), register()]);
  const input = { clientId: randomUUID(), name: "A community" };
  const concurrent = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      (i % 2 ? groups : second).create(a.token, input),
    ),
  );
  assert.equal(new Set(concurrent.map((g) => g.id)).size, 1);
  const g = concurrent[0]!;
  assert.equal(g.members.length, 1);
  assert.equal(g.channels.length, 1);
  assert.equal(g.channels[0]!.name, "general");
  assert.equal(g.role, "OWNER");
  await assert.rejects(
    groups.invite(a.token, {
      groupId: g.id,
      username: b.user.profile.username,
    }),
    bad("NOT_FOUND"),
  );
  const request = await friends.request(a.token, {
    username: b.user.profile.username,
  });
  await friends.act(b.token, { id: request.id, action: "ACCEPT" });
  await groups.invite(a.token, {
    groupId: g.id,
    username: b.user.profile.username,
  });
  await assert.rejects(
    groups.detail(b.token, { groupId: g.id }),
    bad("NOT_FOUND"),
  );
  const invitation = (await groups.list(b.token, {})).invitations[0]!;
  await assert.rejects(
    groups.invitation(a.token, { id: invitation.id, action: "ACCEPT" }),
    bad("NOT_FOUND"),
  );
  await groups.invitation(b.token, { id: invitation.id, action: "ACCEPT" });
  assert.equal(
    (await groups.detail(b.token, { groupId: g.id })).role,
    "MEMBER",
  );
  await assert.rejects(
    groups.create(a.token, {
      clientId: randomUUID(),
      name: "Rolled back",
      usernames: ["missing_registered_user"],
    }),
    bad("NOT_FOUND"),
  );
  assert.equal(
    await db.chatGroup.count({
      where: { name: "Rolled back", createdById: a.user.id },
    }),
    0,
  );
});

test("role matrix, promotion, editing, safe transfer and leave prevent ownerless groups", async () => {
  const { a, b, c, g } = await community();
  for (const action of [
    () =>
      groups.edit(b.token, { groupId: g.id, name: "forged", description: "" }),
    () =>
      groups.createChannel(b.token, {
        groupId: g.id,
        name: "forged",
        clientId: randomUUID(),
      }),
    () =>
      groups.member(b.token, {
        groupId: g.id,
        userId: c.user.id,
        action: "ADMIN",
      }),
  ])
    await assert.rejects(action, bad("FORBIDDEN"));
  await groups.member(a.token, {
    groupId: g.id,
    userId: b.user.id,
    action: "ADMIN",
  });
  await groups.edit(b.token, {
    groupId: g.id,
    name: "Renamed",
    description: "Updated",
  });
  await assert.rejects(
    groups.member(b.token, {
      groupId: g.id,
      userId: a.user.id,
      action: "REMOVE",
    }),
    bad("FORBIDDEN"),
  );
  await assert.rejects(
    groups.member(b.token, {
      groupId: g.id,
      userId: c.user.id,
      action: "ADMIN",
    }),
    bad("FORBIDDEN"),
  );
  await assert.rejects(
    groups.leave(a.token, { groupId: g.id }),
    bad("OWNER_TRANSFER_REQUIRED"),
  );
  const result = await groups.member(a.token, {
    groupId: g.id,
    userId: b.user.id,
    action: "TRANSFER",
  });
  assert.equal(result.members.filter((m) => m.role === "OWNER").length, 1);
  assert.equal(result.members.find((m) => m.id === b.user.id)!.role, "OWNER");
  await groups.leave(a.token, { groupId: g.id });
  await assert.rejects(
    groups.detail(a.token, { groupId: g.id }),
    bad("NOT_FOUND"),
  );
  await groups.member(b.token, {
    groupId: g.id,
    userId: c.user.id,
    action: "REMOVE",
  });
  await groups.leave(b.token, { groupId: g.id });
  assert.ok(
    (await db.chatGroup.findUniqueOrThrow({ where: { id: g.id } })).archivedAt,
  );
});

test("concurrent ownership transfers produce exactly one owner; SQL rejects orphaned ownership", async () => {
  const { a, b, c, g } = await community();
  const results = await Promise.allSettled([
    groups.member(a.token, {
      groupId: g.id,
      userId: b.user.id,
      action: "TRANSFER",
    }),
    second.member(a.token, {
      groupId: g.id,
      userId: c.user.id,
      action: "TRANSFER",
    }),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    await db.groupMember.count({
      where: { groupId: g.id, leftAt: null, role: "OWNER" },
    }),
    1,
  );
  const owner = await db.chatGroup.findUniqueOrThrow({ where: { id: g.id } });
  await assert.rejects(
    db.groupMember.update({
      where: { groupId_userId: { groupId: g.id, userId: owner.ownerId } },
      data: { role: "MEMBER" },
    }),
  );
  assert.equal(
    await db.groupMember.count({
      where: { groupId: g.id, leftAt: null, role: "OWNER" },
    }),
    1,
  );
});

test("channel IDs/order stay stable, default is protected, and deletion immediately denies history/send/receipt", async () => {
  const { a, b, g } = await community();
  const key = randomUUID();
  const created = await groups.createChannel(a.token, {
    groupId: g.id,
    name: "weekend",
    clientId: key,
  });
  const c = created.channels.find((c) => c.name === "weekend")!;
  assert.equal(
    (
      await groups.createChannel(a.token, {
        groupId: g.id,
        name: "weekend",
        clientId: key,
      })
    ).channels.length,
    2,
  );
  await groups.editChannel(a.token, {
    groupId: g.id,
    channelId: c.id,
    action: "RENAME",
    name: "plans",
  });
  assert.equal(
    (await groups.detail(b.token, { groupId: g.id })).channels.find(
      (row) => row.id === c.id,
    )!.position,
    c.position,
  );
  await assert.rejects(
    groups.editChannel(a.token, {
      groupId: g.id,
      channelId: g.defaultChannelId,
      action: "DELETE",
    }),
    bad("DEFAULT_CHANNEL"),
  );
  await assert.rejects(
    groups.createChannel(a.token, {
      groupId: g.id,
      name: "GENERAL",
      clientId: randomUUID(),
    }),
    bad("CHANNEL_NAME_TAKEN"),
  );
  await send(a.token, g.id, c.id, "Persisted before channel deletion");
  await groups.editChannel(a.token, {
    groupId: g.id,
    channelId: c.id,
    action: "DELETE",
  });
  for (const action of [
    () => groups.messages(b.token, { groupId: g.id, channelId: c.id }),
    () => send(b.token, g.id, c.id),
    () =>
      groups.receipt(b.token, {
        groupId: g.id,
        channelId: c.id,
        deliveredSequence: 0,
      }),
  ])
    await assert.rejects(action, bad("NOT_FOUND"));
  assert.equal(await db.groupMessage.count({ where: { channelId: c.id } }), 1);
});

test("persistent channel messages, same-channel replies, unique ordering and ambiguous retries across instances", async () => {
  const { a, b, g } = await community();
  const channelId = g.defaultChannelId;
  const original = await send(a.token, g.id, channelId, "Original");
  const reply = await send(
    b.token,
    g.id,
    channelId,
    "Reply",
    randomUUID(),
    original.id,
  );
  assert.equal(reply.replyTo!.id, original.id);
  assert.equal(reply.senderId, b.user.id);
  const retries = await Promise.all(
    Array.from({ length: 6 }, () =>
      second.send(b.token, {
        groupId: g.id,
        channelId,
        clientId: reply.clientId,
        text: reply.text,
        replyToId: original.id,
      }),
    ),
  );
  assert.ok(retries.every((m) => m.id === reply.id));
  await assert.rejects(
    send(b.token, g.id, channelId, "changed", reply.clientId, original.id),
    bad("SUBMISSION_CONFLICT"),
  );
  await assert.rejects(
    groups.send(b.token, {
      groupId: g.id,
      channelId,
      clientId: randomUUID(),
      text: "forged",
      senderId: a.user.id,
    }),
    bad("INVALID_REQUEST"),
  );
  const channels = await groups.createChannel(a.token, {
    groupId: g.id,
    name: "other",
    clientId: randomUUID(),
  });
  await assert.rejects(
    send(
      a.token,
      g.id,
      channels.channels.find((c) => c.name === "other")!.id,
      "Cross channel",
      randomUUID(),
      original.id,
    ),
    bad("NOT_FOUND"),
  );
  const concurrent = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      send(i % 2 ? a.token : b.token, g.id, channelId),
    ),
  );
  assert.equal(new Set(concurrent.map((m) => m.sequence)).size, 8);
  const persisted = await second.messages(b.token, {
    groupId: g.id,
    channelId,
  });
  assert.equal(persisted.messages.length, 10);
  await assert.rejects(
    db.groupMessage.update({
      where: { id: original.id },
      data: { senderId: b.user.id },
    }),
  );
  assert.ok(
    persisted.messages.every(
      (m) => !("email" in m.sender) && !("bio" in m.sender),
    ),
  );
});

test("channel pagination and fixed-boundary recovery do not skip or duplicate concurrent messages", async () => {
  const { a, b, g } = await community(),
    channelId = g.defaultChannelId;
  for (let i = 0; i < 45; i++)
    await send(a.token, g.id, channelId, `history ${i}`);
  const recent = await groups.messages(b.token, { groupId: g.id, channelId });
  assert.equal(recent.messages.length, 40);
  assert.equal(recent.hasMore, true);
  const old = await groups.messages(b.token, {
    groupId: g.id,
    channelId,
    before: recent.messages[0]!.sequence,
  });
  assert.equal(old.messages.length, 5);
  const first = await groups.messages(b.token, {
    groupId: g.id,
    channelId,
    after: 0,
  });
  assert.equal(first.hasMore, true);
  assert.equal(first.through, 45);
  await send(a.token, g.id, channelId, "arrived during recovery");
  const next = await groups.messages(b.token, {
    groupId: g.id,
    channelId,
    after: first.messages.at(-1)!.sequence,
    through: first.through,
  });
  assert.equal(next.messages.length, 5);
  assert.equal(next.hasMore, false);
  assert.equal(
    new Set([...first.messages, ...next.messages].map((m) => m.id)).size,
    45,
  );
  assert.equal(
    (await groups.messages(b.token, { groupId: g.id, channelId, after: 45 }))
      .messages.length,
    1,
  );
});

test("per-channel unread excludes own messages, cursors are monotonic and rejoin starts at current tail", async () => {
  const { a, b, g } = await community();
  const channelId = g.defaultChannelId;
  await send(a.token, g.id, channelId, "One");
  await send(b.token, g.id, channelId, "Own");
  const current = await groups.detail(b.token, { groupId: g.id });
  assert.equal(current.unreadCount, 1);
  await groups.receipt(b.token, {
    groupId: g.id,
    channelId,
    deliveredSequence: 2,
    readSequence: 2,
  });
  const regressed = await groups.receipt(b.token, {
    groupId: g.id,
    channelId,
    deliveredSequence: 0,
    readSequence: 0,
  });
  assert.equal(regressed.unreadCount, 0);
  assert.equal(regressed.channels[0]!.readSequence, 2);
  await assert.rejects(
    groups.receipt(b.token, { groupId: g.id, channelId, deliveredSequence: 3 }),
    bad("INVALID_REQUEST"),
  );
  await groups.leave(b.token, { groupId: g.id });
  await send(a.token, g.id, channelId, "While away");
  await groups.invite(a.token, {
    groupId: g.id,
    username: b.user.profile.username,
  });
  const invitation = (await groups.list(b.token, {})).invitations.find(
    (i) => i.groupId === g.id,
  )!;
  await groups.invitation(b.token, { id: invitation.id, action: "ACCEPT" });
  assert.equal(
    (await groups.detail(b.token, { groupId: g.id })).unreadCount,
    0,
  );
  assert.equal(
    (await groups.messages(b.token, { groupId: g.id, channelId })).messages
      .length,
    3,
  );
});

test("outsiders and removed members lose every content API; removal/send races have a committed boundary", async () => {
  const { a, b, c, g } = await community(),
    channelId = g.defaultChannelId;
  const outsider = await register();
  for (const token of [outsider.token])
    for (const action of [
      () => groups.detail(token, { groupId: g.id }),
      () => groups.messages(token, { groupId: g.id, channelId }),
      () => send(token, g.id, channelId),
      () =>
        groups.receipt(token, {
          groupId: g.id,
          channelId,
          deliveredSequence: 0,
        }),
    ])
      await assert.rejects(action, bad("NOT_FOUND"));
  await groups.member(a.token, {
    groupId: g.id,
    userId: b.user.id,
    action: "ADMIN",
  });
  const results = await Promise.allSettled([
    send(c.token, g.id, channelId),
    second.member(b.token, {
      groupId: g.id,
      userId: c.user.id,
      action: "REMOVE",
    }),
  ]);
  assert.equal(results[1]!.status, "fulfilled");
  for (const action of [
    () => groups.messages(c.token, { groupId: g.id, channelId }),
    () => send(c.token, g.id, channelId),
    () =>
      groups.receipt(c.token, {
        groupId: g.id,
        channelId,
        deliveredSequence: 0,
      }),
    () => groups.detail(c.token, { groupId: g.id }),
  ])
    await assert.rejects(action, bad("NOT_FOUND"));
  assert.equal((await groups.list(c.token, {})).groups.length, 0);
  // Per-user capabilities remain valid for the user's other conversations, not group access.
  assert.equal((await messaging.realtimeSession(c.token)).userId, c.user.id);
});

test("blocking preserves DM/group history and stops both-direction sends, friends, lookup and invitations", async () => {
  const { a, b, g } = await community();
  const dm = await messaging.open(a.token, {
    username: b.user.profile.username,
  });
  await messaging.send(a.token, {
    conversationId: dm.id,
    clientId: randomUUID(),
    text: "Existing DM",
  });
  const friend = await friends.request(a.token, {
    username: b.user.profile.username,
  });
  await friends.act(b.token, { id: friend.id, action: "ACCEPT" });
  await privacy.block(a.token, { userId: b.user.id, blocked: true });
  assert.equal(
    (await messaging.messages(a.token, { conversationId: dm.id })).conversation
      .blockedByYou,
    true,
  );
  assert.equal(
    (await messaging.messages(b.token, { conversationId: dm.id })).conversation
      .canSend,
    false,
  );
  await assert.rejects(
    plans.create(a.token, {
      title: "Blocked plan invitation",
      description: "",
      location: "",
      startsAt: new Date(Date.now() + 3600000).toISOString(),
      endsAt: new Date(Date.now() + 7200000).toISOString(),
      usernames: [b.user.profile.username],
    }),
    bad("INTERACTION_UNAVAILABLE"),
  );
  assert.equal(
    (await messaging.messages(b.token, { conversationId: dm.id })).messages
      .length,
    1,
  );
  for (const token of [a.token, b.token])
    await assert.rejects(
      messaging.send(token, {
        conversationId: dm.id,
        clientId: randomUUID(),
        text: "Unwanted",
      }),
      bad("INTERACTION_UNAVAILABLE"),
    );
  await assert.rejects(
    messaging.open(b.token, { username: a.user.profile.username }),
    bad("NOT_FOUND"),
  );
  await assert.rejects(
    friends.request(b.token, { username: a.user.profile.username }),
    bad("NOT_FOUND"),
  );
  await assert.rejects(
    plans.findPerson(b.token, { username: a.user.profile.username }),
    (e) => e instanceof Error && e.message === "NOT_FOUND",
  );
  assert.equal(
    (await friends.list(a.token, { section: "FRIENDS" })).people.length,
    0,
  );
  await send(b.token, g.id, g.defaultChannelId, "Shared group remains visible");
  assert.equal(
    (
      await groups.messages(a.token, {
        groupId: g.id,
        channelId: g.defaultChannelId,
      })
    ).messages.length,
    1,
  );
  await groups.leave(b.token, { groupId: g.id });
  await assert.rejects(
    groups.invite(a.token, {
      groupId: g.id,
      username: b.user.profile.username,
    }),
    bad("NOT_FOUND"),
  );
  assert.equal((await privacy.blocks(a.token, {})).people[0]!.id, b.user.id);
  await privacy.block(a.token, { userId: b.user.id, blocked: false });
  await messaging.send(b.token, {
    conversationId: dm.id,
    clientId: randomUUID(),
    text: "Allowed after unblock",
  });
  assert.equal(
    (await friends.list(a.token, { section: "FRIENDS" })).people.length,
    0,
  );
});

test("non-friend DM preference applies to new pairs; invitation acceptance rechecks blocks/settings/manager status", async () => {
  const [a, b] = await Promise.all([register(), register()]);
  await privacy.update(b.token, {
    allowNonFriendDms: false,
    groupInvitesFrom: "EVERYONE",
  });
  await assert.rejects(
    messaging.open(a.token, { username: b.user.profile.username }),
    bad("NOT_FOUND"),
  );
  const friendship = await friends.request(a.token, {
    username: b.user.profile.username,
  });
  await friends.act(b.token, { id: friendship.id, action: "ACCEPT" });
  const dm = await messaging.open(a.token, {
    username: b.user.profile.username,
  });
  assert.ok(dm.id);
  const g = await groups.create(a.token, {
    clientId: randomUUID(),
    name: "Invitation privacy",
    usernames: [b.user.profile.username],
  });
  const invitation = (await groups.list(b.token, {})).invitations[0]!;
  await privacy.update(b.token, {
    allowNonFriendDms: false,
    groupInvitesFrom: "NOBODY",
  });
  await assert.rejects(
    groups.invitation(b.token, { id: invitation.id, action: "ACCEPT" }),
    bad("NOT_FOUND"),
  );
  await privacy.block(b.token, { userId: a.user.id, blocked: true });
  assert.equal(
    await db.groupInvitation.count({
      where: { groupId: g.id, userId: b.user.id },
    }),
    0,
  );
});

test("unsuccessful exact-username searches commit quotas and unknown/blocked results disclose no profile", async () => {
  const a = await register();
  for (let i = 0; i < 30; i++)
    await assert.rejects(
      plans.findPerson(a.token, { username: "missing_registered_user" }),
      (e) => e instanceof Error && e.message === "NOT_FOUND",
    );
  assert.equal(
    (
      await db.messagingRateLimit.findUniqueOrThrow({
        where: { userId: a.user.id },
      })
    ).discoveryCount,
    30,
  );
  await assert.rejects(
    plans.findPerson(a.token, { username: "missing_registered_user" }),
    bad("TRY_LATER"),
  );
});

test("concurrent block/send operations respect the completed privacy boundary", async () => {
  const [a, b] = await Promise.all([register(), register()]);
  const dm = await messaging.open(a.token, {
    username: b.user.profile.username,
  });
  const results = await Promise.allSettled([
    messaging.send(b.token, {
      conversationId: dm.id,
      clientId: randomUUID(),
      text: "Before the block boundary",
    }),
    privacy.block(a.token, { userId: b.user.id, blocked: true }),
  ]);
  assert.equal(results[1]!.status, "fulfilled");
  await assert.rejects(
    messaging.send(b.token, {
      conversationId: dm.id,
      clientId: randomUUID(),
      text: "After completed block",
    }),
    bad("INTERACTION_UNAVAILABLE"),
  );
  assert.equal(
    await db.directMessage.count({ where: { conversationId: dm.id } }),
    results[0]!.status === "fulfilled" ? 1 : 0,
  );
});

test("demoted inviters cannot leave usable invitations; group APIs reject revoked and suspended sessions", async () => {
  const { a, b, c, g } = await community();
  const d = await register();
  await privacy.update(d.token, {
    allowNonFriendDms: true,
    groupInvitesFrom: "EVERYONE",
  });
  await groups.member(a.token, {
    groupId: g.id,
    userId: b.user.id,
    action: "ADMIN",
  });
  await privacy.block(a.token, { userId: d.user.id, blocked: true });
  await assert.rejects(
    groups.invite(b.token, {
      groupId: g.id,
      username: d.user.profile.username,
    }),
    bad("NOT_FOUND"),
  );
  await privacy.block(a.token, { userId: d.user.id, blocked: false });
  await groups.invite(b.token, {
    groupId: g.id,
    username: d.user.profile.username,
  });
  const invitation = (await groups.list(d.token, {})).invitations[0]!;
  await groups.member(a.token, {
    groupId: g.id,
    userId: b.user.id,
    action: "MEMBER",
  });
  await assert.rejects(
    groups.invitation(d.token, { id: invitation.id, action: "ACCEPT" }),
    bad("NOT_FOUND"),
  );
  await accounts.logout(c.token);
  await assert.rejects(
    groups.detail(c.token, { groupId: g.id }),
    bad("UNAUTHORIZED"),
  );
  await db.user.update({
    where: { id: b.user.id },
    data: { status: "SUSPENDED" },
  });
  await assert.rejects(
    groups.messages(b.token, { groupId: g.id, channelId: g.defaultChannelId }),
    bad("UNAUTHORIZED"),
  );
  await assert.rejects(groups.list("a".repeat(43), {}), bad("UNAUTHORIZED"));
});

test("secure reports are idempotent acknowledgements, bounded, target-authorized and not a read API", async () => {
  const { a, b, g } = await community();
  const outsider = await register();
  const clientId = randomUUID();
  const report = {
    clientId,
    target: { kind: "USER", id: b.user.id },
    category: "HARASSMENT",
    reason: "Stored privately",
  };
  await privacy.report(a.token, report);
  await privacy.report(a.token, report);
  assert.equal(
    await db.safetyReport.count({ where: { reporterId: a.user.id, clientId } }),
    1,
  );
  await privacy.report(a.token, {
    ...report,
    clientId: randomUUID(),
    target: { kind: "GROUP", id: g.id },
  });
  await assert.rejects(
    privacy.report(outsider.token, { ...report, clientId: randomUUID() }),
    bad("NOT_FOUND"),
  );
  await assert.rejects(
    privacy.report(a.token, {
      ...report,
      clientId: randomUUID(),
      reason: "x".repeat(1001),
    }),
    bad("INVALID_REQUEST"),
  );
});

test("group/privacy HTTP routes enforce session, origin, bounded bodies, strict identity and no-store", async () => {
  const { a, g } = await community();
  const origin = "https://phase6.example.test";
  const handle = createApiHandler(
    () => ({
      accounts,
      plans,
      messaging,
      friendships: friends,
      groups,
      privacy,
    }),
    () => ({ appOrigin: origin, production: true }),
  );
  const request = (
    endpoint: string,
    body: unknown,
    token = a.token,
    source = origin,
  ) =>
    handle(
      new Request(`${origin}/api/${endpoint}`, {
        method: "POST",
        headers: {
          origin: source,
          cookie: `__Host-merkat_session=${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      }),
      endpoint,
    );
  assert.equal((await request("groups/detail", { groupId: g.id })).status, 200);
  assert.equal(
    (await request("groups/detail", { groupId: g.id }, "")).status,
    401,
  );
  assert.equal(
    (
      await request(
        "groups/detail",
        { groupId: g.id },
        a.token,
        "https://evil.invalid",
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request("groups/send", {
        groupId: g.id,
        channelId: g.defaultChannelId,
        clientId: randomUUID(),
        text: "forged",
        senderId: randomUUID(),
      })
    ).status,
    400,
  );
  assert.equal(
    (await request("groups/send", { text: "x".repeat(25000) })).status,
    413,
  );
  assert.equal(
    (await request("groups/detail", { groupId: randomUUID() })).status,
    404,
  );
  const settings = await request("privacy/settings", {});
  assert.equal(settings.headers.get("cache-control"), "no-store");
  assert.equal(settings.status, 200);
  assert.equal((await request("privacy/reports", {})).status, 404);
});

test("isolated SQL contract: restricted backend, insert-only reports, private invalidations and removed-recipient exclusion", async () => {
  // Fresh PostgreSQL contract fixture, not a hosted Supabase Realtime server.
  const isolated = await startTestDatabase();
  const client = new Client({ connectionString: isolated.url });
  await client.connect();
  const admin = createDatabase({ DATABASE_URL: isolated.url });
  let runtime: ReturnType<typeof createDatabase> | undefined;
  try {
    const password = randomBytes(24).toString("hex");
    await client.query(
      `CREATE ROLE anon NOLOGIN;CREATE ROLE authenticated NOLOGIN;CREATE ROLE merkat_runtime LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;CREATE SCHEMA realtime;CREATE TABLE realtime.messages(extension text,payload jsonb,event text,topic text,private boolean);ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;GRANT USAGE ON SCHEMA realtime TO anon,authenticated;GRANT SELECT,INSERT ON realtime.messages TO anon,authenticated;CREATE FUNCTION realtime.topic() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('realtime.topic',true) $$;CREATE FUNCTION realtime.send(payload jsonb,event text,topic text,private boolean) RETURNS void LANGUAGE sql AS $$ INSERT INTO realtime.messages VALUES('broadcast',payload,event,topic,private) $$;`,
    );
    for (const file of [
      "realtime.sql",
      "server-role.sql",
      "groups-privacy.sql",
    ]) {
      const sql = await readFile(
        new URL("../../infra/supabase/" + file, import.meta.url),
        "utf8",
      );
      await client.query(sql);
      await client.query(sql);
    }
    const url = new URL(isolated.url);
    url.username = "merkat_runtime";
    url.password = password;
    runtime = createDatabase({ DATABASE_URL: url.href });
    const ar = new AuthenticationService(
      createCredentialRepository(runtime),
      createAuthenticationLimiter(runtime),
      randomBytes(32).toString("hex"),
    );
    const gr = new GroupService(createGroupRepository(runtime)),
      pr = new PrivacyService(createPrivacyRepository(runtime));
    const a = await ar.register(
        { username: "sql_owner", password: randomBytes(24).toString("hex") },
        randomUUID(),
      ),
      b = await ar.register(
        { username: "sql_member", password: randomBytes(24).toString("hex") },
        randomUUID(),
      );
    await pr.update(b.token, {
      allowNonFriendDms: true,
      groupInvitesFrom: "EVERYONE",
    });
    const g = await gr.create(a.token, {
      clientId: randomUUID(),
      name: "SQL contract",
      usernames: ["sql_member"],
    });
    await gr.invitation(b.token, {
      id: (await gr.list(b.token, {})).invitations[0]!.id,
      action: "ACCEPT",
    });
    await client.query("TRUNCATE realtime.messages");
    await gr.send(a.token, {
      groupId: g.id,
      channelId: g.defaultChannelId,
      clientId: randomUUID(),
      text: "Not in Broadcast",
    });
    const events = await client.query(
      "SELECT payload,topic,private FROM realtime.messages",
    );
    assert.deepEqual(
      new Set(events.rows.map((e) => e.topic)),
      new Set([`merkat:user:${a.user.id}`, `merkat:user:${b.user.id}`]),
    );
    assert.ok(
      events.rows.every((e) => e.private && JSON.stringify(e.payload) === "{}"),
    );
    const restrictedReport = {
      clientId: randomUUID(),
      target: { kind: "GROUP", id: g.id },
      category: "OTHER",
      reason: "Restricted report",
    };
    await pr.report(a.token, restrictedReport);
    await pr.report(a.token, restrictedReport);
    await assert.rejects(runtime.safetyReport.findMany());
    await assert.rejects(
      runtime.$executeRawUnsafe("CREATE TABLE public.forbidden(id int)"),
    );
    await gr.member(a.token, {
      groupId: g.id,
      userId: b.user.id,
      action: "REMOVE",
    });
    await client.query("TRUNCATE realtime.messages");
    await gr.send(a.token, {
      groupId: g.id,
      channelId: g.defaultChannelId,
      clientId: randomUUID(),
      text: "After removal",
    });
    assert.deepEqual(
      new Set(
        (await client.query("SELECT topic FROM realtime.messages")).rows.map(
          (e) => e.topic,
        ),
      ),
      new Set([`merkat:user:${a.user.id}`]),
    );
    await client.query("SET ROLE authenticated");
    await assert.rejects(client.query('SELECT * FROM public."GroupMessage"'));
    await assert.rejects(client.query('SELECT * FROM public."SafetyReport"'));
    await client.query("RESET ROLE");
    await client.query("SET ROLE merkat_moderator");
    assert.equal(
      (await client.query('SELECT * FROM public."SafetyReport"')).rowCount,
      1,
    );
    await assert.rejects(client.query('DELETE FROM public."SafetyReport"'));
    await client.query("RESET ROLE");
  } finally {
    await runtime?.$disconnect();
    await admin.$disconnect();
    await client.end();
    await isolated.stop();
  }
});
