import type { z } from "zod";
import { AccountError, hashSessionToken } from "./account/account-service.js";
import { brandDomainError, hasDomainError } from "./domain-error.js";
export class SocialError extends Error {
  constructor(
    public readonly code:
      | "INVALID_REQUEST"
      | "NOT_FOUND"
      | "FORBIDDEN"
      | "OWNER_TRANSFER_REQUIRED"
      | "DEFAULT_CHANNEL"
      | "LIMIT_REACHED"
      | "SUBMISSION_CONFLICT"
      | "CHANNEL_NAME_TAKEN"
      | "INTERACTION_UNAVAILABLE"
      | "PAYMENTS_EXCEED_TOTAL"
      | "TAB_ALREADY_OPEN"
      | "PENDING_CONFIRMATIONS",
  ) {
    super(code);
    brandDomainError(this, "social");
  }
}
export function isSocialError(error: unknown): error is SocialError {
  return hasDomainError(error, "social");
}
export function socialSessionHash(token: string | undefined) {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token))
    throw new AccountError("UNAUTHORIZED");
  return hashSessionToken(token);
}
export function socialInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const value = schema.safeParse(input);
  if (!value.success) throw new SocialError("INVALID_REQUEST");
  return value.data;
}
