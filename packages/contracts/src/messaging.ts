import { z } from "zod";

export const MESSAGE_MAX_LENGTH = 4000;
const sequence = z.number().int().min(0).max(2147483647);
export const conversationInputSchema = z
  .object({
    username: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z][a-z0-9_]{2,29}$/),
  })
  .strict();
export const conversationListSchema = z
  .object({
    before: z
      .object({ activityAt: z.iso.datetime(), id: z.uuid() })
      .strict()
      .optional(),
  })
  .strict();
export const messagePageSchema = z
  .object({
    conversationId: z.uuid(),
    before: sequence.min(1).optional(),
    after: sequence.optional(),
    through: sequence.optional(),
  })
  .strict()
  .refine(
    (v) =>
      !(v.before !== undefined && v.after !== undefined) &&
      (v.through === undefined || v.after !== undefined),
  );
export const sendMessageSchema = z
  .object({
    conversationId: z.uuid(),
    clientId: z.uuid(),
    text: z
      .string()
      .trim()
      .min(1)
      .max(MESSAGE_MAX_LENGTH)
      .refine((v) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v)),
  })
  .strict();
export const messageReceiptSchema = z
  .object({
    conversationId: z.uuid(),
    deliveredSequence: sequence,
    readSequence: sequence.optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.readSequence === undefined || v.readSequence <= v.deliveredSequence,
  );

export type ConversationInput = z.infer<typeof conversationInputSchema>;
export type ConversationListInput = z.infer<typeof conversationListSchema>;
export type MessagePageInput = z.infer<typeof messagePageSchema>;
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type MessageReceiptInput = z.infer<typeof messageReceiptSchema>;
export type DirectMessageView = {
  id: string;
  conversationId: string;
  senderId: string;
  clientId: string;
  sequence: number;
  text: string;
  createdAt: string;
};
export type DirectConversationView = {
  canSend?: boolean;
  blockedByYou?: boolean;
  id: string;
  peer: { id: string; username: string | null; displayName: string | null };
  latestMessage: DirectMessageView | null;
  activityAt: string;
  lastSequence: number;
  unreadCount: number;
  deliveredSequence: number;
  readSequence: number;
  peerDeliveredSequence: number;
  peerReadSequence: number;
};
export type ConversationList = {
  conversations: DirectConversationView[];
  nextCursor: ConversationListInput["before"] | null;
  unreadConversations: number;
};
export type MessagePage = {
  conversation: DirectConversationView;
  messages: DirectMessageView[];
  hasMore: boolean;
  through: number;
};
export type RealtimeCapability = {
  url: string;
  publishableKey: string;
  token: string;
  expiresAt: number;
  topic: string;
};
