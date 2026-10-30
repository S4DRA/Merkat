import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import {
  AccountService,
  AuthenticationService,
  MessagingService,
  GroupService,
  PrivacyService,
  hashSessionToken,
} from "@merkat/backend";
import { defaultAppearance, type TabView } from "@merkat/contracts";
import {
  createDatabase,
  createAccountRepository,
  createCredentialRepository,
  createAuthenticationLimiter,
  createMessagingRepository,
  createGroupRepository,
  createPrivacyRepository,
  createProfileRepository,
  createCalendarRepository,
  createTabRepository,
  createSecurityRepository,
} from "@merkat/database";
import { startTestDatabase } from "../support/postgres.js";
import sharp from "sharp";
import { normalizeAvatar } from "../../apps/web/src/lib/server/profile-image.js";

if (!process.env.TEST_DATABASE_URL)
  throw Error("Use the isolated integration runner.");
// This suite owns a fresh cluster; it never inherits a hosted connection or resets quotas.
const cluster = await startTestDatabase();
const db = createDatabase({ DATABASE_URL: cluster.url });
const accounts = new AccountService(createAccountRepository(db));
const auth = new AuthenticationService(
  createCredentialRepository(db),
  createAuthenticationLimiter(db),
  randomBytes(32).toString("hex"),
);
const messaging = new MessagingService(createMessagingRepository(db));
const groups = new GroupService(createGroupRepository(db));
const privacy = new PrivacyService(createPrivacyRepository(db));
const profiles = createProfileRepository(db),
  tabs = createTabRepository(db),
  security = createSecurityRepository(db);
const password = "a strong private test password";
const register = () =>
  auth.register(
    { username: `c${randomUUID().replaceAll("-", "").slice(0, 20)}`, password },
    randomUUID(),
  );
const hash = (token: string) => hashSessionToken(token);
after(async () => {
  await db.$disconnect();
  await cluster.stop();
});

test("profile settings persist, private profiles require a relationship and logout removes device bindings", async () => {
  const [a, b, outsider] = await Promise.all([
    register(),
    register(),
    register(),
  ]);
  const direct = await messaging.open(a.token, {
    username: b.user.profile.username,
  });
  const outgoing = {
    conversationId: direct.id,
    clientId: randomUUID(),
    text: "Persist this direct message",
  };
  const sent = await messaging.send(a.token, outgoing);
  assert.equal((await messaging.send(a.token, outgoing)).id, sent.id);
  const reply = await messaging.send(b.token, {
    conversationId: direct.id,
    clientId: randomUUID(),
    text: "A separate authenticated reply",
  });
  assert.ok(
    (
      await messaging.messages(a.token, { conversationId: direct.id })
    ).messages.some((m) => m.id === reply.id),
  );
  assert.ok(
    (
      await messaging.messages(b.token, { conversationId: direct.id })
    ).messages.some((m) => m.id === sent.id),
  );
  await assert.rejects(
    messaging.messages(outsider.token, { conversationId: direct.id }),
  );
  await profiles.updateSettings(hash(a.token), {
    ...defaultAppearance,
    theme: "DARK",
    largeText: true,
    timezone: "Europe/Istanbul",
  });
  assert.equal((await profiles.settings(hash(a.token))).theme, "DARK");
  assert.equal((await profiles.view(hash(b.token), a.user.id)).id, a.user.id);
  const png = await sharp({
    create: { width: 32, height: 32, channels: 3, background: "orange" },
  })
    .png()
    .toBuffer();
  const image = await normalizeAvatar(png, "image/png");
  await profiles.reserveAvatarUpload(hash(a.token));
  const saved = await profiles.saveAvatar(hash(a.token), image);
  assert.match(saved.avatarRef!, /^\/api\/avatars\//);
  assert.deepEqual(
    Buffer.from((await profiles.avatar(hash(b.token), a.user.id)).bytes),
    image,
  );
  await assert.rejects(profiles.avatar(hash(outsider.token), a.user.id));
  const independent = createDatabase({ DATABASE_URL: cluster.url });
  try {
    assert.equal(
      (await createProfileRepository(independent).settings(hash(a.token)))
        .largeText,
      true,
    );
    assert.deepEqual(
      Buffer.from(
        (
          await createProfileRepository(independent).avatar(
            hash(b.token),
            a.user.id,
          )
        ).bytes,
      ),
      image,
    );
  } finally {
    await independent.$disconnect();
  }
  await profiles.saveAvatar(hash(a.token), null);
  await assert.rejects(profiles.avatar(hash(b.token), a.user.id));
  await assert.rejects(profiles.view(hash(outsider.token), a.user.id));
  const session = await db.session.findUniqueOrThrow({
    where: { tokenHash: hash(a.token) },
  });
  await db.pushSubscription.create({
    data: {
      userId: a.user.id,
      sessionId: session.id,
      endpoint: `https://fcm.googleapis.com/${randomUUID()}`,
      p256dh: "fixture",
      auth: "fixture",
    },
  });
  await accounts.logout(a.token);
  assert.equal(
    await db.pushSubscription.count({ where: { sessionId: session.id } }),
    0,
  );
  await assert.rejects(profiles.settings(hash(a.token)));
});

test("calendar retries, subscription semantics, reminder dedupe and cancellation use durable rows", async () => {
  const [a, b] = await Promise.all([register(), register()]);
  const direct = await messaging.open(a.token, {
    username: b.user.profile.username,
  });
  const now = new Date(),
    startsAt = new Date(now.getTime() + 48 * 3600000),
    endsAt = new Date(startsAt.getTime() + 3600000);
  const calendar = createCalendarRepository(db, () => now);
  const input = {
    clientId: randomUUID(),
    scope: { kind: "DM", id: direct.id },
    event: {
      title: "A real shared plan",
      description: "",
      location: "Cafe",
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      timezone: "Europe/Istanbul",
    },
  };
  const event = await calendar.create(hash(a.token), input);
  assert.equal((await calendar.create(hash(a.token), input)).id, event.id);
  await assert.rejects(
    calendar.create(hash(a.token), {
      ...input,
      event: { ...input.event, title: "Different payload" },
    }),
  );
  await calendar.respond(hash(b.token), { id: event.id, response: "MAYBE" });
  assert.equal(
    await db.planReminder.count({
      where: { planId: event.id, userId: b.user.id, state: "PENDING" },
    }),
    0,
  );
  await calendar.respond(hash(b.token), { id: event.id, response: "GOING" });
  assert.equal(
    await db.planReminder.count({
      where: { planId: event.id, userId: b.user.id, state: "PENDING" },
    }),
    2,
  );
  const due = new Date(startsAt.getTime() - 24 * 3600000 + 1000);
  const concurrent = await Promise.all([
    calendar.deliverDue(due),
    createCalendarRepository(db).deliverDue(due),
  ]);
  assert.equal(
    concurrent.reduce((n, r) => n + r.delivered, 0),
    2,
  );
  assert.equal((await calendar.deliverDue(due)).delivered, 0);
  assert.equal(
    await db.notification.count({
      where: { planId: event.id, dedupeKey: { startsWith: "reminder:" } },
    }),
    2,
  );
  // A newly constructed worker reads the same durable five-hour rows.
  const fiveHours = new Date(startsAt.getTime() - 5 * 3600000 + 1000);
  assert.equal(
    (await createCalendarRepository(db).deliverDue(fiveHours)).delivered,
    2,
  );
  assert.equal(
    (await createCalendarRepository(db).deliverDue(fiveHours)).delivered,
    0,
  );
  assert.equal(
    await db.notification.count({
      where: { planId: event.id, dedupeKey: { startsWith: "reminder:" } },
    }),
    4,
  );
  await assert.rejects(
    calendar.edit(hash(b.token), {
      id: event.id,
      version: event.version,
      event: input.event,
    }),
  );
  await calendar.cancel(hash(a.token), {
    id: event.id,
    version: event.version,
  });
  assert.equal(
    await db.planReminder.count({
      where: { planId: event.id, state: "PENDING" },
    }),
    0,
  );
  const personal = await calendar.create(hash(a.token), {
    clientId: randomUUID(),
    event: input.event,
    usernames: [b.user.profile.username],
  });
  assert.equal(
    personal.participants.find((p) => p.userId === b.user.id)?.response,
    "INVITED",
  );
  assert.equal(
    personal.participants.find((p) => p.userId === b.user.id)?.subscribed,
    false,
  );
  const shared = await calendar.share(hash(a.token), {
    id: personal.id,
    clientId: randomUUID(),
    scope: input.scope,
  });
  assert.equal(shared.scope?.id, direct.id);
  assert.ok(shared.participants.some((p) => p.userId === b.user.id));
  const revised = await calendar.edit(hash(a.token), {
    id: personal.id,
    version: personal.version,
    event: {
      ...input.event,
      startsAt: new Date(startsAt.getTime() + 86400000).toISOString(),
      endsAt: new Date(endsAt.getTime() + 86400000).toISOString(),
    },
  });
  assert.equal(revised.version, 2);
  assert.equal(
    await db.planReminder.count({
      where: { planId: personal.id, version: 1, state: "PENDING" },
    }),
    0,
  );
  assert.equal(
    await db.planReminder.count({
      where: { planId: personal.id, version: 2, state: "PENDING" },
    }),
    2,
  );
  await calendar.cancel(hash(a.token), {
    id: personal.id,
    version: revised.version,
  });
});

test("group tab consent, 1350 TRY settlement, closed history and member removal are enforced", async () => {
  const [a, b, c] = await Promise.all([register(), register(), register()]);
  for (const member of [b, c])
    await privacy.update(member.token, {
      allowNonFriendDms: true,
      groupInvitesFrom: "EVERYONE",
    });
  let group = await groups.create(a.token, {
    clientId: randomUUID(),
    name: "Real bill",
    usernames: [b.user.profile.username, c.user.profile.username],
  });
  for (const member of [b, c]) {
    const invitation = (await groups.list(member.token, {})).invitations.find(
      (i) => i.groupId === group.id,
    )!;
    await groups.invitation(member.token, {
      id: invitation.id,
      action: "ACCEPT",
    });
  }
  group = await groups.detail(a.token, { groupId: group.id });
  const scope = {
    kind: "GROUP",
    id: group.id,
    channelId: group.channels[0]!.id,
  };
  const messages = await Promise.all(
    [a, b, c].map((user) =>
      groups.send(user.token, {
        groupId: group.id,
        channelId: scope.channelId,
        clientId: randomUUID(),
        text: `Hello from ${user.user.id}`,
      }),
    ),
  );
  assert.equal(new Set(messages.map((m) => m.sequence)).size, 3);
  for (const user of [a, b, c]) {
    const history = await groups.messages(user.token, {
      groupId: group.id,
      channelId: scope.channelId,
    });
    assert.ok(
      messages.every((m) =>
        history.messages.some((saved) => saved.id === m.id),
      ),
    );
  }
  await assert.rejects(
    tabs.create(hash(b.token), {
      clientId: randomUUID(),
      title: "Forbidden",
      scope,
      participantIds: [a.user.id, b.user.id, c.user.id],
    }),
  );
  let tab = await tabs.create(hash(a.token), {
    clientId: randomUUID(),
    title: "Friday pub night",
    currency: "TRY",
    scope,
    participantIds: [a.user.id, b.user.id, c.user.id],
  });
  const act = async (token: string, action: unknown) => {
    tab = await tabs.act(hash(token), {
      id: tab.id,
      clientId: randomUUID(),
      version: tab.version,
      action,
    });
    return tab;
  };
  const own = (userId: string, name: string, unitPrice: number) => ({
    kind: "ORDER",
    name,
    unitPrice,
    quantity: 1,
    split: "OWN",
    allocations: [{ userId }],
  });
  await act(a.token, own(a.user.id, "Amsterdam beer", 20000));
  await act(b.token, own(b.user.id, "Craft beer", 25000));
  await act(a.token, {
    kind: "ORDER",
    name: "Six shots",
    unitPrice: 15000,
    quantity: 6,
    split: "EQUAL",
    allocations: [a, b, c].map((u) => ({ userId: u.user.id })),
  });
  assert.equal(tab.summary.total, 45000);
  const shared = tab.state.orders.find((o) => o.name === "Six shots")!;
  await assert.rejects(act(a.token, { kind: "CLOSE", confirm: true }));
  await act(b.token, {
    kind: "ACCEPT_ORDER",
    orderId: shared.id,
    accept: true,
  });
  await act(c.token, {
    kind: "ACCEPT_ORDER",
    orderId: shared.id,
    accept: true,
  });
  assert.equal(tab.summary.total, 135000);
  assert.deepEqual(
    [a, b, c].map(
      (u) => tab.summary.people.find((p) => p.userId === u.user.id)!.consumed,
    ),
    [50000, 55000, 30000],
  );
  await act(a.token, { kind: "PAYMENT", amount: 135000 });
  await act(a.token, { kind: "CLOSE", confirm: true });
  const snapshot = structuredClone(tab.state.snapshot);
  await assert.rejects(act(a.token, own(a.user.id, "Late order", 100)));
  await act(b.token, { kind: "SETTLE", to: a.user.id, amount: 55000 });
  const repayment = tab.state.settlements[0]!;
  await assert.rejects(
    act(c.token, { kind: "CONFIRM_SETTLEMENT", settlementId: repayment.id }),
  );
  await act(a.token, {
    kind: "CONFIRM_SETTLEMENT",
    settlementId: repayment.id,
  });
  assert.deepEqual((tab as TabView).state.snapshot, snapshot);
  let concurrentTab = await tabs.create(hash(a.token), {
    clientId: randomUUID(),
    title: "Concurrent edits",
    currency: "TRY",
    scope,
    participantIds: [a.user.id, b.user.id, c.user.id],
  });
  const attempts = [b, c].map((user) => ({
    user,
    body: {
      id: concurrentTab.id,
      clientId: randomUUID(),
      version: concurrentTab.version,
      action: own(user.user.id, "One-cent item", 1),
    },
  }));
  const results = await Promise.allSettled(
    attempts.map(({ user, body }) => tabs.act(hash(user.token), body)),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.filter((r) => r.status === "rejected").length, 1);
  const winner = attempts[results.findIndex((r) => r.status === "fulfilled")]!;
  concurrentTab = await tabs.act(hash(winner.user.token), winner.body);
  assert.equal(
    concurrentTab.state.orders.length,
    1,
    "retry must not duplicate the committed order",
  );
  concurrentTab = await tabs.act(hash(a.token), {
    id: concurrentTab.id,
    clientId: randomUUID(),
    version: concurrentTab.version,
    action: {
      kind: "ORDER",
      name: "Uneven split",
      unitPrice: 10001,
      quantity: 1,
      split: "EQUAL",
      allocations: [a, b, c].map((u) => ({ userId: u.user.id })),
    },
  });
  const proposed = concurrentTab.state.orders.find(
    (o) => o.name === "Uneven split",
  )!;
  assert.equal(
    proposed.allocations.reduce((n, p) => n + p.amount, 0),
    10001,
  );
  concurrentTab = await tabs.act(hash(b.token), {
    id: concurrentTab.id,
    clientId: randomUUID(),
    version: concurrentTab.version,
    action: { kind: "ACCEPT_ORDER", orderId: proposed.id, accept: false },
  });
  assert.equal(
    concurrentTab.state.orders.find((o) => o.id === proposed.id)!.status,
    "CANCELLED",
  );
  assert.equal(concurrentTab.summary.total, 1);
  await tabs.act(hash(a.token), {
    id: concurrentTab.id,
    clientId: randomUUID(),
    version: concurrentTab.version,
    action: { kind: "CLOSE", confirm: true },
  });
  await groups.member(a.token, {
    groupId: group.id,
    userId: c.user.id,
    action: "REMOVE",
  });
  await assert.rejects(tabs.detail(hash(c.token), { id: tab.id }));
});

test("recovery codes are hashed, single-use and revoke previous sessions", async () => {
  const a = await register(),
    h = hash(a.token);
  const second = await auth.login(
    { username: a.user.profile.username, password },
    randomUUID(),
  );
  await security.change(h, {
    currentPassword: password,
    newPassword: "another strong private test password",
  });
  assert.equal(await accounts.current(second.token), null);
  assert.equal((await accounts.current(a.token))?.id, a.user.id);
  const { codes } = await security.generate(h, {
    currentPassword: "another strong private test password",
  });
  assert.equal(codes.length, 8);
  assert.equal((await security.status(h)).remainingCodes, 8);
  const stored = await db.recoveryCode.findMany({
    where: { userId: a.user.id },
  });
  assert.ok(stored.every((r) => !codes.includes(r.codeHash)));
  const input = {
    username: a.user.profile.username,
    code: codes[0],
    newPassword: "a changed private test password",
  };
  await security.recover(input);
  assert.equal(await accounts.current(a.token), null);
  await assert.rejects(security.recover(input));
  const signedIn = await auth.login(
    { username: a.user.profile.username, password: input.newPassword },
    randomUUID(),
  );
  assert.equal(signedIn.user.id, a.user.id);
});
