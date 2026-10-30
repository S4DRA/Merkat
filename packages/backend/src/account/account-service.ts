import { createHash, randomBytes } from "node:crypto";
import { brandDomainError, hasDomainError } from "../domain-error.js";
import {
  profileInputSchema,
  type Account,
  type ProfileInput,
} from "@merkat/contracts";
import type {
  IdentityProvider,
  VerifiedExternalIdentity,
} from "../identity/identity-provider.js";

export class AccountError extends Error {
  constructor(
    public readonly code:
      | "UNAUTHORIZED"
      | "INVALID_PROFILE"
      | "USERNAME_UNAVAILABLE"
      | "IDENTITY_REJECTED",
  ) {
    super(code);
    brandDomainError(this, "account");
  }
}
export function isAccountError(error: unknown): error is AccountError {
  return hasDomainError(error, "account");
}
export interface AccountRepository {
  signIn(
    identity: VerifiedExternalIdentity,
    tokenHash: string,
    expiresAt: Date,
    now: Date,
    previousHash?: string,
  ): Promise<Account>;
  findSession(tokenHash: string, now: Date): Promise<Account | null>;
  revokeSession(tokenHash: string, now: Date): Promise<void>;
  rotateSession(
    oldHash: string,
    newHash: string,
    now: Date,
  ): Promise<Date | null>;
  saveProfile(
    tokenHash: string,
    now: Date,
    profile: ProfileInput,
  ): Promise<Account>;
}
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
export function createSessionMaterial(now: Date) {
  const token = randomBytes(32).toString("base64url");
  return {
    token,
    tokenHash: hashSessionToken(token),
    expiresAt: new Date(now.getTime() + SESSION_TTL_SECONDS * 1000),
  };
}
export function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
const validToken = (token: string | undefined): token is string =>
  !!token && /^[A-Za-z0-9_-]{43}$/.test(token);

export class AccountService {
  constructor(
    private readonly repository: AccountRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}
  // Legacy provider seam. Password auth uses the same session material/persistence rules.
  async signIn(
    provider: IdentityProvider,
    credential: string,
    previousToken?: string,
  ) {
    const identity = await provider.verifyCredential(credential);
    if (
      !identity.issuer ||
      !identity.subject ||
      identity.issuer.length > 512 ||
      identity.subject.length > 512
    )
      throw new AccountError("IDENTITY_REJECTED");
    const now = this.clock();
    const { token, tokenHash, expiresAt } = createSessionMaterial(now);
    const user = await this.repository.signIn(
      identity,
      tokenHash,
      expiresAt,
      now,
      validToken(previousToken) ? hashSessionToken(previousToken) : undefined,
    );
    return { user, token, expiresAt };
  }
  async current(token?: string) {
    return validToken(token)
      ? this.repository.findSession(hashSessionToken(token), this.clock())
      : null;
  }
  async logout(token?: string) {
    if (validToken(token))
      await this.repository.revokeSession(
        hashSessionToken(token),
        this.clock(),
      );
  }
  async rotate(token?: string) {
    if (!validToken(token)) throw new AccountError("UNAUTHORIZED");
    const replacement = randomBytes(32).toString("base64url");
    const expiresAt = await this.repository.rotateSession(
      hashSessionToken(token),
      hashSessionToken(replacement),
      this.clock(),
    );
    if (!expiresAt) throw new AccountError("UNAUTHORIZED");
    return { token: replacement, expiresAt };
  }
  async saveProfile(token: string | undefined, input: unknown) {
    if (!validToken(token)) throw new AccountError("UNAUTHORIZED");
    const result = profileInputSchema.safeParse(input);
    if (!result.success) throw new AccountError("INVALID_PROFILE");
    return this.repository.saveProfile(
      hashSessionToken(token),
      this.clock(),
      result.data,
    );
  }
}
