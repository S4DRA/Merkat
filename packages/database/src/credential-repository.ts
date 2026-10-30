import {
  AuthenticationError,
  type CredentialRepository,
} from "@merkat/backend";
import { Prisma, type PrismaClient } from "./generated/client.js";
import { account } from "./account-repository.js";

export function createCredentialRepository(
  db: PrismaClient,
): CredentialRepository {
  return {
    async register(profile, passwordHash, session, now) {
      try {
        return await db.$transaction(async (tx) => {
          const user = await tx.user.create({
            data: {
              email: profile.email ?? null,
              onboardingCompletedAt: now,
              profile: {
                create: {
                  username: profile.username,
                  displayName: profile.displayName ?? profile.username,
                },
              },
              passwordCredential: { create: { passwordHash } },
              sessions: {
                create: {
                  tokenHash: session.tokenHash,
                  expiresAt: session.expiresAt,
                },
              },
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
          throw new AuthenticationError("ACCOUNT_UNAVAILABLE");
        throw error;
      }
    },
    async findCredential(username) {
      const profile = await db.profile.findUnique({
        where: { username },
        select: {
          user: {
            select: {
              passwordCredential: {
                select: { userId: true, passwordHash: true },
              },
            },
          },
        },
      });
      return profile?.user.passwordCredential ?? null;
    },
    async login(credential, username, session, now, previousHash) {
      return db.$transaction(async (tx) => {
        // Match profile writes' session-before-user lock order during reauthentication.
        if (previousHash)
          await tx.$queryRaw`
          SELECT id FROM "Session" WHERE "tokenHash" = ${previousHash}
            AND "userId" = ${credential.userId}::uuid FOR UPDATE`;
        // Recheck everything after expensive verification; hold no locks while hashing.
        const locked = await tx.$queryRaw<{ id: string }[]>`
          SELECT u.id FROM "User" u
          JOIN "PasswordCredential" c ON c."userId" = u.id
          JOIN "Profile" p ON p."userId" = u.id
          WHERE u.id = ${credential.userId}::uuid AND u.status = 'ACTIVE'
            AND c."passwordHash" = ${credential.passwordHash} AND p.username = ${username}
          FOR UPDATE OF u, c, p`;
        if (!locked[0]) throw new AuthenticationError("INVALID_CREDENTIALS");
        if (previousHash)
          await tx.session.updateMany({
            where: {
              tokenHash: previousHash,
              userId: credential.userId,
              revokedAt: null,
            },
            data: { revokedAt: now },
          });
        await tx.session.create({
          data: {
            userId: credential.userId,
            tokenHash: session.tokenHash,
            expiresAt: session.expiresAt,
          },
        });
        return account(
          await tx.user.findUniqueOrThrow({
            where: { id: credential.userId },
            include: { profile: true },
          }),
        );
      });
    },
  };
}
