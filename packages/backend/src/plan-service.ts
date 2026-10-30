import { z } from "zod";
import { planInputSchema } from "@merkat/contracts";
import {
  AccountError,
  hashSessionToken,
  type AccountService,
} from "./account/account-service.js";
import type { PlanRepository } from "./plans.js";
import { brandDomainError, hasDomainError } from "./domain-error.js";

export class PlanError extends Error {
  constructor(
    public readonly code:
      | "INVALID_PLAN"
      | "INVALID_REQUEST"
      | "CONVERSATION_UNAVAILABLE"
      | "PARTICIPANT_NOT_FOUND"
      | "NOT_FOUND",
  ) {
    super(code);
    brandDomainError(this, "plan");
  }
}
export function isPlanError(error: unknown): error is PlanError {
  return hasDomainError(error, "plan");
}
const responseSchema = z
  .object({
    id: z.uuid(),
    action: z.enum(["GOING", "MAYBE", "DECLINED", "CANCEL"]),
  })
  .strict();
const personSchema = z
  .object({
    username: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z][a-z0-9_]{2,29}$/),
  })
  .strict();

/** Existing plan behavior; provider-linked plans remain unavailable in Phase 3.5. */
export class PlanService {
  constructor(
    private readonly accounts: AccountService,
    private readonly repository: PlanRepository,
  ) {}
  private async owner(token?: string) {
    const user = await this.accounts.current(token);
    if (!user?.onboardingComplete) throw new AccountError("UNAUTHORIZED");
    return user.id;
  }
  async list(token?: string) {
    return this.repository.list(await this.owner(token));
  }
  async create(token: string | undefined, input: unknown) {
    const userId = await this.owner(token);
    const parsed = planInputSchema.safeParse(input);
    if (!parsed.success) throw new PlanError("INVALID_PLAN");
    if (parsed.data.conversationId)
      throw new PlanError("CONVERSATION_UNAVAILABLE");
    try {
      return await this.repository.create(userId, parsed.data);
    } catch (error) {
      if (error instanceof Error && error.message === "PARTICIPANT_NOT_FOUND")
        throw new PlanError("PARTICIPANT_NOT_FOUND");
      throw error;
    }
  }
  async respond(token: string | undefined, input: unknown) {
    const userId = await this.owner(token);
    const parsed = responseSchema.safeParse(input);
    if (!parsed.success) throw new PlanError("INVALID_REQUEST");
    const { id, action } = parsed.data;
    const changed =
      action === "CANCEL"
        ? await this.repository.cancel(userId, id)
        : await this.repository.respond(userId, id, action);
    if (!changed) throw new PlanError("NOT_FOUND");
  }
  async findPerson(token: string | undefined, input: unknown) {
    await this.owner(token);
    const parsed = personSchema.safeParse(input);
    if (!parsed.success) throw new PlanError("INVALID_REQUEST");
    const person = await this.repository.findPerson(
      parsed.data.username,
      hashSessionToken(token!),
    );
    if (!person) throw new PlanError("NOT_FOUND");
    return person;
  }
}
