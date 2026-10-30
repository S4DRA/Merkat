import { z } from "zod";

export const AVATAR_MAX_BYTES = 2_000_000;
export const appearanceSchema = z
  .object({
    theme: z.enum(["SYSTEM", "LIGHT", "DARK"]),
    reduceMotion: z.boolean(),
    largeText: z.boolean(),
    remindersEnabled: z.boolean(),
    pushEnabled: z.boolean(),
    timezone: z
      .string()
      .max(80)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }),
  })
  .strict();
export type Appearance = z.infer<typeof appearanceSchema>;
export const defaultAppearance: Appearance = {
  theme: "SYSTEM",
  reduceMotion: false,
  largeText: false,
  remindersEnabled: true,
  pushEnabled: false,
  timezone: "Europe/Istanbul",
};
export type PublicProfile = {
  id: string;
  username: string | null;
  displayName: string | null;
  bio: string;
  avatarRef: string | null;
};
