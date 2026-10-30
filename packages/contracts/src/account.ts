import { z } from "zod";

export function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}
export const RESERVED_USERNAMES = [
  "admin",
  "administrator",
  "root",
  "system",
  "support",
  "security",
  "merkat",
  "api",
  "auth",
  "login",
  "logout",
  "register",
  "signup",
  "onboarding",
  "settings",
  "profile",
  "search",
  "chats",
  "calls",
  "plans",
  "groups",
  "friends",
] as const;
export const usernameFormatSchema = z
  .string()
  .transform(normalizeUsername)
  .pipe(z.string().regex(/^[a-z][a-z0-9_]{2,29}$/));
export const usernameSchema = usernameFormatSchema.refine(
  (value) => !(RESERVED_USERNAMES as readonly string[]).includes(value),
);
export const PASSWORD_MIN_LENGTH = 15;
export const PASSWORD_MAX_LENGTH = 128;
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH)
  .max(PASSWORD_MAX_LENGTH);
export const registrationInputSchema = z
  .object({
    username: usernameSchema,
    displayName: z.string().trim().min(1).max(60).optional(),
    email: z.preprocess(
      (value) =>
        typeof value === "string" && value.trim() === "" ? undefined : value,
      z.string().trim().toLowerCase().max(254).pipe(z.email()).optional(),
    ),
    password: passwordSchema,
  })
  .strict();
export const loginInputSchema = z
  .object({
    username: usernameFormatSchema,
    password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  })
  .strict();
export type RegistrationInput = z.infer<typeof registrationInputSchema>;
export const profileInputSchema = z
  .object({
    displayName: z.string().trim().min(1).max(60),
    username: usernameSchema,
    bio: z.string().trim().max(160).default(""),
  })
  .strict();
export type ProfileInput = z.infer<typeof profileInputSchema>;
export const accountSchema = z.object({
  id: z.uuid(),
  onboardingComplete: z.boolean(),
  profile: z.object({
    displayName: z.string().nullable(),
    username: z.string().nullable(),
    bio: z.string(),
    avatarRef: z.string().nullable(),
  }),
});
export type Account = z.infer<typeof accountSchema>;
export const sessionResponseSchema = z.object({ user: accountSchema });
export function sessionCookieName(production: boolean) {
  return production ? "__Host-merkat_session" : "merkat_session";
}
