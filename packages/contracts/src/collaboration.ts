import { z } from "zod";
export const chatScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("DM"), id: z.uuid() }).strict(),
  z
    .object({ kind: z.literal("GROUP"), id: z.uuid(), channelId: z.uuid() })
    .strict(),
]);
export type ChatScope = z.infer<typeof chatScopeSchema>;
const timezone = z
  .string()
  .max(80)
  .refine((v) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: v });
      return true;
    } catch {
      return false;
    }
  });
export const calendarFieldsSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000).default(""),
    location: z.string().trim().max(200).default(""),
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    timezone,
  })
  .strict()
  .refine(
    (v) =>
      Date.parse(v.endsAt) > Date.parse(v.startsAt) &&
      Date.parse(v.endsAt) - Date.parse(v.startsAt) <= 31 * 86400000,
    "Choose an end after the start, within 31 days.",
  );
export type CalendarFields = z.infer<typeof calendarFieldsSchema>;
export const calendarCreateSchema = z
  .object({
    clientId: z.uuid(),
    event: calendarFieldsSchema,
    scope: chatScopeSchema.optional(),
    usernames: z.array(z.string().max(30)).max(30).default([]),
  })
  .strict();
export const calendarRespondSchema = z
  .object({
    id: z.uuid(),
    response: z.enum(["GOING", "MAYBE", "DECLINED", "INVITED"]).optional(),
    subscribed: z.boolean().optional(),
  })
  .strict()
  .refine((v) => v.response !== undefined || v.subscribed !== undefined);
export const calendarEditSchema = z
  .object({
    id: z.uuid(),
    version: z.number().int().positive(),
    event: calendarFieldsSchema,
  })
  .strict();
export type CalendarEventView = CalendarFields & {
  id: string;
  ownerId: string;
  version: number;
  cancelled: boolean;
  scope: ChatScope | null;
  participants: {
    userId: string;
    displayName: string | null;
    username: string | null;
    response: "INVITED" | "GOING" | "MAYBE" | "DECLINED";
    subscribed: boolean;
  }[];
};
export type FeatureReference = { kind: "EVENT" | "TAB"; id: string };
export type TabAllocation = {
  userId: string;
  amount: number;
  accepted: boolean;
};
export type TabOrder = {
  id: string;
  authorId: string;
  name: string;
  unitPrice: number;
  quantity: number;
  total: number;
  allocations: TabAllocation[];
  status: "PROPOSED" | "CONFIRMED" | "CANCELLED";
  createdAt: string;
};
export type TabPayment = {
  id: string;
  userId: string;
  amount: number;
  createdAt: string;
};
export type TabSettlement = {
  id: string;
  from: string;
  to: string;
  amount: number;
  confirmed: boolean;
};
export type TabSummary = {
  total: number;
  pendingTotal: number;
  paidTotal: number;
  people: { userId: string; consumed: number; paid: number; balance: number }[];
  transfers: { from: string; to: string; amount: number }[];
};
export type TabState = {
  participants: { id: string; displayName: string; username: string }[];
  orders: TabOrder[];
  payments: TabPayment[];
  settlements: TabSettlement[];
  audit: {
    id: string;
    actorId: string;
    action: string;
    at: string;
    details?: string;
  }[];
  submissions: Record<string, string>;
  snapshot: TabSummary | null;
};
export type TabView = {
  id: string;
  title: string;
  currency: "TRY" | "EUR" | "USD" | "GBP";
  scope: ChatScope;
  createdBy: string;
  version: number;
  closedAt: string | null;
  createdAt: string;
  state: TabState;
  summary: TabSummary;
  canManage: boolean;
};
export const tabCreateSchema = z
  .object({
    clientId: z.uuid(),
    title: z.string().trim().min(1).max(100),
    currency: z.enum(["TRY", "EUR", "USD", "GBP"]).default("TRY"),
    scope: chatScopeSchema,
    participantIds: z.array(z.uuid()).min(1).max(100),
  })
  .strict();
const minor = z.number().int().min(1).max(100_000_000);
export const tabActionSchema = z
  .object({
    id: z.uuid(),
    clientId: z.uuid(),
    version: z.number().int().positive(),
    action: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("ORDER"),
          name: z.string().trim().min(1).max(120),
          unitPrice: minor,
          total: minor.optional(),
          quantity: z.number().int().min(1).max(100),
          split: z.enum(["OWN", "EQUAL", "QUANTITY", "CUSTOM"]),
          allocations: z
            .array(
              z
                .object({
                  userId: z.uuid(),
                  weight: z.number().int().min(1).max(1000).optional(),
                  amount: minor.optional(),
                })
                .strict(),
            )
            .min(1)
            .max(100),
        })
        .strict(),
      z
        .object({
          kind: z.literal("ACCEPT_ORDER"),
          orderId: z.uuid(),
          accept: z.boolean(),
        })
        .strict(),
      z.object({ kind: z.literal("CANCEL_ORDER"), orderId: z.uuid() }).strict(),
      z
        .object({
          kind: z.literal("EDIT_ORDER"),
          orderId: z.uuid(),
          name: z.string().trim().min(1).max(120),
          unitPrice: minor,
          quantity: z.number().int().min(1).max(100),
        })
        .strict(),
      z.object({ kind: z.literal("PAYMENT"), amount: minor }).strict(),
      z
        .object({ kind: z.literal("CANCEL_PAYMENT"), paymentId: z.uuid() })
        .strict(),
      z
        .object({ kind: z.literal("SETTLE"), to: z.uuid(), amount: minor })
        .strict(),
      z
        .object({
          kind: z.literal("CONFIRM_SETTLEMENT"),
          settlementId: z.uuid(),
        })
        .strict(),
      z.object({ kind: z.literal("CLOSE"), confirm: z.literal(true) }).strict(),
    ]),
  })
  .strict();
