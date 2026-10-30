import { z } from "zod";
import { usernameSchema } from "./account.js";
import { sendMessageSchema } from "./messaging.js";
const title = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((v) => !/[\u0000-\u001f\u007f]/.test(v));
const sequence = z.number().int().min(0).max(2147483647);
const description = z
  .string()
  .trim()
  .max(1000)
  .refine((v) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v));
export const groupIdSchema = z.object({ groupId: z.uuid() }).strict();
export const groupCreateSchema = z
  .object({
    clientId: z.uuid(),
    name: title(80),
    description: description.default(""),
    usernames: z.array(usernameSchema).max(20).default([]),
  })
  .strict();
export const groupListSchema = z
  .object({
    before: z
      .object({ activityAt: z.iso.datetime(), id: z.uuid() })
      .strict()
      .optional(),
  })
  .strict();
export const groupEditSchema = groupIdSchema.extend({
  name: title(80),
  description,
});
export const groupInviteSchema = groupIdSchema.extend({
  username: usernameSchema,
});
export const groupMemberActionSchema = groupIdSchema.extend({
  userId: z.uuid(),
  action: z.enum(["REMOVE", "ADMIN", "MEMBER", "TRANSFER"]),
});
export const groupInvitationActionSchema = z
  .object({ id: z.uuid(), action: z.enum(["ACCEPT", "DECLINE", "REVOKE"]) })
  .strict();
export const channelCreateSchema = groupIdSchema.extend({
  name: title(60),
  clientId: z.uuid(),
});
export const channelEditSchema = groupIdSchema
  .extend({
    channelId: z.uuid(),
    action: z.enum(["RENAME", "DELETE"]),
    name: title(60).optional(),
  })
  .refine((v) => v.action !== "RENAME" || v.name !== undefined);
export const groupMessagePageSchema = groupIdSchema
  .extend({
    channelId: z.uuid(),
    before: sequence.min(1).optional(),
    after: sequence.optional(),
    through: sequence.optional(),
  })
  .refine(
    (v) =>
      !(v.before !== undefined && v.after !== undefined) &&
      (v.through === undefined || v.after !== undefined),
  );
export const groupSendSchema = groupIdSchema.extend({
  channelId: z.uuid(),
  clientId: z.uuid(),
  text: sendMessageSchema.shape.text,
  replyToId: z.uuid().optional(),
});
export const groupReceiptSchema = groupIdSchema
  .extend({
    channelId: z.uuid(),
    deliveredSequence: sequence,
    readSequence: sequence.optional(),
  })
  .refine(
    (v) =>
      v.readSequence === undefined || v.readSequence <= v.deliveredSequence,
  );
export type GroupRole = "OWNER" | "ADMIN" | "MEMBER";
export type PublicPerson = {
  id: string;
  username: string | null;
  displayName: string | null;
};
export type GroupMemberView = PublicPerson & {
  role: GroupRole;
  joinedAt: string;
};
export type GroupMessageView = {
  id: string;
  groupId: string;
  channelId: string;
  senderId: string;
  sender: PublicPerson;
  clientId: string;
  sequence: number;
  text: string;
  createdAt: string;
  replyTo: { id: string; text: string; senderId: string } | null;
};
export type GroupChannelView = {
  id: string;
  name: string;
  position: number;
  isDefault: boolean;
  lastSequence: number;
  unreadCount: number;
  readSequence: number;
  deliveredSequence: number;
};
export type GroupSummary = {
  id: string;
  name: string;
  description: string;
  role: GroupRole;
  activityAt: string;
  memberCount: number;
  unreadCount: number;
  defaultChannelId: string;
};
export type GroupDetail = GroupSummary & {
  members: GroupMemberView[];
  channels: GroupChannelView[];
  invitations: { id: string; person: PublicPerson }[];
};
export type GroupInvitationView = {
  id: string;
  groupId: string;
  groupName: string;
  invitedBy: PublicPerson;
  createdAt: string;
};
export type GroupList = {
  groups: GroupSummary[];
  nextCursor: z.infer<typeof groupListSchema>["before"] | null;
  invitations: GroupInvitationView[];
  hasMoreInvitations: boolean;
};
export type GroupMessagePage = {
  group: GroupDetail;
  messages: GroupMessageView[];
  hasMore: boolean;
  through: number;
};
export type GroupCreateInput = z.infer<typeof groupCreateSchema>;
export type GroupListInput = z.infer<typeof groupListSchema>;
export type GroupEditInput = z.infer<typeof groupEditSchema>;
export type GroupInviteInput = z.infer<typeof groupInviteSchema>;
export type GroupMemberActionInput = z.infer<typeof groupMemberActionSchema>;
export type GroupInvitationActionInput = z.infer<
  typeof groupInvitationActionSchema
>;
export type ChannelCreateInput = z.infer<typeof channelCreateSchema>;
export type ChannelEditInput = z.infer<typeof channelEditSchema>;
export type GroupMessagePageInput = z.infer<typeof groupMessagePageSchema>;
export type GroupSendInput = z.infer<typeof groupSendSchema>;
export type GroupReceiptInput = z.infer<typeof groupReceiptSchema>;
