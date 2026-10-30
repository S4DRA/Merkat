import { createHash } from "node:crypto";
import { SocialError } from "@merkat/backend";
import type { PrismaClient, Prisma } from "./generated/client.js";
import { authorize, limit } from "./messaging-repository.js";
import { member, manager } from "./group-repository.js";
export function createGroupAvatarRepository(db: PrismaClient) {
  const run = <T>(
    hash: string,
    groupId: string,
    writing: boolean,
    fn: (tx: Prisma.TransactionClient, userId: string) => Promise<T>,
    charge = false,
  ) =>
    db.$transaction(async (tx) => {
      const session = await authorize(tx, hash);
      if (charge) await limit(tx, session.userId, "managed");
      const own = await member(tx, session.userId, groupId, writing);
      if (writing) manager(own.role);
      return fn(tx, session.userId);
    });
  return {
    reserve(hash: string, groupId: string) {
      return run(hash, groupId, true, async () => {}, true);
    },
    read(hash: string, groupId: string) {
      return run(hash, groupId, false, async (tx) => {
        const avatar = await tx.groupAvatar.findUnique({ where: { groupId } });
        if (!avatar) throw new SocialError("NOT_FOUND");
        return avatar;
      });
    },
    save(hash: string, groupId: string, bytes: Uint8Array | null) {
      return run(hash, groupId, true, async (tx) => {
        if (!bytes) {
          await tx.groupAvatar.deleteMany({ where: { groupId } });
          await tx.chatGroup.update({
            where: { id: groupId },
            data: { activityAt: new Date() },
          });
          return null;
        }
        const version = createHash("sha256").update(bytes).digest("hex");
        const content = new Uint8Array(bytes);
        await tx.groupAvatar.upsert({
          where: { groupId },
          create: { groupId, bytes: content, version },
          update: { bytes: content, version },
        });
        await tx.chatGroup.update({
          where: { id: groupId },
          data: { activityAt: new Date() },
        });
        return `/api/groups/${groupId}/avatar?v=${version}`;
      });
    },
  };
}
