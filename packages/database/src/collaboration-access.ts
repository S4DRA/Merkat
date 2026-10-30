import { randomUUID } from "node:crypto";
import { SocialError } from "@merkat/backend";
import type { ChatScope } from "@merkat/contracts";
import type { Prisma } from "./generated/client.js";
import { assertInteraction } from "./privacy-guard.js";
export type CollaborationTx = Prisma.TransactionClient;
/** Content access serializes with group removal and channel deletion. */
export async function chatAccess(
  tx: CollaborationTx,
  userId: string,
  scope: ChatScope,
  writing = false,
) {
  if (scope.kind === "DM") {
    const rows = await tx.$queryRaw<
      { firstUserId: string; secondUserId: string }[]
    >`SELECT "firstUserId","secondUserId" FROM "DirectConversation" WHERE id=${scope.id}::uuid AND ("firstUserId"=${userId}::uuid OR "secondUserId"=${userId}::uuid) FOR UPDATE`;
    const c = rows[0];
    if (!c) throw new SocialError("NOT_FOUND");
    if (writing)
      await assertInteraction(
        tx,
        userId,
        c.firstUserId === userId ? c.secondUserId : c.firstUserId,
      );
    const members = await tx.profile.findMany({
      where: { userId: { in: [c.firstUserId, c.secondUserId] } },
      select: { userId: true, displayName: true, username: true },
    });
    return {
      canManage: true,
      people: members.map((p) => ({
        id: p.userId,
        displayName: p.displayName ?? p.username ?? "Member",
        username: p.username ?? "",
      })),
    };
  }
  const rows = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM "ChatGroup" WHERE id=${scope.id}::uuid AND "archivedAt" IS NULL FOR UPDATE`;
  if (!rows[0]) throw new SocialError("NOT_FOUND");
  const own = await tx.groupMember.findUnique({
    where: { groupId_userId: { groupId: scope.id, userId } },
  });
  const channel = await tx.groupChannel.findFirst({
    where: { id: scope.channelId, groupId: scope.id, deletedAt: null },
  });
  if (!own || own.leftAt || !channel) throw new SocialError("NOT_FOUND");
  const members = await tx.groupMember.findMany({
    where: { groupId: scope.id, leftAt: null, user: { status: "ACTIVE" } },
    include: {
      user: {
        select: { profile: { select: { displayName: true, username: true } } },
      },
    },
  });
  return {
    canManage: own.role !== "MEMBER",
    people: members.map((m) => ({
      id: m.userId,
      displayName:
        m.user.profile?.displayName ?? m.user.profile?.username ?? "Member",
      username: m.user.profile?.username ?? "",
    })),
  };
}
export async function notifyPeople(tx: CollaborationTx, ids: string[]) {
  const exists = await tx.$queryRaw<
    { present: boolean }[]
  >`SELECT to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NOT NULL AS present`;
  if (!exists[0]?.present) return;
  for (const id of [...new Set(ids)])
    await tx.$queryRaw`SELECT realtime.send('{}'::jsonb,'changed',${`merkat:user:${id}`},true)::text`;
}
export async function publishFeature(
  tx: CollaborationTx,
  userId: string,
  scope: ChatScope,
  feature: { planId: string } | { tabId: string },
  text: string,
  clientId: string = randomUUID(),
) {
  if (scope.kind === "DM") {
    const c = await tx.directConversation.update({
      where: { id: scope.id },
      data: { lastSequence: { increment: 1 }, activityAt: new Date() },
    });
    await tx.directMessage.create({
      data: {
        conversationId: c.id,
        senderId: userId,
        clientId,
        sequence: c.lastSequence,
        text,
        ...feature,
      },
    });
    await tx.directParticipant.updateMany({
      where: { conversationId: c.id, userId: { not: userId } },
      data: { unreadCount: { increment: 1 } },
    });
  } else {
    const c = await tx.groupChannel.update({
      where: { id: scope.channelId },
      data: { lastSequence: { increment: 1 }, activityAt: new Date() },
    });
    await tx.groupMessage.create({
      data: {
        groupId: scope.id,
        channelId: c.id,
        senderId: userId,
        clientId,
        sequence: c.lastSequence,
        text,
        ...feature,
      },
    });
    await tx.chatGroup.update({
      where: { id: scope.id },
      data: { activityAt: new Date() },
    });
  }
}
export function scopeOf(row: {
  directId: string | null;
  groupId: string | null;
  channelId: string | null;
}): ChatScope | null {
  if (row.directId) return { kind: "DM", id: row.directId };
  if (row.groupId && row.channelId)
    return { kind: "GROUP", id: row.groupId, channelId: row.channelId };
  return null;
}
