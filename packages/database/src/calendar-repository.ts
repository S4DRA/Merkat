import { SocialError } from "@merkat/backend";
import { createHash } from "node:crypto";
import {
  calendarCreateSchema,
  calendarEditSchema,
  calendarRespondSchema,
  chatScopeSchema,
  type CalendarEventView,
} from "@merkat/contracts";
import { z } from "zod";
import type { Prisma, PrismaClient } from "./generated/client.js";
import { authorize, limit, lockQuota } from "./messaging-repository.js";
import { privacyFence, assertInteraction } from "./privacy-guard.js";
import {
  chatAccess,
  publishFeature,
  notifyPeople,
  scopeOf,
  type CollaborationTx,
} from "./collaboration-access.js";
const include = {
  participants: {
    include: {
      user: {
        select: { profile: { select: { displayName: true, username: true } } },
      },
    },
  },
} as const;
type Event = Prisma.PlanGetPayload<{ include: typeof include }>;
const idSchema = z.object({ id: z.uuid() }).strict();
const boundedRange = z
  .object({
    start: z.iso.datetime({ offset: true }),
    end: z.iso.datetime({ offset: true }),
    after: z
      .object({ startsAt: z.iso.datetime({ offset: true }), id: z.uuid() })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    (v) =>
      Date.parse(v.end) > Date.parse(v.start) &&
      Date.parse(v.end) - Date.parse(v.start) <= 370 * 86400000,
  );
function input<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (!result.success) throw new SocialError("INVALID_REQUEST");
  return result.data;
}
function view(p: Event): CalendarEventView {
  return {
    id: p.id,
    ownerId: p.ownerId,
    title: p.title,
    description: p.description,
    location: p.location,
    startsAt: p.startsAt.toISOString(),
    endsAt: p.endsAt.toISOString(),
    timezone: p.timezone,
    version: p.version,
    cancelled: p.cancelled,
    scope: scopeOf(p),
    participants: p.participants.map((a) => ({
      userId: a.userId,
      response: a.response,
      subscribed: a.subscribed,
      displayName: a.user.profile?.displayName ?? null,
      username: a.user.profile?.username ?? null,
    })),
  };
}
async function accessible(
  tx: CollaborationTx,
  userId: string,
  p: Event,
  writing = false,
) {
  const scope = scopeOf(p);
  if (scope) await chatAccess(tx, userId, scope, writing);
  else if (!p.participants.some((a) => a.userId === userId))
    throw new SocialError("NOT_FOUND");
}
export async function schedulePlanReminders(
  tx: CollaborationTx,
  p: Event,
  now: Date,
) {
  if (p.cancelled) {
    await tx.planReminder.updateMany({
      where: { planId: p.id, state: "PENDING" },
      data: { state: "CANCELLED" },
    });
    return;
  }
  await tx.planReminder.updateMany({
    where: {
      planId: p.id,
      state: "PENDING",
      OR: [
        { version: { not: p.version } },
        {
          userId: {
            notIn: p.participants
              .filter((a) => a.subscribed)
              .map((a) => a.userId),
          },
        },
      ],
    },
    data: { state: "CANCELLED" },
  });
  for (const participant of p.participants.filter((a) => a.subscribed)) {
    const settings = await tx.userSettings.findUnique({
      where: { userId: participant.userId },
    });
    if (settings?.remindersEnabled === false) {
      await tx.planReminder.updateMany({
        where: { planId: p.id, userId: participant.userId, state: "PENDING" },
        data: { state: "CANCELLED" },
      });
      continue;
    }
    for (const hoursBefore of [24, 5]) {
      const dueAt = new Date(p.startsAt.getTime() - hoursBefore * 3600000);
      if (dueAt <= now) continue;
      await tx.planReminder.createMany({
        data: [
          {
            planId: p.id,
            userId: participant.userId,
            version: p.version,
            hoursBefore,
            dueAt,
          },
        ],
        skipDuplicates: true,
      });
      await tx.planReminder.updateMany({
        where: {
          planId: p.id,
          userId: participant.userId,
          version: p.version,
          hoursBefore,
          state: "CANCELLED",
        },
        data: { state: "PENDING", dueAt },
      });
    }
  }
}
export function createCalendarRepository(
  db: PrismaClient,
  clock = () => new Date(),
) {
  const run = <T>(
    hash: string,
    fn: (tx: CollaborationTx, userId: string) => Promise<T>,
  ) =>
    db.$transaction(
      async (tx) => {
        const session = await authorize(tx, hash);
        await privacyFence(tx);
        return fn(tx, session.userId);
      },
      { timeout: 15000 },
    );
  async function event(
    tx: CollaborationTx,
    userId: string,
    id: string,
    writing = false,
  ) {
    let p = await tx.plan.findUnique({ where: { id }, include });
    if (!p) throw new SocialError("NOT_FOUND");
    await accessible(tx, userId, p, writing);
    await tx.$queryRaw`SELECT id FROM "Plan" WHERE id=${id}::uuid FOR UPDATE`;
    p = await tx.plan.findUniqueOrThrow({ where: { id }, include });
    return p;
  }
  async function announce(
    tx: CollaborationTx,
    p: Event,
    title: string,
    body: string,
  ) {
    const active: string[] = [];
    for (const a of p.participants) {
      try {
        await accessible(tx, a.userId, p);
        active.push(a.userId);
      } catch (error) {
        if (error instanceof SocialError) continue;
        throw error;
      }
    }
    for (const id of active)
      await tx.notification.create({
        data: {
          userId: id,
          planId: p.id,
          dedupeKey: `event:${p.id}:${p.version}:${title}:${id}`,
          title,
          body,
          href: `/plans?event=${p.id}`,
        },
      });
    await notifyPeople(tx, active);
  }
  return {
    list(hash: string, raw: unknown) {
      const range = input(boundedRange, raw);
      return run(hash, async (tx, userId) => {
        const rows = await tx.plan.findMany({
          where: {
            participants: { some: { userId, subscribed: true } },
            startsAt: { lt: new Date(range.end) },
            endsAt: { gte: new Date(range.start) },
            ...(range.after
              ? {
                  OR: [
                    {
                      startsAt: {
                        gt: new Date(range.after.startsAt),
                        lt: new Date(range.end),
                      },
                    },
                    {
                      startsAt: new Date(range.after.startsAt),
                      id: { gt: range.after.id },
                    },
                  ],
                }
              : {}),
          },
          include,
          orderBy: [{ startsAt: "asc" }, { id: "asc" }],
          take: 201,
        });
        const events: CalendarEventView[] = [];
        for (const p of rows.slice(0, 200)) {
          try {
            await accessible(tx, userId, p);
            events.push(view(p));
          } catch (error) {
            if (error instanceof SocialError) continue;
            throw error;
          }
        }
        const last = rows[199];
        return {
          events,
          truncated: rows.length > 200,
          nextCursor:
            rows.length > 200 && last
              ? { startsAt: last.startsAt.toISOString(), id: last.id }
              : null,
        };
      });
    },
    conversation(hash: string, raw: unknown) {
      const scope = input(chatScopeSchema, raw);
      return run(hash, async (tx, userId) => {
        await chatAccess(tx, userId, scope);
        const rows = await tx.plan.findMany({
          where:
            scope.kind === "DM"
              ? { directId: scope.id }
              : { groupId: scope.id },
          include,
          orderBy: [{ startsAt: "desc" }, { id: "desc" }],
          take: 100,
        });
        return { events: rows.map(view) };
      });
    },
    detail(hash: string, raw: unknown) {
      const { id } = input(idSchema, raw);
      return run(hash, async (tx, userId) => view(await event(tx, userId, id)));
    },
    create(hash: string, raw: unknown) {
      const data = input(calendarCreateSchema, raw);
      return run(hash, async (tx, userId) => {
        await lockQuota(tx, userId);
        const submissionHash = createHash("sha256")
          .update(JSON.stringify(data))
          .digest("hex");
        const people = data.scope
          ? (await chatAccess(tx, userId, data.scope, true)).people
          : [];
        const previous = await tx.plan.findUnique({
          where: {
            ownerId_clientId: { ownerId: userId, clientId: data.clientId },
          },
          include,
        });
        if (previous) {
          if (previous.submissionHash !== submissionHash)
            throw new SocialError("SUBMISSION_CONFLICT");
          return view(previous);
        }
        await limit(tx, userId, "managed");
        let ids = people.map((p) => p.id);
        if (!data.scope) {
          const names = [
            ...new Set(data.usernames.map((n) => n.trim().toLowerCase())),
          ];
          const invitees = await tx.profile.findMany({
            where: {
              username: { in: names },
              user: { status: "ACTIVE", onboardingCompletedAt: { not: null } },
            },
            select: { userId: true },
          });
          if (invitees.length !== names.length)
            throw new SocialError("NOT_FOUND");
          for (const person of invitees)
            await assertInteraction(tx, userId, person.userId);
          ids = [userId, ...invitees.map((p) => p.userId)];
        }
        const p = await tx.plan.create({
          data: {
            ownerId: userId,
            clientId: data.clientId,
            submissionHash,
            title: data.event.title,
            description: data.event.description,
            location: data.event.location,
            startsAt: new Date(data.event.startsAt),
            endsAt: new Date(data.event.endsAt),
            timezone: data.event.timezone,
            ...(data.scope?.kind === "DM"
              ? { directId: data.scope.id }
              : data.scope?.kind === "GROUP"
                ? { groupId: data.scope.id, channelId: data.scope.channelId }
                : {}),
            participants: {
              create: [...new Set(ids)].map((id) => ({
                userId: id,
                response: id === userId ? "GOING" : "INVITED",
                subscribed: id === userId,
              })),
            },
          },
          include,
        });
        await schedulePlanReminders(tx, p, clock());
        if (data.scope)
          await publishFeature(
            tx,
            userId,
            data.scope,
            { planId: p.id },
            `Plan: ${p.title}`,
          );
        await announce(tx, p, "New plan", p.title);
        return view(p);
      });
    },
    respond(hash: string, raw: unknown) {
      const data = input(calendarRespondSchema, raw);
      return run(hash, async (tx, userId) => {
        await limit(tx, userId, "managed");
        const p = await event(tx, userId, data.id);
        if (p.cancelled) throw new SocialError("FORBIDDEN");
        const own = p.participants.find((a) => a.userId === userId);
        const response = data.response ?? own?.response ?? "INVITED";
        const subscribed =
          data.subscribed ??
          (data.response === "GOING"
            ? true
            : data.response === "DECLINED"
              ? false
              : (own?.subscribed ?? false));
        await tx.planParticipant.upsert({
          where: { planId_userId: { planId: p.id, userId } },
          create: { planId: p.id, userId, response, subscribed },
          update: { response, subscribed },
        });
        const fresh = await tx.plan.findUniqueOrThrow({
          where: { id: p.id },
          include,
        });
        await schedulePlanReminders(tx, fresh, clock());
        await notifyPeople(
          tx,
          fresh.participants.map((a) => a.userId),
        );
        return view(fresh);
      });
    },
    edit(hash: string, raw: unknown) {
      const data = input(calendarEditSchema, raw);
      return run(hash, async (tx, userId) => {
        await limit(tx, userId, "managed");
        const p = await event(tx, userId, data.id, true);
        if (p.ownerId !== userId || p.cancelled)
          throw new SocialError("FORBIDDEN");
        if (p.version !== data.version)
          throw new SocialError("SUBMISSION_CONFLICT");
        const fresh = await tx.plan.update({
          where: { id: p.id },
          data: {
            title: data.event.title,
            description: data.event.description,
            location: data.event.location,
            startsAt: new Date(data.event.startsAt),
            endsAt: new Date(data.event.endsAt),
            timezone: data.event.timezone,
            version: { increment: 1 },
          },
          include,
        });
        await schedulePlanReminders(tx, fresh, clock());
        await announce(tx, fresh, "Plan updated", fresh.title);
        return view(fresh);
      });
    },
    cancel(hash: string, raw: unknown) {
      const data = input(
        z
          .object({ id: z.uuid(), version: z.number().int().positive() })
          .strict(),
        raw,
      );
      return run(hash, async (tx, userId) => {
        await limit(tx, userId, "managed");
        const p = await event(tx, userId, data.id, true);
        if (p.ownerId !== userId) throw new SocialError("FORBIDDEN");
        if (p.cancelled) return view(p);
        if (p.version !== data.version)
          throw new SocialError("SUBMISSION_CONFLICT");
        const fresh = await tx.plan.update({
          where: { id: p.id },
          data: { cancelled: true, version: { increment: 1 } },
          include,
        });
        await schedulePlanReminders(tx, fresh, clock());
        await announce(tx, fresh, "Plan cancelled", fresh.title);
        return view(fresh);
      });
    },
    share(hash: string, raw: unknown) {
      const data = input(
        z
          .object({ id: z.uuid(), clientId: z.uuid(), scope: chatScopeSchema })
          .strict(),
        raw,
      );
      return run(hash, async (tx, userId) => {
        await limit(tx, userId, "managed");
        const chat = await chatAccess(tx, userId, data.scope, true);
        let p = await event(tx, userId, data.id, true);
        if (p.ownerId !== userId) throw new SocialError("FORBIDDEN");
        const old = scopeOf(p);
        if (old && JSON.stringify(old) !== JSON.stringify(data.scope))
          throw new SocialError("FORBIDDEN");
        if (!old) {
          p = await tx.plan.update({
            where: { id: p.id },
            data: {
              ...(data.scope.kind === "DM"
                ? { directId: data.scope.id }
                : { groupId: data.scope.id, channelId: data.scope.channelId }),
              participants: {
                createMany: {
                  data: chat.people
                    .filter(
                      (person) =>
                        !p.participants.some((a) => a.userId === person.id),
                    )
                    .map((person) => ({ userId: person.id })),
                  skipDuplicates: true,
                },
              },
            },
            include,
          });
        }
        const previous =
          data.scope.kind === "DM"
            ? await tx.directMessage.findUnique({
                where: {
                  conversationId_senderId_clientId: {
                    conversationId: data.scope.id,
                    senderId: userId,
                    clientId: data.clientId,
                  },
                },
              })
            : await tx.groupMessage.findUnique({
                where: {
                  channelId_senderId_clientId: {
                    channelId: data.scope.channelId,
                    senderId: userId,
                    clientId: data.clientId,
                  },
                },
              });
        if (previous) {
          if (previous.planId !== p.id)
            throw new SocialError("SUBMISSION_CONFLICT");
        } else
          await publishFeature(
            tx,
            userId,
            data.scope,
            { planId: p.id },
            `Plan: ${p.title}`,
            data.clientId,
          );
        await notifyPeople(
          tx,
          chat.people.map((person) => person.id),
        );
        return view(p);
      });
    },
    async deliverDue(now = clock()) {
      const candidates = await db.planReminder.findMany({
        where: { state: "PENDING", dueAt: { lte: now } },
        orderBy: [{ dueAt: "asc" }, { id: "asc" }],
        take: 100,
      });
      let processed = 0,
        delivered = 0;
      for (const candidate of candidates) {
        const result = await db.$transaction(
          async (tx) => {
            await privacyFence(tx);
            let p = await tx.plan.findUnique({
              where: { id: candidate.planId },
              include,
            });
            if (!p) return { processed: 0, delivered: 0 };
            let accessibleNow = true;
            try {
              await accessible(tx, candidate.userId, p);
            } catch (error) {
              if (error instanceof SocialError) accessibleNow = false;
              else throw error;
            }
            await tx.$queryRaw`SELECT id FROM "Plan" WHERE id=${p.id}::uuid FOR UPDATE`;
            p = await tx.plan.findUniqueOrThrow({
              where: { id: p.id },
              include,
            });
            const locked = await tx.$queryRaw<
              { id: string }[]
            >`SELECT id FROM "PlanReminder" WHERE id=${candidate.id}::uuid AND state='PENDING' AND "dueAt"<=${now} FOR UPDATE SKIP LOCKED`;
            if (!locked.length) return { processed: 0, delivered: 0 };
            const user = await tx.user.findUnique({
              where: { id: candidate.userId },
              select: {
                status: true,
                settings: { select: { remindersEnabled: true } },
              },
            });
            const allowed =
              accessibleNow &&
              !p.cancelled &&
              p.version === candidate.version &&
              p.startsAt > now &&
              p.participants.some(
                (a) => a.userId === candidate.userId && a.subscribed,
              ) &&
              user?.status === "ACTIVE" &&
              user.settings?.remindersEnabled !== false;
            if (allowed)
              await tx.notification.upsert({
                where: { dedupeKey: `reminder:${candidate.id}` },
                create: {
                  userId: candidate.userId,
                  planId: p.id,
                  dedupeKey: `reminder:${candidate.id}`,
                  title: `In ${candidate.hoursBefore} hours`,
                  body: p.title,
                  href: `/plans?event=${p.id}`,
                  createdAt: now,
                },
                update: {},
              });
            await tx.planReminder.update({
              where: { id: candidate.id },
              data: { state: allowed ? "DELIVERED" : "CANCELLED" },
            });
            if (allowed) await notifyPeople(tx, [candidate.userId]);
            return { processed: 1, delivered: allowed ? 1 : 0 };
          },
          { timeout: 15000 },
        );
        processed += result.processed;
        delivered += result.delivered;
      }
      return { processed, delivered };
    },
    notifications(hash: string) {
      return run(hash, async (tx, userId) => {
        const notifications = await tx.notification.findMany({
          where: { userId },
          include: { plan: { include } },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 100,
        });
        const visible = [];
        for (const n of notifications) {
          if (n.plan) {
            try {
              await accessible(tx, userId, n.plan);
            } catch (error) {
              if (error instanceof SocialError) continue;
              throw error;
            }
          }
          visible.push({
            id: n.id,
            title: n.title,
            body: n.body,
            href: n.href,
            createdAt: n.createdAt.toISOString(),
            readAt: n.readAt?.toISOString() ?? null,
          });
        }
        return {
          notifications: visible,
          unread: visible.filter((n) => !n.readAt).length,
        };
      });
    },
    markRead(hash: string, raw: unknown) {
      const data = input(z.object({ id: z.uuid().optional() }).strict(), raw);
      return run(hash, async (tx, userId) => {
        await tx.notification.updateMany({
          where: { userId, readAt: null, ...(data.id ? { id: data.id } : {}) },
          data: { readAt: clock() },
        });
        return { ok: true };
      });
    },
  };
}
