import { randomUUID } from "node:crypto";
import {
  SocialError,
  isSocialError,
  type GroupRepository,
} from "@merkat/backend";
import type {
  GroupDetail,
  GroupSummary,
  GroupMessageView,
  GroupChannelView,
} from "@merkat/contracts";
import { Prisma, type PrismaClient } from "./generated/client.js";
import {
  authorize,
  limit,
  lockQuota,
  chargeDiscovery,
} from "./messaging-repository.js";
import {
  privacyFence,
  invitationAllowed,
  personView,
} from "./privacy-guard.js";
type Tx = Prisma.TransactionClient;
const profileSelect = { username: true, displayName: true } as const;
const messageInclude = {
  sender: {
    include: { user: { select: { profile: { select: profileSelect } } } },
  },
  replyTo: { select: { id: true, text: true, senderId: true } },
} as const;
type Message = Prisma.GroupMessageGetPayload<{
  include: typeof messageInclude;
}>;
function messageView(m: Message): GroupMessageView {
  return {
    feature: m.planId
      ? { kind: "EVENT", id: m.planId }
      : m.tabId
        ? { kind: "TAB", id: m.tabId }
        : null,
    id: m.id,
    groupId: m.groupId,
    channelId: m.channelId,
    senderId: m.senderId,
    sender: personView(m.senderId, m.sender.user.profile),
    clientId: m.clientId,
    sequence: m.sequence,
    text: m.text,
    createdAt: m.createdAt.toISOString(),
    replyTo: m.replyTo,
  };
}
async function member(tx: Tx, userId: string, groupId: string, write = false) {
  const rows = write
    ? await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM public."ChatGroup" WHERE id=${groupId}::uuid AND "archivedAt" IS NULL FOR UPDATE`
    : await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM public."ChatGroup" WHERE id=${groupId}::uuid AND "archivedAt" IS NULL FOR SHARE`;
  if (!rows[0]) throw new SocialError("NOT_FOUND");
  const own = await tx.groupMember.findFirst({
    where: { groupId, userId, leftAt: null },
  });
  if (!own) throw new SocialError("NOT_FOUND");
  return own;
}
function manager(role: string) {
  if (role !== "OWNER" && role !== "ADMIN") throw new SocialError("FORBIDDEN");
}
async function channel(tx: Tx, groupId: string, channelId: string) {
  const c = await tx.groupChannel.findFirst({
    where: { id: channelId, groupId, deletedAt: null },
  });
  if (!c) throw new SocialError("NOT_FOUND");
  return c;
}
async function detail(
  tx: Tx,
  userId: string,
  groupId: string,
): Promise<GroupDetail> {
  const g = await tx.chatGroup.findUniqueOrThrow({
    where: { id: groupId },
    include: {
      members: {
        where: { leftAt: null },
        include: { user: { select: { profile: { select: profileSelect } } } },
        orderBy: [{ joinedAt: "asc" }, { userId: "asc" }],
      },
      channels: {
        where: { deletedAt: null },
        orderBy: [{ position: "asc" }, { id: "asc" }],
        include: { readStates: { where: { userId } } },
      },
    },
  });
  const own = g.members.find((m) => m.userId === userId);
  if (!own || g.archivedAt) throw new SocialError("NOT_FOUND");
  const unread = await tx.$queryRaw<
    { id: string; unread: number }[]
  >`SELECT c.id,count(m.id)::integer AS unread FROM public."GroupChannel" c LEFT JOIN public."GroupReadState" r ON r."channelId"=c.id AND r."userId"=${userId}::uuid LEFT JOIN public."GroupMessage" m ON m."channelId"=c.id AND m.sequence>COALESCE(r."readSequence",0) AND m."senderId"<>${userId}::uuid WHERE c."groupId"=${groupId}::uuid AND c."deletedAt" IS NULL GROUP BY c.id`;
  const counts = new Map(unread.map((r) => [r.id, r.unread]));
  const channels: GroupChannelView[] = g.channels.map((c) => ({
    id: c.id,
    name: c.name,
    position: c.position,
    isDefault: c.isDefault,
    lastSequence: c.lastSequence,
    unreadCount: counts.get(c.id) ?? 0,
    readSequence: c.readStates[0]?.readSequence ?? 0,
    deliveredSequence: c.readStates[0]?.deliveredSequence ?? 0,
  }));
  const invites =
    own.role === "MEMBER"
      ? []
      : await tx.groupInvitation.findMany({
          where: { groupId },
          include: { user: { select: { profile: { select: profileSelect } } } },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: 50,
        });
  const general = channels.find((c) => c.isDefault);
  if (!general) throw Error("Missing default group channel");
  return {
    id: g.id,
    name: g.name,
    description: g.description,
    role: own.role,
    activityAt: g.activityAt.toISOString(),
    memberCount: g.members.length,
    unreadCount: channels.reduce((sum, c) => sum + c.unreadCount, 0),
    defaultChannelId: general.id,
    channels,
    members: g.members.map((m) => ({
      ...personView(m.userId, m.user.profile),
      role: m.role,
      joinedAt: m.joinedAt.toISOString(),
    })),
    invitations: invites.map((i) => ({
      id: i.id,
      person: personView(i.userId, i.user.profile),
    })),
  };
}
function summary(g: GroupDetail): GroupSummary {
  return {
    id: g.id,
    name: g.name,
    description: g.description,
    role: g.role,
    activityAt: g.activityAt,
    memberCount: g.memberCount,
    unreadCount: g.unreadCount,
    defaultChannelId: g.defaultChannelId,
  };
}
async function invite(
  tx: Tx,
  actor: string,
  groupId: string,
  username: string,
) {
  const g = await tx.chatGroup.findUniqueOrThrow({ where: { id: groupId } });
  const p = await tx.profile.findFirst({
    where: {
      username,
      user: { status: "ACTIVE", onboardingCompletedAt: { not: null } },
    },
    select: { userId: true },
  });
  if (!p || !(await invitationAllowed(tx, actor, g.ownerId, p.userId)))
    throw new SocialError("NOT_FOUND");
  if (
    await tx.groupMember.findFirst({
      where: { groupId, userId: p.userId, leftAt: null },
    })
  )
    return;
  const existing = await tx.groupInvitation.findUnique({
    where: { groupId_userId: { groupId, userId: p.userId } },
  });
  if (existing) return;
  if (
    (await tx.groupInvitation.count({ where: { groupId } })) >= 50 ||
    (await tx.groupInvitation.count({ where: { invitedBy: actor } })) >= 50
  )
    throw new SocialError("LIMIT_REACHED");
  await limit(tx, actor, "friend");
  await tx.groupInvitation.create({
    data: { groupId, userId: p.userId, invitedBy: actor },
  });
}
export function createGroupRepository(db: PrismaClient): GroupRepository {
  const run = <T>(hash: string, fn: (tx: Tx, userId: string) => Promise<T>) =>
    db.$transaction(
      async (tx) => {
        const session = await authorize(tx, hash);
        await privacyFence(tx);
        return fn(tx, session.userId);
      },
      { timeout: 15000 },
    );
  return {
    list(hash, input) {
      return run(hash, async (tx, userId) => {
        const rows = await tx.chatGroup.findMany({
          where: {
            archivedAt: null,
            members: { some: { userId, leftAt: null } },
            ...(input.before
              ? {
                  OR: [
                    { activityAt: { lt: new Date(input.before.activityAt) } },
                    {
                      activityAt: new Date(input.before.activityAt),
                      id: { lt: input.before.id },
                    },
                  ],
                }
              : {}),
          },
          select: { id: true, activityAt: true },
          orderBy: [{ activityAt: "desc" }, { id: "desc" }],
          take: 31,
        });
        const page = rows.slice(0, 30);
        const groups: GroupSummary[] = [];
        // Lock all visible groups in UUID order before any detail reads.
        const visible = new Set<string>();
        for (const row of [...page].sort((a, b) => a.id.localeCompare(b.id))) {
          try {
            await member(tx, userId, row.id);
            visible.add(row.id);
          } catch (error) {
            if (!isSocialError(error) || error.code !== "NOT_FOUND")
              throw error;
          }
        }
        for (const row of page)
          if (visible.has(row.id))
            groups.push(summary(await detail(tx, userId, row.id)));
        const invites = await tx.groupInvitation.findMany({
          where: { userId, group: { archivedAt: null } },
          include: {
            group: { select: { name: true } },
            inviter: { select: { profile: { select: profileSelect } } },
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 31,
        });
        const last = page.at(-1);
        return {
          groups,
          nextCursor:
            rows.length > 30 && last
              ? { activityAt: last.activityAt.toISOString(), id: last.id }
              : null,
          invitations: invites.slice(0, 30).map((i) => ({
            id: i.id,
            groupId: i.groupId,
            groupName: i.group.name,
            invitedBy: personView(i.invitedBy, i.inviter.profile),
            createdAt: i.createdAt.toISOString(),
          })),
          hasMoreInvitations: invites.length > 30,
        };
      });
    },
    async create(hash, input) {
      if (input.usernames.length) await chargeDiscovery(db, hash);
      return run(hash, async (tx, userId) => {
        await lockQuota(tx, userId);
        const existing = await tx.chatGroup.findUnique({
          where: {
            createdById_clientId: {
              createdById: userId,
              clientId: input.clientId,
            },
          },
        });
        if (existing) {
          await member(tx, userId, existing.id);
          return detail(tx, userId, existing.id);
        }
        await limit(tx, userId, "started");
        if (
          (await tx.groupMember.count({
            where: { userId, leftAt: null, group: { archivedAt: null } },
          })) >= 100
        )
          throw new SocialError("LIMIT_REACHED");
        const g = await tx.chatGroup.create({
          data: {
            ownerId: userId,
            createdById: userId,
            clientId: input.clientId,
            name: input.name,
            description: input.description,
          },
        });
        await tx.groupMember.create({
          data: { groupId: g.id, userId, role: "OWNER" },
        });
        await tx.groupChannel.create({
          data: {
            groupId: g.id,
            clientId: randomUUID(),
            name: "general",
            position: 0,
            isDefault: true,
          },
        });
        for (const name of [...new Set(input.usernames)])
          await invite(tx, userId, g.id, name);
        return detail(tx, userId, g.id);
      });
    },
    detail(hash, groupId) {
      return run(hash, async (tx, userId) => {
        await member(tx, userId, groupId);
        return detail(tx, userId, groupId);
      });
    },
    edit(hash, input) {
      return run(hash, async (tx, userId) => {
        await limit(tx, userId, "managed");
        const own = await member(tx, userId, input.groupId, true);
        manager(own.role);
        await tx.chatGroup.update({
          where: { id: input.groupId },
          data: { name: input.name, description: input.description },
        });
        return detail(tx, userId, input.groupId);
      });
    },
    async invite(hash, input) {
      await chargeDiscovery(db, hash);
      return run(hash, async (tx, userId) => {
        await lockQuota(tx, userId);
        const own = await member(tx, userId, input.groupId, true);
        manager(own.role);
        await invite(tx, userId, input.groupId, input.username);
      });
    },
    invitation(hash, input) {
      return run(hash, async (tx, userId) => {
        await limit(tx, userId, "managed");
        const candidate = await tx.groupInvitation.findUnique({
          where: { id: input.id },
        });
        if (!candidate) throw new SocialError("NOT_FOUND");
        if (input.action === "REVOKE") {
          const own = await member(tx, userId, candidate.groupId, true);
          manager(own.role);
          await tx.groupInvitation.deleteMany({
            where: { id: input.id, groupId: candidate.groupId },
          });
          return;
        }
        if (candidate.userId !== userId) throw new SocialError("NOT_FOUND");
        const rows = await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM public."ChatGroup" WHERE id=${candidate.groupId}::uuid AND "archivedAt" IS NULL FOR UPDATE`;
        if (!rows[0]) throw new SocialError("NOT_FOUND");
        const current = await tx.groupInvitation.findUnique({
          where: { id: input.id },
        });
        if (!current) throw new SocialError("NOT_FOUND");
        if (input.action === "ACCEPT") {
          const g = await tx.chatGroup.findUniqueOrThrow({
            where: { id: current.groupId },
          });
          const inviter = await tx.groupMember.findFirst({
            where: {
              groupId: g.id,
              userId: current.invitedBy,
              leftAt: null,
              role: { in: ["OWNER", "ADMIN"] },
            },
          });
          if (
            !inviter ||
            !(await invitationAllowed(tx, current.invitedBy, g.ownerId, userId))
          )
            throw new SocialError("NOT_FOUND");
          if (
            (await tx.groupMember.count({
              where: { groupId: g.id, leftAt: null },
            })) >= 100 ||
            (await tx.groupMember.count({
              where: { userId, leftAt: null, group: { archivedAt: null } },
            })) >= 100
          )
            throw new SocialError("LIMIT_REACHED");
          await tx.groupMember.upsert({
            where: { groupId_userId: { groupId: g.id, userId } },
            create: { groupId: g.id, userId },
            update: { role: "MEMBER", joinedAt: new Date(), leftAt: null },
          });
          const channels = await tx.groupChannel.findMany({
            where: { groupId: g.id, deletedAt: null },
            select: { id: true, lastSequence: true },
          });
          for (const c of channels)
            await tx.groupReadState.upsert({
              where: { channelId_userId: { channelId: c.id, userId } },
              create: {
                channelId: c.id,
                userId,
                readSequence: c.lastSequence,
                deliveredSequence: c.lastSequence,
              },
              update: {
                readSequence: c.lastSequence,
                deliveredSequence: c.lastSequence,
              },
            });
        }
        await tx.groupInvitation.delete({ where: { id: input.id } });
      });
    },
    member(hash, input) {
      return run(hash, async (tx, userId) => {
        await limit(tx, userId, "managed");
        const own = await member(tx, userId, input.groupId, true);
        manager(own.role);
        const target = await tx.groupMember.findFirst({
          where: { groupId: input.groupId, userId: input.userId, leftAt: null },
        });
        if (!target) throw new SocialError("NOT_FOUND");
        if (
          target.userId === userId ||
          target.role === "OWNER" ||
          (own.role === "ADMIN" &&
            (target.role !== "MEMBER" || input.action !== "REMOVE"))
        )
          throw new SocialError("FORBIDDEN");
        const where = {
          groupId_userId: { groupId: input.groupId, userId: input.userId },
        };
        if (input.action === "REMOVE")
          await tx.groupMember.update({
            where,
            data: { leftAt: new Date(), role: "MEMBER" },
          });
        else if (input.action === "TRANSFER") {
          if (
            !(await tx.user.findFirst({
              where: {
                id: input.userId,
                status: "ACTIVE",
                onboardingCompletedAt: { not: null },
              },
              select: { id: true },
            }))
          )
            throw new SocialError("NOT_FOUND");
          await tx.groupMember.update({
            where: { groupId_userId: { groupId: input.groupId, userId } },
            data: { role: "ADMIN" },
          });
          await tx.groupMember.update({ where, data: { role: "OWNER" } });
          await tx.chatGroup.update({
            where: { id: input.groupId },
            data: { ownerId: input.userId },
          });
        } else
          await tx.groupMember.update({ where, data: { role: input.action } });
        // Invitations from a removed/demoted manager cannot be accepted later.
        if (input.action === "REMOVE" || input.action === "MEMBER")
          await tx.groupInvitation.deleteMany({
            where: { groupId: input.groupId, invitedBy: input.userId },
          });
        return detail(tx, userId, input.groupId);
      });
    },
    leave(hash, groupId) {
      return run(hash, async (tx, userId) => {
        await limit(tx, userId, "managed");
        const own = await member(tx, userId, groupId, true);
        if (own.role === "OWNER") {
          if (
            (await tx.groupMember.count({ where: { groupId, leftAt: null } })) >
            1
          )
            throw new SocialError("OWNER_TRANSFER_REQUIRED");
          await tx.chatGroup.update({
            where: { id: groupId },
            data: { archivedAt: new Date() },
          });
          await tx.groupInvitation.deleteMany({ where: { groupId } });
        }
        await tx.groupMember.update({
          where: { groupId_userId: { groupId, userId } },
          data: { leftAt: new Date(), role: "MEMBER" },
        });
        await tx.groupInvitation.deleteMany({
          where: { groupId, invitedBy: userId },
        });
      });
    },
    createChannel(hash, input) {
      return run(hash, async (tx, userId) => {
        await lockQuota(tx, userId);
        const own = await member(tx, userId, input.groupId, true);
        manager(own.role);
        const prior = await tx.groupChannel.findUnique({
          where: {
            groupId_clientId: {
              groupId: input.groupId,
              clientId: input.clientId,
            },
          },
        });
        if (prior) {
          if (prior.deletedAt) throw new SocialError("NOT_FOUND");
          return detail(tx, userId, input.groupId);
        }
        await limit(tx, userId, "managed");
        if (
          (await tx.groupChannel.count({
            where: { groupId: input.groupId, deletedAt: null },
          })) >= 20
        )
          throw new SocialError("LIMIT_REACHED");
        if (
          await tx.groupChannel.findFirst({
            where: {
              groupId: input.groupId,
              deletedAt: null,
              name: { equals: input.name, mode: "insensitive" },
            },
          })
        )
          throw new SocialError("CHANNEL_NAME_TAKEN");
        const max = await tx.groupChannel.aggregate({
          where: { groupId: input.groupId },
          _max: { position: true },
        });
        await tx.groupChannel.create({
          data: {
            groupId: input.groupId,
            clientId: input.clientId,
            name: input.name,
            position: (max._max.position ?? -1) + 1,
          },
        });
        return detail(tx, userId, input.groupId);
      });
    },
    editChannel(hash, input) {
      return run(hash, async (tx, userId) => {
        await limit(tx, userId, "managed");
        const own = await member(tx, userId, input.groupId, true);
        manager(own.role);
        const c = await channel(tx, input.groupId, input.channelId);
        if (input.action === "DELETE") {
          if (c.isDefault) throw new SocialError("DEFAULT_CHANNEL");
          await tx.groupChannel.update({
            where: { id: c.id },
            data: { deletedAt: new Date() },
          });
        } else {
          if (
            await tx.groupChannel.findFirst({
              where: {
                groupId: input.groupId,
                deletedAt: null,
                id: { not: c.id },
                name: { equals: input.name!, mode: "insensitive" },
              },
            })
          )
            throw new SocialError("CHANNEL_NAME_TAKEN");
          await tx.groupChannel.update({
            where: { id: c.id },
            data: { name: input.name! },
          });
        }
        return detail(tx, userId, input.groupId);
      });
    },
    messages(hash, input) {
      return run(hash, async (tx, userId) => {
        await member(tx, userId, input.groupId);
        const c = await channel(tx, input.groupId, input.channelId);
        const through = Math.min(
            input.through ?? c.lastSequence,
            c.lastSequence,
          ),
          forward = input.after !== undefined;
        const rows = await tx.groupMessage.findMany({
          where: {
            channelId: c.id,
            sequence: {
              lte: through,
              ...(input.after !== undefined
                ? { gt: input.after }
                : input.before !== undefined
                  ? { lt: input.before }
                  : {}),
            },
          },
          include: messageInclude,
          orderBy: { sequence: forward ? "asc" : "desc" },
          take: 41,
        });
        const page = rows.slice(0, 40);
        if (!forward) page.reverse();
        return {
          group: await detail(tx, userId, input.groupId),
          messages: page.map(messageView),
          hasMore: rows.length > 40,
          through,
        };
      });
    },
    send(hash, input) {
      return run(hash, async (tx, userId) => {
        await lockQuota(tx, userId);
        await member(tx, userId, input.groupId, true);
        const c = await channel(tx, input.groupId, input.channelId);
        const prior = await tx.groupMessage.findUnique({
          where: {
            channelId_senderId_clientId: {
              channelId: c.id,
              senderId: userId,
              clientId: input.clientId,
            },
          },
          include: messageInclude,
        });
        if (prior) {
          if (
            prior.text !== input.text ||
            prior.replyToId !== (input.replyToId ?? null)
          )
            throw new SocialError("SUBMISSION_CONFLICT");
          return messageView(prior);
        }
        if (
          input.replyToId &&
          !(await tx.groupMessage.findFirst({
            where: { id: input.replyToId, channelId: c.id },
            select: { id: true },
          }))
        )
          throw new SocialError("NOT_FOUND");
        await limit(tx, userId, "sent");
        const updated = await tx.groupChannel.update({
          where: { id: c.id },
          data: { lastSequence: { increment: 1 } },
        });
        const m = await tx.groupMessage.create({
          data: {
            groupId: input.groupId,
            channelId: c.id,
            senderId: userId,
            clientId: input.clientId,
            text: input.text,
            sequence: updated.lastSequence,
            replyToId: input.replyToId ?? null,
          },
          include: messageInclude,
        });
        await tx.groupChannel.update({
          where: { id: c.id },
          data: { activityAt: m.createdAt },
        });
        await tx.chatGroup.update({
          where: { id: input.groupId },
          data: { activityAt: m.createdAt },
        });
        return messageView(m);
      });
    },
    receipt(hash, input) {
      return run(hash, async (tx, userId) => {
        await member(tx, userId, input.groupId, true);
        const c = await channel(tx, input.groupId, input.channelId);
        if (input.deliveredSequence > c.lastSequence)
          throw new SocialError("INVALID_REQUEST");
        const where = { channelId_userId: { channelId: c.id, userId } },
          own = await tx.groupReadState.findUnique({ where });
        const readSequence = Math.max(
            own?.readSequence ?? 0,
            input.readSequence ?? 0,
          ),
          deliveredSequence = Math.max(
            own?.deliveredSequence ?? 0,
            input.deliveredSequence,
          );
        if (
          !own ||
          own.readSequence !== readSequence ||
          own.deliveredSequence !== deliveredSequence
        )
          await tx.groupReadState.upsert({
            where,
            create: {
              channelId: c.id,
              userId,
              readSequence,
              deliveredSequence,
            },
            update: { readSequence, deliveredSequence },
          });
        return detail(tx, userId, input.groupId);
      });
    },
  };
}
