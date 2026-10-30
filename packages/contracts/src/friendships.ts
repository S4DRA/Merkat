import { z } from "zod";
import { conversationInputSchema } from "./messaging.js";
export const friendRequestSchema = conversationInputSchema;
export const friendListSchema = z
  .object({
    section: z.enum(["FRIENDS", "INCOMING", "OUTGOING"]),
    before: z
      .object({ id: z.uuid(), createdAt: z.iso.datetime() })
      .strict()
      .optional(),
  })
  .strict();
export const friendActionSchema = z
  .object({
    id: z.uuid(),
    action: z.enum(["ACCEPT", "DECLINE", "CANCEL", "REMOVE"]),
  })
  .strict();
export type FriendListInput = z.infer<typeof friendListSchema>;
export type FriendActionInput = z.infer<typeof friendActionSchema>;
export type FriendView = {
  id: string;
  person: { id: string; username: string | null; displayName: string | null };
  requestedById: string;
  status: "PENDING" | "ACCEPTED";
  createdAt: string;
  acceptedAt: string | null;
};
export type FriendList = {
  people: FriendView[];
  nextCursor: FriendListInput["before"] | null;
  incomingCount: number;
};
