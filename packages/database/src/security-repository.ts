import { createHash, randomBytes } from "node:crypto";
import {
  AuthenticationError,
  createPasswordHasher,
  SocialError,
} from "@merkat/backend";
import { passwordSchema, usernameFormatSchema } from "@merkat/contracts";
import { z } from "zod";
import type { PrismaClient } from "./generated/client.js";
import { authorize } from "./messaging-repository.js";
const hashCode = (code: string) =>
  createHash("sha256")
    .update(code.replaceAll("-", "").toUpperCase())
    .digest("hex");
const currentPasswordSchema = z
  .object({ currentPassword: z.string().min(1).max(128) })
  .strict();
const changeSchema = currentPasswordSchema.extend({
  newPassword: passwordSchema,
});
const recoverySchema = z
  .object({
    username: usernameFormatSchema,
    code: z.string().trim().min(1).max(80),
    newPassword: passwordSchema,
  })
  .strict();
function input<T>(schema: z.ZodType<T>, raw: unknown): T {
  const p = schema.safeParse(raw);
  if (!p.success) throw new SocialError("INVALID_REQUEST");
  return p.data;
}
export function createSecurityRepository(db: PrismaClient) {
  const passwords = createPasswordHasher();
  async function credential(hash: string, currentPassword: string) {
    const s = await db.session.findFirst({
      where: {
        tokenHash: hash,
        revokedAt: null,
        expiresAt: { gt: new Date() },
        user: { status: "ACTIVE" },
      },
      include: { user: { select: { passwordCredential: true } } },
    });
    const c = s?.user.passwordCredential;
    if (!(await passwords.verify(currentPassword, c?.passwordHash)) || !s || !c)
      throw new AuthenticationError("INVALID_CREDENTIALS");
    return { userId: s.userId, passwordHash: c.passwordHash };
  }
  return {
    async status(hash: string) {
      const s = await db.$transaction((tx) => authorize(tx, hash));
      return {
        remainingCodes: await db.recoveryCode.count({
          where: { userId: s.userId, usedAt: null },
        }),
      };
    },
    async generate(hash: string, raw: unknown) {
      const data = input(currentPasswordSchema, raw),
        expected = await credential(hash, data.currentPassword);
      const codes = Array.from(
        { length: 8 },
        () =>
          `MK-${randomBytes(16).toString("hex").toUpperCase().match(/.{8}/g)!.join("-")}`,
      );
      await db.$transaction(async (tx) => {
        const s = await authorize(tx, hash);
        await tx.$queryRaw`SELECT "userId" FROM "PasswordCredential" WHERE "userId"=${s.userId}::uuid FOR UPDATE`;
        const c = await tx.passwordCredential.findUnique({
          where: { userId: s.userId },
        });
        if (c?.passwordHash !== expected.passwordHash)
          throw new AuthenticationError("INVALID_CREDENTIALS");
        await tx.recoveryCode.deleteMany({ where: { userId: s.userId } });
        await tx.recoveryCode.createMany({
          data: codes.map((code) => ({
            userId: s.userId,
            codeHash: hashCode(code),
          })),
        });
      });
      return { codes };
    },
    async change(hash: string, raw: unknown) {
      const data = input(changeSchema, raw),
        expected = await credential(hash, data.currentPassword),
        passwordHash = await passwords.hash(data.newPassword);
      await db.$transaction(async (tx) => {
        const s = await authorize(tx, hash);
        await tx.$queryRaw`SELECT "userId" FROM "PasswordCredential" WHERE "userId"=${s.userId}::uuid FOR UPDATE`;
        const result = await tx.passwordCredential.updateMany({
          where: { userId: s.userId, passwordHash: expected.passwordHash },
          data: { passwordHash },
        });
        if (result.count !== 1)
          throw new AuthenticationError("INVALID_CREDENTIALS");
        await tx.session.updateMany({
          where: {
            userId: s.userId,
            tokenHash: { not: hash },
            revokedAt: null,
          },
          data: { revokedAt: new Date() },
        });
        await tx.recoveryCode.deleteMany({ where: { userId: s.userId } });
      });
      return { ok: true };
    },
    async recover(raw: unknown) {
      const data = input(recoverySchema, raw),
        passwordHash = await passwords.hash(data.newPassword),
        codeHash = hashCode(data.code);
      await db.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<
          { userId: string }[]
        >`SELECT r."userId" FROM "RecoveryCode" r JOIN "Profile" p ON p."userId"=r."userId" JOIN "User" u ON u.id=r."userId" WHERE r."codeHash"=${codeHash} AND r."usedAt" IS NULL AND p.username=${data.username} AND u.status='ACTIVE' FOR UPDATE OF u,r`;
        const userId = rows[0]?.userId;
        if (!userId) throw new AuthenticationError("INVALID_CREDENTIALS");
        const used = await tx.recoveryCode.updateMany({
          where: { codeHash, userId, usedAt: null },
          data: { usedAt: new Date() },
        });
        if (used.count !== 1)
          throw new AuthenticationError("INVALID_CREDENTIALS");
        await tx.passwordCredential.update({
          where: { userId },
          data: { passwordHash },
        });
        await tx.session.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      });
      return { ok: true };
    },
  };
}
