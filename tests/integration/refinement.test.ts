import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  AccountService,
  GroupService,
  PrivacyService,
  hashSessionToken,
  isSocialError,
} from "@merkat/backend";
import {
  createDatabase,
  createAccountRepository,
  createCalendarRepository,
  createGroupRepository,
  createGroupAvatarRepository,
  createPrivacyRepository,
} from "@merkat/database";
import { normalizeAvatar } from "../../apps/web/src/lib/server/profile-image.js";
const db = createDatabase({ DATABASE_URL: process.env.TEST_DATABASE_URL });
const accounts = new AccountService(createAccountRepository(db));
const calendar = createCalendarRepository(db),
  groups = new GroupService(createGroupRepository(db)),
  avatars = createGroupAvatarRepository(db),
  privacy = new PrivacyService(createPrivacyRepository(db));
async function person() {
  const session = await accounts.signIn(
    {
      async verifyCredential() {
        return { issuer: "refinement-fixture", subject: randomUUID() };
      },
    },
    "fixture",
  );
  const user = await accounts.saveProfile(session.token, {
    username: `qa_${randomUUID().replaceAll("-", "").slice(0, 20)}`,
    displayName: "Refinement fixture",
    bio: "",
  });
  return { ...session, user, hash: hashSessionToken(session.token) };
}
after(async () => {
  await db.$disconnect();
});
test("calendar range pagination retains every event beyond 200 with tied timestamps and optional invitations remain separate", async () => {
  const user = await person();
  const start = new Date("2026-10-30T10:00:00Z"),
    end = new Date("2026-10-30T11:00:00Z");
  const ids = Array.from({ length: 205 }, () => randomUUID());
  await db.plan.createMany({
    data: ids.map((id) => ({
      id,
      ownerId: user.user.id,
      title: "Pagination fixture",
      startsAt: start,
      endsAt: end,
    })),
  });
  await db.planParticipant.createMany({
    data: ids.map((planId) => ({
      planId,
      userId: user.user.id,
      response: "GOING",
      subscribed: true,
    })),
  });
  const range = { start: "2026-10-30T00:00:00Z", end: "2026-10-31T00:00:00Z" };
  const first = await calendar.list(user.hash, range);
  assert.equal(first.events.length, 200);
  assert.ok(first.nextCursor);
  const second = await calendar.list(user.hash, {
    ...range,
    after: first.nextCursor,
  });
  assert.equal(second.events.length, 5);
  assert.equal(second.nextCursor, null);
  assert.equal(
    new Set([...first.events, ...second.events].map((event) => event.id)).size,
    205,
  );
  const invited = await person();
  await db.planParticipant.create({
    data: {
      planId: ids[0]!,
      userId: invited.user.id,
      response: "INVITED",
      subscribed: false,
    },
  });
  assert.equal((await calendar.list(invited.hash, range)).events.length, 0);
});
test("group avatars persist privately; only managers write and departed/outsider accounts cannot read", async () => {
  const [owner, member, outsider] = await Promise.all([
    person(),
    person(),
    person(),
  ]);
  await privacy.update(member.token, {
    allowNonFriendDms: true,
    groupInvitesFrom: "EVERYONE",
  });
  const group = await groups.create(owner.token, {
    clientId: randomUUID(),
    name: "Avatar acceptance",
    usernames: [member.user.profile.username],
  });
  const invitation = (await groups.list(member.token, {})).invitations.find(
    (item) => item.groupId === group.id,
  )!;
  await groups.invitation(member.token, {
    id: invitation.id,
    action: "ACCEPT",
  });
  const bytes = await normalizeAvatar(
    await readFile("apps/web/public/icons/merkat-192.png"),
    "image/png",
  );
  await avatars.reserve(owner.hash, group.id);
  const ref = await avatars.save(owner.hash, group.id, bytes);
  assert.match(ref!, /^\/api\/groups\//);
  assert.deepEqual(
    Buffer.from((await avatars.read(member.hash, group.id)).bytes),
    bytes,
  );
  assert.equal(
    (await groups.detail(owner.token, { groupId: group.id })).avatarRef,
    ref,
  );
  await assert.rejects(
    avatars.save(member.hash, group.id, bytes),
    (error) => isSocialError(error) && error.code === "FORBIDDEN",
  );
  await assert.rejects(
    avatars.read(outsider.hash, group.id),
    (error) => isSocialError(error) && error.code === "NOT_FOUND",
  );
  await groups.leave(member.token, { groupId: group.id });
  await assert.rejects(
    avatars.read(member.hash, group.id),
    (error) => isSocialError(error) && error.code === "NOT_FOUND",
  );
  await avatars.save(owner.hash, group.id, null);
  assert.equal(
    (await groups.detail(owner.token, { groupId: group.id })).avatarRef,
    null,
  );
  await assert.rejects(avatars.read(owner.hash, group.id));
});
