import type { PlanInput, PlanView } from "@merkat/contracts";
export interface PlanRepository {
  list(userId: string): Promise<PlanView[]>;
  create(userId: string, input: PlanInput): Promise<PlanView>;
  respond(
    userId: string,
    planId: string,
    response: "GOING" | "MAYBE" | "DECLINED",
  ): Promise<boolean>;
  cancel(userId: string, planId: string): Promise<boolean>;
  findPerson(
    username: string,
    tokenHash: string,
  ): Promise<{
    id: string;
    username: string | null;
    displayName: string | null;
  } | null>;
}
