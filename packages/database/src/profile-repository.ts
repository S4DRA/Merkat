import { createHash } from "node:crypto";
import { SocialError } from "@merkat/backend";
import {
  defaultAppearance,
  type Appearance,
  type PublicProfile,
} from "@merkat/contracts";
import type { Prisma, PrismaClient } from "./generated/client.js";
import { authorize, limit } from "./messaging-repository.js";
import { privacyFence, isBlocked } from "./privacy-guard.js";

type Tx = Prisma.TransactionClient;
async function related(tx: Tx, viewer: string, target: string) {
  if (viewer === target) return;
  if (await isBlocked(tx, viewer, target)) throw new SocialError("NOT_FOUND");
  const [friend, direct, group] = await Promise.all([
    tx.friendship.findFirst({
      where: {
        status: "ACCEPTED",
        OR: [
          { firstUserId: viewer, secondUserId: target },
          { firstUserId: target, secondUserId: viewer },
        ],
      },
      select: { id: true },
    }),
    tx.directConversation.findFirst({
      where: {
        AND: [
          { participants: { some: { userId: viewer } } },
          { participants: { some: { userId: target } } },
        ],
      },
      select: { id: true },
    }),
    tx.chatGroup.findFirst({
      where: {
        archivedAt: null,
        AND: [
          { members: { some: { userId: viewer, leftAt: null } } },
          { members: { some: { userId: target, leftAt: null } } },
        ],
      },
      select: { id: true },
    }),
  ]);
  if (!friend && !direct && !group) throw new SocialError("NOT_FOUND");
}
export function createProfileRepository(db: PrismaClient) {
  const run = <T>(hash: string, fn: (tx: Tx, userId: string) => Promise<T>) =>
    db.$transaction(async (tx) => {
      const session = await authorize(tx, hash);
      await privacyFence(tx);
      return fn(tx, session.userId);
    });
  return {
    view(hash: string, target: string): Promise<PublicProfile> {
      return run(hash, async (tx, viewer) => {
        await related(tx, viewer, target);
        const p = await tx.profile.findFirst({
          where: { userId: target, user: { status: "ACTIVE" } },
        });
        if (!p) throw new SocialError("NOT_FOUND");
        return {
          id: p.userId,
          username: p.username,
          displayName: p.displayName,
          bio: p.bio,
          avatarRef: p.avatarRef,
        };
      });
    },
    settings(hash: string) {
      return run(hash, async (tx, userId): Promise<Appearance> => {
        const s = await tx.userSettings.findUnique({ where: { userId } });
        return s
          ? {
              theme: s.theme as Appearance["theme"],
              reduceMotion: s.reduceMotion,
              largeText: s.largeText,
              remindersEnabled: s.remindersEnabled,
              pushEnabled: s.pushEnabled,
              timezone: s.timezone,
            }
          : defaultAppearance;
      });
    },
    updateSettings(hash: string, input: Appearance) {
      return run(hash, async (tx, userId) => {
        await limit(tx, userId, "managed");
        const previous = await tx.userSettings.findUnique({
          where: { userId },
          select: { remindersEnabled: true },
        });
        await tx.userSettings.upsert({
          where: { userId },
          create: { userId, ...input },
          update: input,
        });
        if (!input.remindersEnabled)
          await tx.planReminder.updateMany({
            where: { userId, state: "PENDING" },
            data: { state: "CANCELLED" },
          });
        else if (previous?.remindersEnabled === false) {
          await tx.$executeRaw`WITH eligible AS (SELECT p.id,p.version,p."startsAt" FROM "Plan" p JOIN "PlanParticipant" a ON a."planId"=p.id AND a."userId"=${userId}::uuid AND a.subscribed=true WHERE p.cancelled=false AND p."startsAt">clock_timestamp() AND (p."groupId" IS NULL OR EXISTS(SELECT 1 FROM "GroupMember" m JOIN "ChatGroup" g ON g.id=m."groupId" WHERE m."groupId"=p."groupId" AND m."userId"=${userId}::uuid AND m."leftAt" IS NULL AND g."archivedAt" IS NULL)) ORDER BY p.id FOR UPDATE OF p) INSERT INTO "PlanReminder"(id,"planId","userId",version,"hoursBefore","dueAt",state) SELECT gen_random_uuid(),e.id,${userId}::uuid,e.version,h.hours,e."startsAt"-(h.hours*interval '1 hour'),'PENDING' FROM eligible e CROSS JOIN (VALUES(24),(5))h(hours) WHERE e."startsAt"-(h.hours*interval '1 hour')>clock_timestamp() ON CONFLICT("planId","userId",version,"hoursBefore") DO UPDATE SET state='PENDING',"dueAt"=EXCLUDED."dueAt" WHERE "PlanReminder".state='CANCELLED'`;
        }
        return input;
      });
    },
    reserveAvatarUpload(hash: string) {
      return run(hash, async (tx, userId) => {
        await limit(tx, userId, "managed");
      });
    },
    saveAvatar(hash: string, bytes: Uint8Array | null) {
      return run(hash, async (tx, userId) => {
        let avatarRef: string | null = null;
        if (bytes) {
          const version = createHash("sha256").update(bytes).digest("hex");
          const content = new Uint8Array(bytes);
          await tx.profileAvatar.upsert({
            where: { userId },
            create: { userId, bytes: content, version },
            update: { bytes: content, version },
          });
          avatarRef = `/api/avatars/${userId}?v=${version}`;
        } else await tx.profileAvatar.deleteMany({ where: { userId } });
        await tx.profile.update({ where: { userId }, data: { avatarRef } });
        return { avatarRef };
      });
    },
    avatar(hash: string, target: string) {
      return run(hash, async (tx, userId) => {
        await related(tx, userId, target);
        const avatar = await tx.profileAvatar.findFirst({
          where: { userId: target, user: { status: "ACTIVE" } },
        });
        if (!avatar) throw new SocialError("NOT_FOUND");
        return avatar;
      });
    },
  };
}
