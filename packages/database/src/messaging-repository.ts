import {
  AccountError,
  MessagingError,
  type MessagingRepository,
  type RealtimeSession,
} from "@merkat/backend";
import type {
  DirectConversationView,
  DirectMessageView,
  ConversationListInput,
} from "@merkat/contracts";
import { Prisma, type PrismaClient } from "./generated/client.js";
import { privacyFence, isBlocked, areFriends } from "./privacy-guard.js";

type Tx = Prisma.TransactionClient;
const conversationInclude = {
  participants: {
    include: {
      user: {
        select: {
          status: true,
          profile: { select: { username: true, displayName: true } },
        },
      },
    },
  },
  messages: { orderBy: { sequence: "desc" as const }, take: 1 },
} as const;
type Conversation = Prisma.DirectConversationGetPayload<{
  include: typeof conversationInclude;
}>;
type Message = Prisma.DirectMessageGetPayload<Record<string, never>>;
const messageView = (m: Message): DirectMessageView => ({
  id: m.id,
  conversationId: m.conversationId,
  senderId: m.senderId,
  clientId: m.clientId,
  sequence: m.sequence,
  text: m.text,
  createdAt: m.createdAt.toISOString(),
});
function view(c: Conversation, userId: string): DirectConversationView {
  const own = c.participants.find((p) => p.userId === userId);
  const peer = c.participants.find((p) => p.userId !== userId);
  if (!own || !peer) throw new Error("Invalid direct membership");
  return {
    id: c.id,
    peer: {
      id: peer.userId,
      username: peer.user.profile?.username ?? null,
      displayName: peer.user.profile?.displayName ?? null,
    },
    activityAt: c.activityAt.toISOString(),
    lastSequence: c.lastSequence,
    latestMessage: c.messages[0] ? messageView(c.messages[0]) : null,
    unreadCount: own.unreadCount,
    deliveredSequence: own.deliveredSequence,
    readSequence: own.readSequence,
    peerDeliveredSequence: peer.deliveredSequence,
    peerReadSequence: peer.readSequence,
  };
}
export async function authorize(
  tx: Tx,
  tokenHash: string,
): Promise<RealtimeSession> {
  // Revocation/suspension and a messaging operation have a clear transaction order.
  const rows = await tx.$queryRaw<
    RealtimeSession[]
  >`SELECT s.id AS "sessionId", s."userId", s."expiresAt" FROM public."Session" s JOIN public."User" u ON u.id = s."userId" WHERE s."tokenHash" = ${tokenHash} AND s."revokedAt" IS NULL AND s."expiresAt" > clock_timestamp() AND u.status = 'ACTIVE' AND u."onboardingCompletedAt" IS NOT NULL FOR SHARE OF s, u`;
  if (!rows[0]) throw new AccountError("UNAUTHORIZED");
  return rows[0];
}
async function withPrivacy(
  tx: Tx,
  c: Conversation,
  userId: string,
): Promise<DirectConversationView> {
  const peer = c.firstUserId === userId ? c.secondUserId : c.firstUserId;
  const blocks = await tx.userBlock.findMany({
    where: {
      OR: [
        { blockerId: userId, blockedId: peer },
        { blockerId: peer, blockedId: userId },
      ],
    },
    select: { blockerId: true },
  });
  return {
    ...view(c, userId),
    canSend:
      blocks.length === 0 &&
      c.participants.find((p) => p.userId === peer)?.user.status === "ACTIVE",
    blockedByYou: blocks.some((b) => b.blockerId === userId),
  };
}
async function member(tx: Tx, userId: string, id: string, lock = false) {
  if (lock) {
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT c.id FROM public."DirectConversation" c WHERE c.id = ${id}::uuid AND (c."firstUserId" = ${userId}::uuid OR c."secondUserId" = ${userId}::uuid) FOR UPDATE`;
    if (!rows[0]) throw new MessagingError("NOT_FOUND");
  }
  const c = await tx.directConversation.findFirst({
    where: { id, participants: { some: { userId } } },
    include: conversationInclude,
  });
  if (!c) throw new MessagingError("NOT_FOUND");
  return c;
}
export async function limit(
  tx: Tx,
  userId: string,
  kind: "sent" | "started" | "friend" | "discovery" | "managed" | "report",
) {
  const field = {
    sent: "sentCount",
    started: "startedCount",
    friend: "friendCount",
    discovery: "discoveryCount",
    managed: "managedCount",
    report: "reportCount",
  }[kind] as
    | "sentCount"
    | "startedCount"
    | "friendCount"
    | "discoveryCount"
    | "managedCount"
    | "reportCount";
  const maximum =
    kind === "sent"
      ? 60
      : kind === "discovery" || kind === "managed"
        ? 30
        : kind === "report"
          ? 5
          : 10;
  await tx.$executeRaw`INSERT INTO public."MessagingRateLimit" ("userId") VALUES (${userId}::uuid) ON CONFLICT DO NOTHING`;
  const rows = await tx.$queryRaw<
    {
      seconds: number;
      sentCount: number;
      startedCount: number;
      friendCount: number;
      discoveryCount: number;
      managedCount: number;
      reportCount: number;
    }[]
  >`SELECT GREATEST(0, 60 - EXTRACT(EPOCH FROM (clock_timestamp() - "windowStartedAt")))::float8 AS seconds, "sentCount", "startedCount", "friendCount", "discoveryCount", "managedCount", "reportCount" FROM public."MessagingRateLimit" WHERE "userId" = ${userId}::uuid FOR UPDATE`;
  const row = rows[0];
  if (!row) throw new Error("Missing messaging quota");
  if (row.seconds <= 0) {
    await tx.messagingRateLimit.update({
      where: { userId },
      data: {
        windowStartedAt: new Date(),
        sentCount: 0,
        startedCount: 0,
        friendCount: 0,
        discoveryCount: 0,
        managedCount: 0,
        reportCount: 0,
        [field]: 1,
      },
    });
    return;
  }
  if (row[field] >= maximum)
    throw new MessagingError("TRY_LATER", Math.max(1, Math.ceil(row.seconds)));
  await tx.messagingRateLimit.update({
    where: { userId },
    data: { [field]: { increment: 1 } },
  });
}
export async function lockQuota(tx: Tx, userId: string) {
  await tx.$executeRaw`INSERT INTO public."MessagingRateLimit" ("userId") VALUES (${userId}::uuid) ON CONFLICT DO NOTHING`;
  await tx.$queryRaw`SELECT "userId" FROM public."MessagingRateLimit" WHERE "userId" = ${userId}::uuid FOR UPDATE`;
}
export async function chargeDiscovery(db: PrismaClient, hash: string) {
  // Commit attempts before lookup: a missing/blocked username must not roll back its quota.
  await db.$transaction(async (tx) => {
    const session = await authorize(tx, hash);
    await limit(tx, session.userId, "discovery");
  });
}
export function createMessagingRepository(
  db: PrismaClient,
): MessagingRepository {
  // Short DB-only transactions: no network calls, password hashing or external publishing under locks.
  const run = <T>(hash: string, fn: (tx: Tx, userId: string) => Promise<T>) =>
    db.$transaction(
      async (tx) => {
        const session = await authorize(tx, hash);
        await privacyFence(tx);
        return fn(tx, session.userId);
      },
      { timeout: 10000 },
    );
  return {
    list(hash, input) {
      return run(hash, async (tx, userId) => {
        const before: ConversationListInput["before"] = input.before;
        const conversations = await tx.directConversation.findMany({
          where: {
            participants: { some: { userId } },
            ...(before
              ? {
                  OR: [
                    { activityAt: { lt: new Date(before.activityAt) } },
                    {
                      activityAt: new Date(before.activityAt),
                      id: { lt: before.id },
                    },
                  ],
                }
              : {}),
          },
          include: conversationInclude,
          orderBy: [{ activityAt: "desc" }, { id: "desc" }],
          take: 31,
        });
        const page = conversations.slice(0, 30);
        const last = page.at(-1);
        return {
          conversations: await Promise.all(
            page.map((c) => withPrivacy(tx, c, userId)),
          ),
          nextCursor:
            conversations.length > 30 && last
              ? { activityAt: last.activityAt.toISOString(), id: last.id }
              : null,
          unreadConversations: await tx.directParticipant.count({
            where: { userId, unreadCount: { gt: 0 } },
          }),
        };
      });
    },
    async open(hash, input) {
      await chargeDiscovery(db, hash);
      return run(hash, async (tx, userId) => {
        const person = await tx.profile.findFirst({
          where: {
            username: input.username,
            user: { status: "ACTIVE", onboardingCompletedAt: { not: null } },
          },
          select: { userId: true },
        });
        if (!person) throw new MessagingError("NOT_FOUND");
        if (person.userId === userId)
          throw new MessagingError("SELF_CONVERSATION");
        if (await isBlocked(tx, userId, person.userId))
          throw new MessagingError("NOT_FOUND");
        const [firstUserId, secondUserId] =
          userId < person.userId
            ? ([userId, person.userId] as const)
            : ([person.userId, userId] as const);
        const where = {
          firstUserId_secondUserId: { firstUserId, secondUserId },
        };
        const existing = await tx.directConversation.findUnique({
          where,
          include: conversationInclude,
        });
        if (existing) return withPrivacy(tx, existing, userId);
        const preference = await tx.userPrivacy.findUnique({
          where: { userId: person.userId },
        });
        if (
          preference?.allowNonFriendDms === false &&
          !(await areFriends(tx, userId, person.userId))
        )
          throw new MessagingError("NOT_FOUND");
        await limit(tx, userId, "started");
        // Native conflict handling survives two server instances creating the same pair.
        await tx.$executeRaw`INSERT INTO public."DirectConversation" ("firstUserId", "secondUserId") VALUES (${firstUserId}::uuid, ${secondUserId}::uuid) ON CONFLICT ("firstUserId", "secondUserId") DO NOTHING`;
        return withPrivacy(
          tx,
          await tx.directConversation.findUniqueOrThrow({
            where,
            include: conversationInclude,
          }),
          userId,
        );
      });
    },
    messages(hash, input) {
      return run(hash, async (tx, userId) => {
        const c = await member(tx, userId, input.conversationId);
        const through = Math.min(
          input.through ?? c.lastSequence,
          c.lastSequence,
        );
        const forward = input.after !== undefined;
        const messages = await tx.directMessage.findMany({
          where: {
            conversationId: c.id,
            sequence: {
              lte: through,
              ...(input.after !== undefined
                ? { gt: input.after }
                : input.before !== undefined
                  ? { lt: input.before }
                  : {}),
            },
          },
          orderBy: { sequence: forward ? "asc" : "desc" },
          take: 41,
        });
        const page = messages.slice(0, 40);
        if (!forward) page.reverse();
        return {
          conversation: await withPrivacy(tx, c, userId),
          messages: page.map(messageView),
          hasMore: messages.length > 40,
          through,
        };
      });
    },
    send(hash, input) {
      return run(hash, async (tx, userId) => {
        // Lock rate counter before conversation everywhere to avoid cross-conversation deadlocks.
        // Dedupe before consuming a quota; then repeat after obtaining the serializing lock.
        const target = await member(tx, userId, input.conversationId);
        if (
          await isBlocked(
            tx,
            userId,
            target.firstUserId === userId
              ? target.secondUserId
              : target.firstUserId,
          )
        )
          throw new MessagingError("INTERACTION_UNAVAILABLE");
        await lockQuota(tx, userId);
        const prior = await tx.directMessage.findUnique({
          where: {
            conversationId_senderId_clientId: {
              conversationId: input.conversationId,
              senderId: userId,
              clientId: input.clientId,
            },
          },
        });
        if (prior) {
          if (prior.text !== input.text)
            throw new MessagingError("SUBMISSION_CONFLICT");
          return messageView(prior);
        }
        await limit(tx, userId, "sent");
        const c = await member(tx, userId, input.conversationId, true);
        const duplicate = await tx.directMessage.findUnique({
          where: {
            conversationId_senderId_clientId: {
              conversationId: c.id,
              senderId: userId,
              clientId: input.clientId,
            },
          },
        });
        if (duplicate) {
          if (duplicate.text !== input.text)
            throw new MessagingError("SUBMISSION_CONFLICT");
          return messageView(duplicate);
        }
        const updated = await tx.directConversation.update({
          where: { id: c.id },
          data: { lastSequence: { increment: 1 } },
        });
        const message = await tx.directMessage.create({
          data: {
            conversationId: c.id,
            senderId: userId,
            clientId: input.clientId,
            text: input.text,
            sequence: updated.lastSequence,
          },
        });
        await tx.directConversation.update({
          where: { id: c.id },
          data: { activityAt: message.createdAt },
        });
        await tx.directParticipant.updateMany({
          where: { conversationId: c.id, userId: { not: userId } },
          data: { unreadCount: { increment: 1 } },
        });
        return messageView(message);
      });
    },
    receipt(hash, input) {
      return run(hash, async (tx, userId) => {
        const c = await member(tx, userId, input.conversationId, true);
        if (input.deliveredSequence > c.lastSequence)
          throw new MessagingError("INVALID_REQUEST");
        const own = c.participants.find((p) => p.userId === userId)!;
        const deliveredSequence = Math.max(
          own.deliveredSequence,
          input.deliveredSequence,
        );
        const readSequence = Math.max(
          own.readSequence,
          input.readSequence ?? 0,
        );
        if (
          deliveredSequence !== own.deliveredSequence ||
          readSequence !== own.readSequence
        ) {
          const unreadCount = await tx.directMessage.count({
            where: {
              conversationId: c.id,
              senderId: { not: userId },
              sequence: { gt: readSequence },
            },
          });
          await tx.directParticipant.update({
            where: { conversationId_userId: { conversationId: c.id, userId } },
            data: { deliveredSequence, readSequence, unreadCount },
          });
        }
        return withPrivacy(tx, await member(tx, userId, c.id), userId);
      });
    },
    realtimeSession(hash) {
      return db.$transaction((tx) => authorize(tx, hash));
    },
  };
}
