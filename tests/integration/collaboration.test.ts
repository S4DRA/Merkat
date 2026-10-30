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
  await messaging.open(a.token, { username: b.user.profile.username });
  await profiles.updateSettings(hash(a.token), {
    ...defaultAppearance,
    theme: "DARK",
    largeText: true,
    timezone: "Europe/Istanbul",
  });
  assert.equal((await profiles.settings(hash(a.token))).theme, "DARK");
  assert.equal((await profiles.view(hash(b.token), a.user.id)).id, a.user.id);
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
  assert.equal((await calendar.deliverDue(due)).delivered, 2);
  assert.equal((await calendar.deliverDue(due)).delivered, 0);
  assert.equal(
    await db.notification.count({
      where: { planId: event.id, dedupeKey: { startsWith: "reminder:" } },
    }),
    2,
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
  const { codes } = await security.generate(h, { currentPassword: password });
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
