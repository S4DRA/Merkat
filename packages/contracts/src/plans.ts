import { z } from "zod";
export const planInputSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000).default(""),
    location: z.string().trim().max(200).default(""),
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    usernames: z
      .array(
        z
          .string()
          .trim()
          .toLowerCase()
          .regex(/^[a-z][a-z0-9_]{2,29}$/),
      )
      .max(30)
      .default([]),
    conversationId: z
      .string()
      .max(512)
      .regex(/^![^\s:]+:[^\s]+$/)
      .optional(),
  })
  .strict()
  .refine((p) => Date.parse(p.endsAt) > Date.parse(p.startsAt), {
    message: "End must follow start",
  });
export type PlanInput = z.infer<typeof planInputSchema>;
export type PlanView = {
  id: string;
  ownerId: string;
  title: string;
  description: string;
  location: string;
  startsAt: string;
  endsAt: string;
  conversationId: string | null;
  cancelled: boolean;
  participants: {
    userId: string;
    username: string | null;
    displayName: string | null;
    response: "GOING" | "MAYBE" | "DECLINED" | "INVITED";
  }[];
};
