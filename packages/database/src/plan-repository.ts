import type { PlanRepository } from "@merkat/backend";
import type { PlanView } from "@merkat/contracts";
import type { PrismaClient, Prisma } from "./generated/client.js";
import { authorize, chargeDiscovery, limit } from "./messaging-repository.js";
import { privacyFence, assertInteraction, isBlocked } from "./privacy-guard.js";
const include = {
  participants: { include: { user: { select: { profile: true } } } },
} as const;
function view(
  plan: Prisma.PlanGetPayload<{ include: typeof include }>,
): PlanView {
  return {
    id: plan.id,
    ownerId: plan.ownerId,
    title: plan.title,
    description: plan.description,
    location: plan.location,
    startsAt: plan.startsAt.toISOString(),
    endsAt: plan.endsAt.toISOString(),
    conversationId: plan.conversationId,
    cancelled: plan.cancelled,
    participants: plan.participants.map((p) => ({
      userId: p.userId,
      response: p.response,
      username: p.user.profile?.username ?? null,
      displayName: p.user.profile?.displayName ?? null,
    })),
  };
}
export function createPlanRepository(db: PrismaClient): PlanRepository {
  return {
    async list(userId) {
      return (
        await db.plan.findMany({
          where: { participants: { some: { userId } } },
          include,
          orderBy: [{ startsAt: "desc" }, { id: "desc" }],
          take: 100,
        })
      ).map(view);
    },
    async create(userId, input) {
      // Missing usernames must still consume a bounded discovery attempt.
      await db.$transaction((tx) => limit(tx, userId, "discovery"));
      return db.$transaction(async (tx) => {
        await privacyFence(tx);
        await limit(tx, userId, "managed");
        const names = [...new Set(input.usernames)];
        const people = await tx.profile.findMany({
          where: {
            username: { in: names },
            user: { status: "ACTIVE", onboardingCompletedAt: { not: null } },
          },
          select: { userId: true },
        });
        if (people.length !== names.length)
          throw new Error("PARTICIPANT_NOT_FOUND");
        const userIds = [...new Set([userId, ...people.map((p) => p.userId)])];
        for (const id of userIds)
          if (id !== userId) await assertInteraction(tx, userId, id);
        return view(
          await tx.plan.create({
            data: {
              ownerId: userId,
              title: input.title,
              description: input.description,
              location: input.location,
              startsAt: new Date(input.startsAt),
              endsAt: new Date(input.endsAt),
              conversationId: input.conversationId ?? null,
              participants: {
                create: userIds.map((id) => ({
                  userId: id,
                  response: id === userId ? "GOING" : "INVITED",
                })),
              },
            },
            include,
          }),
        );
      });
    },
    async respond(userId, planId, response) {
      const result = await db.planParticipant.updateMany({
        where: { userId, planId, plan: { cancelled: false } },
        data: { response },
      });
      return result.count === 1;
    },
    async cancel(userId, planId) {
      return (
        (
          await db.plan.updateMany({
            where: { id: planId, ownerId: userId },
            data: { cancelled: true },
          })
        ).count === 1
      );
    },
    async findPerson(username, hash) {
      await chargeDiscovery(db, hash);
      return db.$transaction(async (tx) => {
        const session = await authorize(tx, hash);
        await privacyFence(tx);
        const p = await tx.profile.findFirst({
          where: {
            username,
            user: { status: "ACTIVE", onboardingCompletedAt: { not: null } },
          },
          select: { userId: true, username: true, displayName: true },
        });
        return p && !(await isBlocked(tx, session.userId, p.userId))
          ? { id: p.userId, username: p.username, displayName: p.displayName }
          : null;
      });
    },
  };
}
