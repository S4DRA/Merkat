/** Opaque Merkat identity, assigned by the backend; never derived from a phone or username. */
export type MerkatUserId = string & { readonly __brand: "MerkatUserId" };
export {
  accountSchema,
  sessionResponseSchema,
  profileInputSchema,
  normalizeUsername,
  sessionCookieName,
  usernameSchema,
  passwordSchema,
  registrationInputSchema,
  loginInputSchema,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  RESERVED_USERNAMES,
} from "./account.js";
export type { Account, ProfileInput, RegistrationInput } from "./account.js";
export { planInputSchema } from "./plans.js";
export type { PlanInput, PlanView } from "./plans.js";
export * from "./messaging.js";
export * from "./friendships.js";
export * from "./groups.js";
export * from "./privacy.js";
