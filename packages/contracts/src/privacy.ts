import { z } from "zod";
import type { PublicPerson } from "./groups.js";
export const privacySettingsSchema = z
  .object({
    allowNonFriendDms: z.boolean(),
    groupInvitesFrom: z.enum(["FRIENDS", "EVERYONE", "NOBODY"]),
  })
  .strict();
export const blockUserSchema = z
  .object({ userId: z.uuid(), blocked: z.boolean() })
  .strict();
export const blockedListSchema = z
  .object({
    before: z
      .object({ createdAt: z.iso.datetime(), id: z.uuid() })
      .strict()
      .optional(),
  })
  .strict();
export const safetyReportSchema = z
  .object({
    clientId: z.uuid(),
    target: z
      .object({ kind: z.enum(["USER", "GROUP"]), id: z.uuid() })
      .strict(),
    category: z.enum(["SPAM", "HARASSMENT", "OTHER"]),
    reason: z
      .string()
      .trim()
      .min(1)
      .max(1000)
      .refine((v) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v)),
  })
  .strict();
export type PrivacySettings = z.infer<typeof privacySettingsSchema>;
export type BlockUserInput = z.infer<typeof blockUserSchema>;
export type BlockedListInput = z.infer<typeof blockedListSchema>;
export type SafetyReportInput = z.infer<typeof safetyReportSchema>;
export type BlockedList = {
  people: (PublicPerson & { createdAt: string })[];
  nextCursor: BlockedListInput["before"] | null;
};
