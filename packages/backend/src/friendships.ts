import {
  friendListSchema,
  friendActionSchema,
  friendRequestSchema,
  type FriendListInput,
  type FriendActionInput,
  type FriendList,
  type FriendView,
} from "@merkat/contracts";
import { AccountError, hashSessionToken } from "./account/account-service.js";
import { brandDomainError, hasDomainError } from "./domain-error.js";
export class FriendshipError extends Error {
  constructor(
    public readonly code:
      "INVALID_REQUEST" | "NOT_FOUND" | "SELF_FRIENDSHIP" | "PENDING_LIMIT",
    public readonly retryAfter = 0,
  ) {
    super(code);
    brandDomainError(this, "friendship");
  }
}
export function isFriendshipError(error: unknown): error is FriendshipError {
  return hasDomainError(error, "friendship");
}
export interface FriendshipRepository {
  list(hash: string, input: FriendListInput): Promise<FriendList>;
  request(hash: string, username: string): Promise<FriendView>;
  act(hash: string, input: FriendActionInput): Promise<void>;
}
function hash(token?: string) {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token))
    throw new AccountError("UNAUTHORIZED");
  return hashSessionToken(token);
}
export class FriendshipService {
  constructor(private readonly repository: FriendshipRepository) {}
  async list(token: string | undefined, input: unknown) {
    const value = friendListSchema.safeParse(input);
    const session = hash(token);
    if (!value.success) throw new FriendshipError("INVALID_REQUEST");
    return this.repository.list(session, value.data);
  }
  async request(token: string | undefined, input: unknown) {
    const value = friendRequestSchema.safeParse(input);
    const session = hash(token);
    if (!value.success) throw new FriendshipError("INVALID_REQUEST");
    return this.repository.request(session, value.data.username);
  }
  async act(token: string | undefined, input: unknown) {
    const value = friendActionSchema.safeParse(input);
    const session = hash(token);
    if (!value.success) throw new FriendshipError("INVALID_REQUEST");
    return this.repository.act(session, value.data);
  }
}
