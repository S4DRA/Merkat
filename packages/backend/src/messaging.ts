import {
  conversationInputSchema,
  conversationListSchema,
  messagePageSchema,
  sendMessageSchema,
  messageReceiptSchema,
  type ConversationInput,
  type ConversationListInput,
  type MessagePageInput,
  type SendMessageInput,
  type MessageReceiptInput,
  type ConversationList,
  type DirectConversationView,
  type DirectMessageView,
  type MessagePage,
} from "@merkat/contracts";
import { AccountError, hashSessionToken } from "./account/account-service.js";
import { brandDomainError, hasDomainError } from "./domain-error.js";
import type { z } from "zod";

export class MessagingError extends Error {
  constructor(
    public readonly code:
      | "INVALID_REQUEST"
      | "NOT_FOUND"
      | "SELF_CONVERSATION"
      | "INTERACTION_UNAVAILABLE"
      | "SUBMISSION_CONFLICT"
      | "TRY_LATER",
    public readonly retryAfter = 0,
  ) {
    super(code);
    brandDomainError(this, "messaging");
  }
}
export function isMessagingError(error: unknown): error is MessagingError {
  return hasDomainError(error, "messaging");
}
export type RealtimeSession = {
  userId: string;
  sessionId: string;
  expiresAt: Date;
};
export interface MessagingRepository {
  list(hash: string, input: ConversationListInput): Promise<ConversationList>;
  open(hash: string, input: ConversationInput): Promise<DirectConversationView>;
  messages(hash: string, input: MessagePageInput): Promise<MessagePage>;
  send(hash: string, input: SendMessageInput): Promise<DirectMessageView>;
  receipt(
    hash: string,
    input: MessageReceiptInput,
  ): Promise<DirectConversationView>;
  realtimeSession(hash: string): Promise<RealtimeSession>;
}
function hash(token: string | undefined) {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token))
    throw new AccountError("UNAUTHORIZED");
  return hashSessionToken(token);
}
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new MessagingError("INVALID_REQUEST");
  return result.data;
}
export class MessagingService {
  constructor(private readonly repository: MessagingRepository) {}
  async list(token: string | undefined, input: unknown) {
    return this.repository.list(
      hash(token),
      parse(conversationListSchema, input),
    );
  }
  async open(token: string | undefined, input: unknown) {
    return this.repository.open(
      hash(token),
      parse(conversationInputSchema, input),
    );
  }
  async messages(token: string | undefined, input: unknown) {
    return this.repository.messages(
      hash(token),
      parse(messagePageSchema, input),
    );
  }
  async send(token: string | undefined, input: unknown) {
    return this.repository.send(hash(token), parse(sendMessageSchema, input));
  }
  async receipt(token: string | undefined, input: unknown) {
    return this.repository.receipt(
      hash(token),
      parse(messageReceiptSchema, input),
    );
  }
  async realtimeSession(token: string | undefined) {
    return this.repository.realtimeSession(hash(token));
  }
}
