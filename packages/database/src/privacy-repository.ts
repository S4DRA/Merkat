import { SocialError, type PrivacyRepository } from "@merkat/backend";
import type { Prisma, PrismaClient } from "./generated/client.js";
import { authorize, limit } from "./messaging-repository.js";
import { privacyFence, personView } from "./privacy-guard.js";
export function createPrivacyRepository(db: PrismaClient): PrivacyRepository {
  const run = <T>(
    hash: string,
    exclusive: boolean,
    fn: (tx: Prisma.TransactionClient, userId: string) => Promise<T>,
  ) =>
    db.$transaction(
      async (tx) => {
        const session = await authorize(tx, hash);
        await privacyFence(tx, exclusive);
        return fn(tx, session.userId);
      },
      { timeout: 10000 },
    );
  return {
    settings(hash) {
      return run(hash, false, async (tx, userId) => {
        const p = await tx.userPrivacy.findUnique({ where: { userId } });
        return {
          allowNonFriendDms: p?.allowNonFriendDms ?? true,
          groupInvitesFrom: p?.groupInvitesFrom ?? "FRIENDS",
        };
      });
    },
    update(hash, input) {
      return run(hash, true, async (tx, userId) => {
        await limit(tx, userId, "managed");
        const p = await tx.userPrivacy.upsert({
          where: { userId },
          create: { userId, ...input },
          update: input,
        });
        return {
          allowNonFriendDms: p.allowNonFriendDms,
          groupInvitesFrom: p.groupInvitesFrom,
        };
      });
    },
    blocks(hash, input) {
      return run(hash, false, async (tx, userId) => {
        const rows = await tx.userBlock.findMany({
          where: {
            blockerId: userId,
            ...(input.before
              ? {
                  OR: [
                    { createdAt: { lt: new Date(input.before.createdAt) } },
                    {
                      createdAt: new Date(input.before.createdAt),
                      blockedId: { lt: input.before.id },
                    },
                  ],
                }
              : {}),
          },
          include: {
            blocked: {
              select: {
                profile: { select: { username: true, displayName: true } },
              },
            },
          },
          orderBy: [{ createdAt: "desc" }, { blockedId: "desc" }],
          take: 31,
        });
        const page = rows.slice(0, 30),
          last = page.at(-1);
        return {
          people: page.map((b) => ({
            ...personView(b.blockedId, b.blocked.profile),
            createdAt: b.createdAt.toISOString(),
          })),
          nextCursor:
            rows.length > 30 && last
              ? { id: last.blockedId, createdAt: last.createdAt.toISOString() }
              : null,
        };
      });
    },
    block(hash, input) {
      return run(hash, true, async (tx, userId) => {
        if (input.userId === userId) throw new SocialError("INVALID_REQUEST");
        await limit(tx, userId, "managed");
        if (!input.blocked) {
          await tx.userBlock.deleteMany({
            where: { blockerId: userId, blockedId: input.userId },
          });
          return;
        }
        if (
          !(await tx.user.findUnique({
            where: { id: input.userId },
            select: { id: true },
          }))
        )
          throw new SocialError("NOT_FOUND");
        await tx.userBlock.upsert({
          where: {
            blockerId_blockedId: { blockerId: userId, blockedId: input.userId },
          },
          create: { blockerId: userId, blockedId: input.userId },
          update: {},
        });
        const [firstUserId, secondUserId] =
          userId < input.userId
            ? [userId, input.userId]
            : [input.userId, userId];
        await tx.friendship.deleteMany({
          where: { firstUserId, secondUserId },
        });
        await tx.groupInvitation.deleteMany({
          where: {
            OR: [
              { invitedBy: userId, userId: input.userId },
              { invitedBy: input.userId, userId },
              { userId: input.userId, group: { ownerId: userId } },
              { userId, group: { ownerId: input.userId } },
            ],
          },
        });
      });
    },
    report(hash, input) {
      return run(hash, false, async (tx, userId) => {
        await limit(tx, userId, "report");
        if (input.target.kind === "GROUP") {
          if (
            !(await tx.chatGroup.findFirst({
              where: {
                id: input.target.id,
                OR: [
                  { members: { some: { userId, leftAt: null } } },
                  { invitations: { some: { userId } } },
                ],
              },
              select: { id: true },
            }))
          )
            throw new SocialError("NOT_FOUND");
        } else {
          if (input.target.id === userId)
            throw new SocialError("INVALID_REQUEST");
          const known = await tx.user.findFirst({
            where: {
              id: input.target.id,
              OR: [
                { directFirst: { some: { secondUserId: userId } } },
                { directSecond: { some: { firstUserId: userId } } },
                { friendsFirst: { some: { secondUserId: userId } } },
                { friendsSecond: { some: { firstUserId: userId } } },
                { blockedBy: { some: { blockerId: userId } } },
                {
                  groupMemberships: {
                    some: {
                      leftAt: null,
                      group: { members: { some: { userId, leftAt: null } } },
                    },
                  },
                },
              ],
            },
            select: { id: true },
          });
          if (!known) throw new SocialError("NOT_FOUND");
        }
        const targetUserId =
            input.target.kind === "USER" ? input.target.id : null,
          targetGroupId =
            input.target.kind === "GROUP" ? input.target.id : null;
        // No RETURNING or report reads: the runtime's report privilege is INSERT only.
        await tx.$executeRaw`INSERT INTO public."SafetyReport" ("reporterId","clientId","targetUserId","targetGroupId",category,reason) VALUES (${userId}::uuid,${input.clientId}::uuid,${targetUserId}::uuid,${targetGroupId}::uuid,${input.category},${input.reason}) ON CONFLICT DO NOTHING`;
      });
    },
  };
}
