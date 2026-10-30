import { randomUUID, createHash } from "node:crypto";
import { SocialError, splitMinorUnits, tabSummary } from "@merkat/backend";
import {
  tabCreateSchema,
  tabActionSchema,
  chatScopeSchema,
  type TabState,
  type TabView,
  type TabAllocation,
} from "@merkat/contracts";
import { z } from "zod";
import {
  Prisma,
  type PrismaClient,
  type TabSession,
} from "./generated/client.js";
import { authorize, limit, lockQuota } from "./messaging-repository.js";
import { privacyFence } from "./privacy-guard.js";
import {
  chatAccess,
  notifyPeople,
  publishFeature,
  scopeOf,
  type CollaborationTx,
} from "./collaboration-access.js";
const idSchema = z.object({ id: z.uuid() }).strict();
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
function input<T>(schema: z.ZodType<T>, raw: unknown): T {
  const p = schema.safeParse(raw);
  if (!p.success) throw new SocialError("INVALID_REQUEST");
  return p.data;
}
function view(row: TabSession, canManage: boolean): TabView {
  const scope = scopeOf(row);
  if (!scope) throw new Error("Invalid tab scope");
  const state = row.state as unknown as TabState;
  return {
    id: row.id,
    title: row.title,
    currency: row.currency as TabView["currency"],
    scope,
    createdBy: row.createdBy,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    closedAt: row.closedAt?.toISOString() ?? null,
    state: { ...state, submissions: {} },
    summary: tabSummary(state),
    canManage,
  };
}
export function createTabRepository(db: PrismaClient) {
  const run = <T>(
    hash: string,
    fn: (tx: CollaborationTx, userId: string) => Promise<T>,
  ) =>
    db.$transaction(
      async (tx) => {
        const s = await authorize(tx, hash);
        await privacyFence(tx);
        return fn(tx, s.userId);
      },
      { timeout: 15000 },
    );
  async function access(
    tx: CollaborationTx,
    userId: string,
    id: string,
    writing = false,
  ) {
    let row = await tx.tabSession.findUnique({ where: { id } });
    if (!row) throw new SocialError("NOT_FOUND");
    const scope = scopeOf(row);
    if (!scope) throw new SocialError("NOT_FOUND");
    const chat = await chatAccess(tx, userId, scope, writing);
    await tx.$queryRaw`SELECT id FROM "TabSession" WHERE id=${id}::uuid FOR UPDATE`;
    row = await tx.tabSession.findUniqueOrThrow({ where: { id } });
    const state = row.state as unknown as TabState;
    if (!state.participants.some((p) => p.id === userId))
      throw new SocialError("NOT_FOUND");
    return { row, state, scope, chat };
  }
  return {
    context(hash: string, raw: unknown) {
      const scope = input(chatScopeSchema, raw);
      return run(hash, async (tx, userId) => chatAccess(tx, userId, scope));
    },
    list(hash: string, raw: unknown) {
      const scope = input(chatScopeSchema, raw);
      return run(hash, async (tx, userId) => {
        await chatAccess(tx, userId, scope);
        const rows = await tx.tabSession.findMany({
          where:
            scope.kind === "DM"
              ? { directId: scope.id }
              : { groupId: scope.id },
          orderBy: { createdAt: "desc" },
          take: 50,
        });
        return {
          tabs: rows
            .filter((r) =>
              (r.state as unknown as TabState).participants.some(
                (p) => p.id === userId,
              ),
            )
            .map((r) => ({
              id: r.id,
              title: r.title,
              closedAt: r.closedAt?.toISOString() ?? null,
              currency: r.currency,
            })),
        };
      });
    },
    detail(hash: string, raw: unknown) {
      const { id } = input(idSchema, raw);
      return run(hash, async (tx, userId) => {
        const a = await access(tx, userId, id);
        return view(a.row, a.chat.canManage);
      });
    },
    create(hash: string, raw: unknown) {
      const data = input(tabCreateSchema, raw);
      return run(hash, async (tx, userId) => {
        await lockQuota(tx, userId);
        const chat = await chatAccess(tx, userId, data.scope, true);
        if (!chat.canManage) throw new SocialError("FORBIDDEN");
        const existing = await tx.tabSession.findUnique({
          where: {
            createdBy_clientId: { createdBy: userId, clientId: data.clientId },
          },
        });
        if (existing) {
          if (
            (existing.state as unknown as TabState).submissions.create !==
            digest(data)
          )
            throw new SocialError("SUBMISSION_CONFLICT");
          return view(existing, chat.canManage);
        }
        const scopeWhere =
          data.scope.kind === "DM"
            ? { directId: data.scope.id }
            : { groupId: data.scope.id };
        if (
          await tx.tabSession.findFirst({
            where: { ...scopeWhere, closedAt: null },
          })
        )
          throw new SocialError("TAB_ALREADY_OPEN");
        await limit(tx, userId, "managed");
        const selected = new Set([...data.participantIds, userId]);
        if ([...selected].some((id) => !chat.people.some((p) => p.id === id)))
          throw new SocialError("INVALID_REQUEST");
        const state: TabState = {
          participants: chat.people.filter((p) => selected.has(p.id)),
          orders: [],
          payments: [],
          settlements: [],
          audit: [
            {
              id: randomUUID(),
              actorId: userId,
              action: "OPENED",
              at: new Date().toISOString(),
            },
          ],
          submissions: { create: digest(data) },
          snapshot: null,
        };
        const row = await tx.tabSession.create({
          data: {
            createdBy: userId,
            clientId: data.clientId,
            title: data.title,
            currency: data.currency,
            ...(data.scope.kind === "DM"
              ? { directId: data.scope.id }
              : { groupId: data.scope.id, channelId: data.scope.channelId }),
            state: state as unknown as Prisma.InputJsonValue,
          },
        });
        await publishFeature(
          tx,
          userId,
          data.scope,
          { tabId: row.id },
          `Tab: ${row.title}`,
        );
        await notifyPeople(
          tx,
          state.participants.map((p) => p.id),
        );
        return view(row, true);
      });
    },
    act(hash: string, raw: unknown) {
      const data = input(tabActionSchema, raw);
      return run(hash, async (tx, userId) => {
        await lockQuota(tx, userId);
        const { row, state, chat } = await access(tx, userId, data.id, true);
        const key = `${userId}:${data.clientId}`,
          hashValue = digest(data);
        if (state.submissions[key]) {
          if (state.submissions[key] !== hashValue)
            throw new SocialError("SUBMISSION_CONFLICT");
          return view(row, chat.canManage);
        }
        if (row.version !== data.version)
          throw new SocialError("SUBMISSION_CONFLICT");
        await limit(tx, userId, "managed");
        if (Object.keys(state.submissions).length >= 2000)
          throw new SocialError("LIMIT_REACHED");
        const action = data.action,
          now = new Date();
        let closedAt = row.closedAt;
        if (closedAt && !["SETTLE", "CONFIRM_SETTLEMENT"].includes(action.kind))
          throw new SocialError("FORBIDDEN");
        const assertParticipant = (id: string) => {
          if (!state.participants.some((p) => p.id === id))
            throw new SocialError("INVALID_REQUEST");
        };
        if (action.kind === "ORDER") {
          if (state.orders.length >= 500)
            throw new SocialError("LIMIT_REACHED");
          const ids = action.allocations.map((a) => a.userId);
          ids.forEach(assertParticipant);
          if (new Set(ids).size !== ids.length || !ids.includes(userId))
            throw new SocialError("INVALID_REQUEST");
          if (action.split === "OWN" && action.total !== undefined)
            throw new SocialError("INVALID_REQUEST");
          const total = action.total ?? action.unitPrice * action.quantity;
          let allocations: TabAllocation[];
          if (action.split === "OWN") {
            if (ids.length !== 1 || ids[0] !== userId)
              throw new SocialError("INVALID_REQUEST");
            allocations = [{ userId, amount: total, accepted: true }];
          } else if (action.split === "CUSTOM") {
            if (
              action.allocations.some((a) => a.amount === undefined) ||
              action.allocations.reduce(
                (sum, a) => sum + (a.amount ?? 0),
                0,
              ) !== total
            )
              throw new SocialError("INVALID_REQUEST");
            allocations = action.allocations.map((a) => ({
              userId: a.userId,
              amount: a.amount!,
              accepted: a.userId === userId,
            }));
          } else {
            if (
              action.split === "QUANTITY" &&
              (action.allocations.some((a) => !a.weight) ||
                action.allocations.reduce(
                  (sum, a) => sum + (a.weight ?? 0),
                  0,
                ) !== action.quantity)
            )
              throw new SocialError("INVALID_REQUEST");
            allocations = splitMinorUnits(
              total,
              action.allocations.map((a) => ({
                userId: a.userId,
                weight: action.split === "EQUAL" ? 1 : a.weight!,
              })),
            ).map((a) => ({ ...a, accepted: a.userId === userId }));
          }
          state.orders.push({
            id: randomUUID(),
            authorId: userId,
            name: action.name,
            unitPrice: action.unitPrice,
            quantity: action.quantity,
            total,
            allocations,
            status: allocations.every((a) => a.accepted)
              ? "CONFIRMED"
              : "PROPOSED",
            createdAt: now.toISOString(),
          });
        } else if (action.kind === "EDIT_ORDER") {
          const order = state.orders.find((o) => o.id === action.orderId);
          if (
            !order ||
            order.authorId !== userId ||
            order.status !== "CONFIRMED" ||
            order.allocations.length !== 1 ||
            order.allocations[0]?.userId !== userId
          )
            throw new SocialError("FORBIDDEN");
          order.name = action.name;
          order.unitPrice = action.unitPrice;
          order.quantity = action.quantity;
          order.total = action.unitPrice * action.quantity;
          order.allocations[0]!.amount = order.total;
          const summary = tabSummary(state);
          if (summary.paidTotal > summary.total)
            throw new SocialError("PAYMENTS_EXCEED_TOTAL");
        } else if (action.kind === "ACCEPT_ORDER") {
          const order = state.orders.find((o) => o.id === action.orderId);
          const allocation = order?.allocations.find(
            (a) => a.userId === userId,
          );
          if (!order || !allocation || order.status !== "PROPOSED")
            throw new SocialError("FORBIDDEN");
          if (!action.accept) order.status = "CANCELLED";
          else {
            allocation.accepted = true;
            if (order.allocations.every((a) => a.accepted))
              order.status = "CONFIRMED";
          }
        } else if (action.kind === "CANCEL_ORDER") {
          const order = state.orders.find((o) => o.id === action.orderId);
          if (
            !order ||
            order.authorId !== userId ||
            order.status === "CANCELLED" ||
            (order.status === "CONFIRMED" &&
              order.allocations.some((a) => a.userId !== userId))
          )
            throw new SocialError("FORBIDDEN");
          order.status = "CANCELLED";
          if (tabSummary(state).paidTotal > tabSummary(state).total)
            throw new SocialError("PAYMENTS_EXCEED_TOTAL");
        } else if (action.kind === "PAYMENT") {
          const summary = tabSummary(state);
          if (
            action.amount > summary.total - summary.paidTotal ||
            state.payments.length >= 500
          )
            throw new SocialError("INVALID_REQUEST");
          state.payments.push({
            id: randomUUID(),
            userId,
            amount: action.amount,
            createdAt: now.toISOString(),
          });
        } else if (action.kind === "CANCEL_PAYMENT") {
          const payment = state.payments.find((p) => p.id === action.paymentId);
          if (
            !payment ||
            payment.userId !== userId ||
            state.settlements.some((s) => s.confirmed)
          )
            throw new SocialError("FORBIDDEN");
          state.payments = state.payments.filter((p) => p.id !== payment.id);
        } else if (action.kind === "SETTLE") {
          assertParticipant(action.to);
          const summary = tabSummary(state),
            own = summary.people.find((p) => p.userId === userId)!,
            target = summary.people.find((p) => p.userId === action.to)!;
          if (
            userId === action.to ||
            action.amount > own.balance ||
            action.amount > -target.balance ||
            state.settlements.some(
              (s) => !s.confirmed && s.from === userId && s.to === action.to,
            )
          )
            throw new SocialError("INVALID_REQUEST");
          state.settlements.push({
            id: randomUUID(),
            from: userId,
            to: action.to,
            amount: action.amount,
            confirmed: false,
          });
        } else if (action.kind === "CONFIRM_SETTLEMENT") {
          const settlement = state.settlements.find(
            (s) => s.id === action.settlementId,
          );
          if (!settlement || settlement.to !== userId || settlement.confirmed)
            throw new SocialError("FORBIDDEN");
          const summary = tabSummary(state),
            from = summary.people.find((p) => p.userId === settlement.from)!,
            to = summary.people.find((p) => p.userId === settlement.to)!;
          if (
            settlement.amount > from.balance ||
            settlement.amount > -to.balance
          )
            throw new SocialError("SUBMISSION_CONFLICT");
          settlement.confirmed = true;
        } else if (action.kind === "CLOSE") {
          if (!chat.canManage) throw new SocialError("FORBIDDEN");
          if (state.orders.some((o) => o.status === "PROPOSED"))
            throw new SocialError("PENDING_CONFIRMATIONS");
          state.snapshot = tabSummary(state);
          closedAt = now;
        }
        state.audit.push({
          id: randomUUID(),
          actorId: userId,
          action: action.kind,
          at: now.toISOString(),
          details: JSON.stringify(action),
        });
        state.submissions[key] = hashValue;
        const updated = await tx.tabSession.update({
          where: { id: row.id },
          data: {
            state: state as unknown as Prisma.InputJsonValue,
            version: { increment: 1 },
            closedAt,
          },
        });
        await notifyPeople(
          tx,
          chat.people
            .filter((p) => state.participants.some((q) => q.id === p.id))
            .map((p) => p.id),
        );
        return view(updated, chat.canManage);
      });
    },
  };
}
