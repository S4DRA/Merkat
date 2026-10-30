import { FriendshipError, type FriendshipRepository } from "@merkat/backend";
import type { FriendView } from "@merkat/contracts";
import type { PrismaClient, Prisma } from "./generated/client.js";
import {
  authorize,
  limit,
  lockQuota,
  chargeDiscovery,
} from "./messaging-repository.js";
import { privacyFence, isBlocked } from "./privacy-guard.js";

const include = {
  firstUser: {
    select: { profile: { select: { displayName: true, username: true } } },
  },
  secondUser: {
    select: { profile: { select: { displayName: true, username: true } } },
  },
} as const;
type Friend = Prisma.FriendshipGetPayload<{ include: typeof include }>;
function view(friend: Friend, userId: string): FriendView {
  const peerId =
    friend.firstUserId === userId ? friend.secondUserId : friend.firstUserId;
  const profile = (
    friend.firstUserId === userId ? friend.secondUser : friend.firstUser
  ).profile;
  return {
    id: friend.id,
    person: {
      id: peerId,
      displayName: profile?.displayName ?? null,
      username: profile?.username ?? null,
    },
    requestedById: friend.requestedById,
    status: friend.status,
    createdAt: friend.createdAt.toISOString(),
    acceptedAt: friend.acceptedAt?.toISOString() ?? null,
  };
}
export function createFriendshipRepository(
  db: PrismaClient,
): FriendshipRepository {
  const run = <T>(
    hash: string,
    fn: (tx: Prisma.TransactionClient, userId: string) => Promise<T>,
    changing = false,
  ) =>
    db.$transaction(
      async (tx) => {
        const session = await authorize(tx, hash);
        await privacyFence(tx, changing);
        return fn(tx, session.userId);
      },
      { timeout: 10000 },
    );
  return {
    list(hash, input) {
      return run(hash, async (tx, userId) => {
        const pending = input.section !== "FRIENDS";
        const rows = await tx.friendship.findMany({
          where: {
            AND: [
              { OR: [{ firstUserId: userId }, { secondUserId: userId }] },
              { status: pending ? "PENDING" : "ACCEPTED" },
              ...(pending
                ? [
                    {
                      requestedById:
                        input.section === "OUTGOING" ? userId : { not: userId },
                    },
                  ]
                : []),
              ...(input.before
                ? [
                    {
                      OR: [
                        { createdAt: { lt: new Date(input.before.createdAt) } },
                        {
                          createdAt: new Date(input.before.createdAt),
                          id: { lt: input.before.id },
                        },
                      ],
                    },
                  ]
                : []),
            ],
          },
          include,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 31,
        });
        const page = rows.slice(0, 30);
        const last = page.at(-1);
        return {
          people: page.map((f) => view(f, userId)),
          nextCursor:
            rows.length > 30 && last
              ? { id: last.id, createdAt: last.createdAt.toISOString() }
              : null,
          incomingCount: await tx.friendship.count({
            where: {
              status: "PENDING",
              requestedById: { not: userId },
              OR: [{ firstUserId: userId }, { secondUserId: userId }],
            },
          }),
        };
      });
    },
    async request(hash, username) {
      await chargeDiscovery(db, hash);
      return run(
        hash,
        async (tx, userId) => {
          const person = await tx.profile.findFirst({
            where: {
              username,
              user: { status: "ACTIVE", onboardingCompletedAt: { not: null } },
            },
            select: { userId: true },
          });
          if (!person) throw new FriendshipError("NOT_FOUND");
          if (person.userId === userId)
            throw new FriendshipError("SELF_FRIENDSHIP");
          if (await isBlocked(tx, userId, person.userId))
            throw new FriendshipError("NOT_FOUND");
          await lockQuota(tx, userId);
          const [firstUserId, secondUserId] =
            userId < person.userId
              ? ([userId, person.userId] as const)
              : ([person.userId, userId] as const);
          const where = {
            firstUserId_secondUserId: { firstUserId, secondUserId },
          };
          const existing = await tx.friendship.findUnique({ where, include });
          if (existing) return view(existing, userId);
          if (
            (await tx.friendship.count({
              where: { requestedById: userId, status: "PENDING" },
            })) >= 50
          )
            throw new FriendshipError("PENDING_LIMIT");
          await limit(tx, userId, "friend");
          await tx.$executeRaw`INSERT INTO public."Friendship" ("firstUserId", "secondUserId", "requestedById") VALUES (${firstUserId}::uuid, ${secondUserId}::uuid, ${userId}::uuid) ON CONFLICT ("firstUserId", "secondUserId") DO NOTHING`;
          return view(
            await tx.friendship.findUniqueOrThrow({ where, include }),
            userId,
          );
        },
        true,
      );
    },
    act(hash, input) {
      return run(
        hash,
        async (tx, userId) => {
          const locked = await tx.$queryRaw<
            { id: string }[]
          >`SELECT id FROM public."Friendship" WHERE id = ${input.id}::uuid AND ("firstUserId" = ${userId}::uuid OR "secondUserId" = ${userId}::uuid) FOR UPDATE`;
          if (!locked[0]) throw new FriendshipError("NOT_FOUND");
          const friend = await tx.friendship.findUniqueOrThrow({
            where: { id: input.id },
          });
          const sender = friend.requestedById === userId;
          if (input.action === "ACCEPT" && !sender) {
            if (friend.status === "PENDING")
              await tx.$executeRaw`UPDATE public."Friendship" SET status = 'ACCEPTED', "acceptedAt" = clock_timestamp() WHERE id = ${friend.id}::uuid`;
            return;
          }
          if (
            (input.action === "DECLINE" &&
              !sender &&
              friend.status === "PENDING") ||
            (input.action === "CANCEL" &&
              sender &&
              friend.status === "PENDING") ||
            (input.action === "REMOVE" && friend.status === "ACCEPTED")
          ) {
            await tx.friendship.delete({ where: { id: friend.id } });
            return;
          }
          throw new FriendshipError("NOT_FOUND");
        },
        true,
      );
    },
  };
}
