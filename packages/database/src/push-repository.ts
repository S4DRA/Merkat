import webpush from "web-push";
import { z } from "zod";
import { SocialError } from "@merkat/backend";
import type { PrismaClient } from "./generated/client.js";
import { authorize, limit } from "./messaging-repository.js";
import { chatAccess, scopeOf } from "./collaboration-access.js";
const endpointSchema = z
  .string()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value),
        h = url.hostname;
      return (
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        !url.port &&
        (h === "fcm.googleapis.com" ||
          h === "updates.push.services.mozilla.com" ||
          h === "push.services.mozilla.com" ||
          h.endsWith(".push.apple.com") ||
          h.endsWith(".notify.windows.com"))
      );
    } catch {
      return false;
    }
  });
const subscriptionSchema = z
  .object({
    endpoint: endpointSchema,
    keys: z
      .object({
        p256dh: z
          .string()
          .max(128)
          .refine(
            (v) =>
              /^[A-Za-z0-9_-]+$/.test(v) &&
              Buffer.from(v, "base64url").length === 65,
          ),
        auth: z
          .string()
          .max(32)
          .refine(
            (v) =>
              /^[A-Za-z0-9_-]+$/.test(v) &&
              Buffer.from(v, "base64url").length === 16,
          ),
      })
      .strict(),
  })
  .strict();
function vapid() {
  const {
    MERKAT_PUSH_PUBLIC_KEY: publicKey,
    MERKAT_PUSH_PRIVATE_KEY: privateKey,
    MERKAT_PUSH_SUBJECT: subject,
  } = process.env;
  if (
    !publicKey ||
    !privateKey ||
    !subject ||
    !/^mailto:|^https:\/\//.test(subject)
  )
    return null;
  return { publicKey, privateKey, subject };
}
export function createPushRepository(db: PrismaClient) {
  return {
    config() {
      const value = vapid();
      return { available: !!value, publicKey: value?.publicKey ?? null };
    },
    async status(hash: string, raw: unknown) {
      const parsed = z
        .object({ endpoint: z.string().max(2048) })
        .strict()
        .safeParse(raw);
      if (!parsed.success) throw new SocialError("INVALID_REQUEST");
      return db.$transaction(async (tx) => {
        const s = await authorize(tx, hash);
        return {
          registered: !!(await tx.pushSubscription.findFirst({
            where: {
              endpoint: parsed.data.endpoint,
              userId: s.userId,
              session: { revokedAt: null, expiresAt: { gt: new Date() } },
            },
            select: { id: true },
          })),
        };
      });
    },
    async subscribe(hash: string, raw: unknown) {
      const parsed = subscriptionSchema.safeParse(raw);
      if (!parsed.success) throw new SocialError("INVALID_REQUEST");
      if (!vapid()) throw new SocialError("FORBIDDEN");
      return db.$transaction(async (tx) => {
        const s = await authorize(tx, hash);
        await limit(tx, s.userId, "managed");
        const existing = await tx.pushSubscription.findUnique({
          where: { endpoint: parsed.data.endpoint },
        });
        if (existing && existing.userId !== s.userId)
          throw new SocialError("FORBIDDEN");
        if (
          !existing &&
          (await tx.pushSubscription.count({ where: { userId: s.userId } })) >=
            10
        )
          throw new SocialError("LIMIT_REACHED");
        await tx.pushSubscription.upsert({
          where: { endpoint: parsed.data.endpoint },
          create: {
            userId: s.userId,
            sessionId: s.sessionId,
            endpoint: parsed.data.endpoint,
            ...parsed.data.keys,
          },
          update: { sessionId: s.sessionId, ...parsed.data.keys },
        });
        return { ok: true };
      });
    },
    async remove(hash: string, raw: unknown) {
      const parsed = z
        .object({ endpoint: z.string().max(2048) })
        .strict()
        .safeParse(raw);
      if (!parsed.success) throw new SocialError("INVALID_REQUEST");
      return db.$transaction(async (tx) => {
        const s = await authorize(tx, hash);
        await tx.pushSubscription.deleteMany({
          where: { endpoint: parsed.data.endpoint, userId: s.userId },
        });
        return { ok: true };
      });
    },
    async deliver(now = new Date()) {
      const configuration = vapid();
      if (!configuration)
        return { configured: false, attempted: 0, accepted: 0 };
      // Intent and delivery records are durable. Only recent notifications go to devices.
      await db.$executeRaw`INSERT INTO "PushDelivery" (id,"notificationId","subscriptionId",state,attempts,"availableAt") SELECT gen_random_uuid(),n.id,s.id,'PENDING',0,${now} FROM "Notification" n JOIN "PushSubscription" s ON s."userId"=n."userId" JOIN "UserSettings" p ON p."userId"=n."userId" JOIN "Session" session ON session.id=s."sessionId" WHERE p."pushEnabled"=true AND session."revokedAt" IS NULL AND session."expiresAt">${now} AND n."createdAt">${new Date(now.getTime() - 86400000)} AND n."readAt" IS NULL ON CONFLICT ("notificationId","subscriptionId") DO NOTHING`;
      const claimed = await db.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM "PushDelivery" WHERE state='PENDING' AND "availableAt"<=${now} AND ("leaseUntil" IS NULL OR "leaseUntil"<${now}) ORDER BY "availableAt",id FOR UPDATE SKIP LOCKED LIMIT 25`;
        await tx.pushDelivery.updateMany({
          where: { id: { in: rows.map((r) => r.id) } },
          data: { leaseUntil: new Date(now.getTime() + 600000) },
        });
        return rows;
      });
      let accepted = 0;
      for (const item of claimed) {
        const d = await db.pushDelivery.findUnique({
          where: { id: item.id },
          include: {
            notification: true,
            subscription: {
              include: {
                session: true,
                user: { select: { status: true, settings: true } },
              },
            },
          },
        });
        if (!d) continue;
        const s = d.subscription,
          n = d.notification;
        let allowed =
          s.session.revokedAt === null &&
          s.session.expiresAt > now &&
          s.user.status === "ACTIVE" &&
          s.user.settings?.pushEnabled === true &&
          n.readAt === null;
        if (allowed && n.planId) {
          const p = await db.plan.findUnique({
            where: { id: n.planId },
            include: { participants: true },
          });
          if (!p) allowed = false;
          else if (
            n.dedupeKey.startsWith("reminder:") &&
            (p.cancelled ||
              p.startsAt <= now ||
              s.user.settings?.remindersEnabled === false ||
              !p.participants.some(
                (a) => a.userId === s.userId && a.subscribed,
              ) ||
              !(await db.planReminder.findFirst({
                where: {
                  id: n.dedupeKey.slice(9),
                  planId: p.id,
                  userId: s.userId,
                  version: p.version,
                  state: "DELIVERED",
                },
              })))
          )
            allowed = false;
          else {
            const scope = scopeOf(p);
            if (scope) {
              try {
                await db.$transaction((tx) => chatAccess(tx, s.userId, scope));
              } catch {
                allowed = false;
              }
            } else allowed = p.participants.some((a) => a.userId === s.userId);
          }
        }
        if (!allowed) {
          await db.pushDelivery.update({
            where: { id: d.id },
            data: { state: "CANCELLED", leaseUntil: null },
          });
          continue;
        }
        try {
          const result = await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            JSON.stringify({
              id: n.id,
              userId: s.userId,
              title: n.title,
              body: n.body,
              href: n.href,
            }),
            {
              vapidDetails: configuration,
              TTL: 3600,
              timeout: 10000,
              urgency: "normal",
            },
          );
          await db.pushDelivery.update({
            where: { id: d.id },
            data: {
              state: "ACCEPTED",
              attempts: { increment: 1 },
              providerStatus: result.statusCode,
              leaseUntil: null,
            },
          });
          accepted++;
        } catch (error) {
          const status =
            typeof error === "object" && error !== null && "statusCode" in error
              ? Number(error.statusCode)
              : 0;
          if (status === 404 || status === 410) {
            await db.pushSubscription.deleteMany({ where: { id: s.id } });
            continue;
          }
          const attempts = d.attempts + 1;
          await db.pushDelivery.updateMany({
            where: { id: d.id },
            data: {
              attempts,
              state: attempts >= 8 ? "FAILED" : "PENDING",
              availableAt: new Date(
                now.getTime() + Math.min(3600000, 30000 * 2 ** attempts),
              ),
              providerStatus: status || null,
              leaseUntil: null,
            },
          });
        }
      }
      return { configured: true, attempted: claimed.length, accepted };
    },
  };
}
