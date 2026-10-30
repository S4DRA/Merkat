import { createHmac, randomBytes } from "node:crypto";
import { hash, verify, argon2id } from "argon2";
import {
  registrationInputSchema,
  loginInputSchema,
  normalizeUsername,
  type Account,
  type RegistrationInput,
} from "@merkat/contracts";
import {
  createSessionMaterial,
  hashSessionToken,
} from "./account/account-service.js";
import { brandDomainError, hasDomainError } from "./domain-error.js";

export class AuthenticationError extends Error {
  constructor(
    public readonly code:
      "INVALID_REGISTRATION" | "ACCOUNT_UNAVAILABLE" | "INVALID_CREDENTIALS",
  ) {
    super(code);
    brandDomainError(this, "authentication");
  }
}
export class AuthenticationLimitError extends Error {
  constructor(public readonly retryAfter: number) {
    super("TRY_LATER");
    brandDomainError(this, "authentication-limit");
  }
}
export function isAuthenticationError(
  error: unknown,
): error is AuthenticationError {
  return hasDomainError(error, "authentication");
}
export function isAuthenticationLimitError(
  error: unknown,
): error is AuthenticationLimitError {
  return hasDomainError(error, "authentication-limit");
}
type SessionMaterial = ReturnType<typeof createSessionMaterial>;
export interface CredentialRepository {
  register(
    profile: Omit<RegistrationInput, "password">,
    passwordHash: string,
    session: SessionMaterial,
    now: Date,
  ): Promise<Account>;
  findCredential(
    username: string,
  ): Promise<{ userId: string; passwordHash: string } | null>;
  login(
    credential: { userId: string; passwordHash: string },
    username: string,
    session: SessionMaterial,
    now: Date,
    previousHash?: string,
  ): Promise<Account>;
}
export type AuthScope =
  | "login-account"
  | "login-source"
  | "login-global"
  | "register-account"
  | "register-source"
  | "register-global";
export interface AuthenticationBucket {
  scope: AuthScope;
  slot: number;
  limit: number;
  seconds: number;
}
export interface AuthenticationLimiter {
  consume(buckets: readonly AuthenticationBucket[]): Promise<number>;
}
const options = {
  type: argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
  hashLength: 32,
} as const;
export function createPasswordHasher() {
  // Every login awaits the same readiness promise and performs one Argon2 verify,
  // including nonexistent, credential-less and suspended accounts.
  const dummy = hash(randomBytes(32).toString("hex"), options);
  return {
    hash: (password: string) => hash(password, options),
    async verify(password: string, stored?: string) {
      const fallback = await dummy;
      return verify(stored ?? fallback, password);
    },
  };
}
export type PasswordHasher = ReturnType<typeof createPasswordHasher>;

export class AuthenticationService {
  constructor(
    private readonly repository: CredentialRepository,
    private readonly limiter: AuthenticationLimiter,
    private readonly secret: string,
    private readonly passwords = createPasswordHasher(),
    private readonly clock: () => Date = () => new Date(),
  ) {
    if (secret.length < 32)
      throw new Error("Authentication limiter configuration is missing.");
  }
  private async limit(
    action: "login" | "register",
    source: string,
    input: unknown,
  ) {
    const name =
      typeof input === "object" &&
      input !== null &&
      "username" in input &&
      typeof input.username === "string"
        ? normalizeUsername(input.username.slice(0, 128))
        : "";
    const slot = (kind: string, value: string) =>
      createHmac("sha256", this.secret)
        .update(`${kind}:${value}`)
        .digest()
        .readUInt32BE(0) % 65536;
    const retry = await this.limiter.consume([
      {
        scope: `${action}-source`,
        slot: slot("source", source),
        limit: action === "login" ? 30 : 10,
        seconds: action === "login" ? 900 : 3600,
      },
      {
        scope: `${action}-account`,
        slot: slot("account", name),
        limit: action === "login" ? 10 : 3,
        seconds: action === "login" ? 900 : 3600,
      },
      {
        scope: `${action}-global`,
        slot: 0,
        limit: action === "login" ? 120 : 60,
        seconds: action === "login" ? 60 : 3600,
      },
    ]);
    if (retry > 0) throw new AuthenticationLimitError(retry);
  }
  async register(input: unknown, source: string) {
    await this.limit("register", source, input);
    const parsed = registrationInputSchema.safeParse(input);
    if (!parsed.success) throw new AuthenticationError("INVALID_REGISTRATION");
    const { password, ...details } = parsed.data;
    const profile = {
      ...details,
      displayName: details.displayName ?? details.username,
    };
    // Hash even when the username already exists; no preflight availability query.
    const passwordHash = await this.passwords.hash(password);
    const now = this.clock();
    const session = createSessionMaterial(now);
    const user = await this.repository.register(
      profile,
      passwordHash,
      session,
      now,
    );
    return { user, token: session.token, expiresAt: session.expiresAt };
  }
  async checkCredentialLimit(input: unknown, source: string) {
    await this.limit("login", source, input);
  }
  async login(input: unknown, source: string, previousToken?: string) {
    await this.limit("login", source, input);
    const parsed = loginInputSchema.safeParse(input);
    const credential = parsed.success
      ? await this.repository.findCredential(parsed.data.username)
      : null;
    const correct = await this.passwords.verify(
      parsed.success ? parsed.data.password : "",
      credential?.passwordHash,
    );
    if (!parsed.success || !credential || !correct)
      throw new AuthenticationError("INVALID_CREDENTIALS");
    const now = this.clock();
    const session = createSessionMaterial(now);
    const previousHash =
      previousToken && /^[A-Za-z0-9_-]{43}$/.test(previousToken)
        ? hashSessionToken(previousToken)
        : undefined;
    const user = await this.repository.login(
      credential,
      parsed.data.username,
      session,
      now,
      previousHash,
    );
    return { user, token: session.token, expiresAt: session.expiresAt };
  }
}
