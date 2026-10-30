import { AccountError, type AccountRepository } from "@merkat/backend";
import type { Account } from "@merkat/contracts";
import {
  Prisma,
  type PrismaClient,
  type User,
  type Profile,
} from "./generated/client.js";

export function account(user: User & { profile: Profile | null }): Account {
  if (!user.profile) throw new Error("Account profile missing");
  return {
    id: user.id,
    onboardingComplete: !!user.onboardingCompletedAt,
    profile: {
      displayName: user.profile.displayName,
      username: user.profile.username,
      bio: user.profile.bio,
      avatarRef: user.profile.avatarRef,
    },
  };
}
const activeSession = (tokenHash: string, now: Date) => ({
  tokenHash,
  revokedAt: null,
  expiresAt: { gt: now },
  user: { status: "ACTIVE" as const },
});

export function createAccountRepository(db: PrismaClient): AccountRepository {
  return {
    async signIn(identity, tokenHash, expiresAt, now, previousHash) {
      // A concurrent first login may lose the unique identity race. Retry the entire transaction once.
      for (let attempt = 0; ; attempt++) {
        try {
          return await db.$transaction(async (tx) => {
            const external = await tx.externalIdentity.upsert({
              where: { issuer_subject: identity },
              update: {},
              create: {
                ...identity,
                user: { create: { profile: { create: {} } } },
              },
              include: { user: { include: { profile: true } } },
            });
            if (external.user.status !== "ACTIVE")
              throw new AccountError("UNAUTHORIZED");
            if (previousHash)
              await tx.session.updateMany({
                where: {
                  tokenHash: previousHash,
                  userId: external.userId,
                  revokedAt: null,
                },
                data: { revokedAt: now },
              });
            await tx.session.create({
              data: { userId: external.userId, tokenHash, expiresAt },
            });
            return account(external.user);
          });
        } catch (error) {
          if (
            attempt === 0 &&
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2002"
          )
            continue;
          throw error;
        }
      }
    },
    async findSession(tokenHash, now) {
      const session = await db.session.findFirst({
        where: activeSession(tokenHash, now),
        include: { user: { include: { profile: true } } },
      });
      return session ? account(session.user) : null;
    },
    async revokeSession(tokenHash, now) {
      await db.session.updateMany({
        where: { tokenHash, revokedAt: null },
        data: { revokedAt: now },
      });
    },
    async rotateSession(oldHash, newHash, now) {
      return db.$transaction(async (tx) => {
        const session = await tx.session.findFirst({
          where: activeSession(oldHash, now),
        });
        if (!session) return null;
        const result = await tx.session.updateMany({
          where: activeSession(oldHash, now),
          data: { revokedAt: now },
        });
        if (result.count !== 1) return null;
        await tx.session.create({
          data: {
            tokenHash: newHash,
            userId: session.userId,
            expiresAt: session.expiresAt,
          },
        });
        return session.expiresAt;
      });
    },
    async saveProfile(tokenHash, now, profile) {
      try {
        return await db.$transaction(async (tx) => {
          // Lock the session while changing account state so revocation cannot race past authorization.
          const locked = await tx.$queryRaw<
            { userId: string; onboardingCompletedAt: Date | null }[]
          >`SELECT s."userId", u."onboardingCompletedAt" FROM "Session" s JOIN "User" u ON u.id = s."userId" WHERE s."tokenHash" = ${tokenHash} AND s."revokedAt" IS NULL AND s."expiresAt" > ${now} AND u.status = 'ACTIVE' FOR UPDATE OF s, u`;
          const session = locked[0];
          if (!session) throw new AccountError("UNAUTHORIZED");
          await tx.profile.update({
            where: { userId: session.userId },
            data: profile,
          });
          const user = await tx.user.update({
            where: { id: session.userId },
            data: {
              onboardingCompletedAt: session.onboardingCompletedAt ?? now,
            },
            include: { profile: true },
          });
          return account(user);
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        )
          throw new AccountError("USERNAME_UNAVAILABLE");
        throw error;
      }
    },
  };
}
