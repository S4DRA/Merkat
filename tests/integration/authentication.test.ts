import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { verify } from "argon2";
import {
  AccountService,
  PlanService,
  AuthenticationService,
  AuthenticationError,
  AuthenticationLimitError,
  isAuthenticationError,
  createPasswordHasher,
  hashSessionToken,
} from "@merkat/backend";
import {
  createDatabase,
  createAccountRepository,
  createCredentialRepository,
  createAuthenticationLimiter,
  createPlanRepository,
} from "@merkat/database";
import { RESERVED_USERNAMES, usernameSchema } from "@merkat/contracts";
import { createApiHandler } from "../../apps/web/src/lib/server/http-api.js";
import {
  authenticationConfigured,
  authenticationSource,
} from "../../apps/web/src/lib/server/authentication-environment.js";
import {
  POST as browserPost,
  GET as browserGet,
} from "../../apps/web/src/app/api/account/[...path]/route.js";
import { getServices } from "../../apps/web/src/lib/server/runtime.js";

if (!process.env.TEST_DATABASE_URL)
  throw new Error("Use the isolated integration runner.");
const db = createDatabase({ DATABASE_URL: process.env.TEST_DATABASE_URL });
const otherDb = createDatabase({ DATABASE_URL: process.env.TEST_DATABASE_URL });
const accounts = new AccountService(createAccountRepository(db));
const repository = createCredentialRepository(db);
const limiter = createAuthenticationLimiter(db);
const secret = randomBytes(32).toString("hex");
const passwords = createPasswordHasher();
const auth = new AuthenticationService(repository, limiter, secret, passwords);
const secondInstance = new AuthenticationService(
  createCredentialRepository(otherDb),
  createAuthenticationLimiter(otherDb),
  secret,
  passwords,
);
const password = "a memorable password for tests";
const source = () => `test-${randomUUID()}`;
const input = () => ({
  username: `p${randomUUID().replaceAll("-", "").slice(0, 20)}`,
  displayName: "Test Person",
  password,
});
const code = (expected: string) => (error: unknown) =>
  error instanceof AuthenticationError && error.code === expected;
let runtimeUsed = false;
after(async () => {
  if (runtimeUsed) await getServices().database.$disconnect();
  await db.$disconnect();
  await otherDb.$disconnect();
});

test("real registration atomically creates a complete profile, Argon2id credential and hashed session", async () => {
  const value = input();
  const session = await auth.register(
    { ...value, username: ` ${value.username.toUpperCase()} ` },
    source(),
  );
  assert.equal(session.user.onboardingComplete, true);
  assert.equal(session.user.profile.username, value.username);
  assert.equal(session.user.profile.bio, "");
  assert.match(session.user.id, /^[0-9a-f-]{36}$/);
  const stored = await db.passwordCredential.findUniqueOrThrow({
    where: { userId: session.user.id },
  });
  assert.match(
    stored.passwordHash,
    /^\$argon2id\$v=19\$m=19456,(?:t=2,p=1|p=1,t=2)\$/,
  );
  assert.notEqual(stored.passwordHash, password);
  assert.equal(await verify(stored.passwordHash, password), true);
  assert.equal(await verify(stored.passwordHash, "wrong password"), false);
  const token = await db.session.findUniqueOrThrow({
    where: { tokenHash: hashSessionToken(session.token) },
  });
  assert.equal(token.userId, session.user.id);
  assert.notEqual(token.tokenHash, session.token);
  assert.equal((await accounts.current(session.token))?.id, session.user.id);
  assert.equal(
    await db.externalIdentity.count({ where: { userId: session.user.id } }),
    0,
  );
});

test("duplicates and concurrent registration cannot leave partial accounts", async () => {
  const value = input();
  const before = await db.user.count();
  const results = await Promise.allSettled([
    auth.register(value, source()),
    secondInstance.register(
      { ...value, username: value.username.toUpperCase() },
      source(),
    ),
  ]);
  const good = results.filter((item) => item.status === "fulfilled");
  assert.equal(good.length, 1);
  const failure = results.find((item) => item.status === "rejected");
  assert.ok(
    failure?.status === "rejected" &&
      code("ACCOUNT_UNAVAILABLE")(failure.reason),
  );
  assert.equal(await db.user.count(), before + 1);
  assert.equal(
    await db.profile.count({ where: { username: value.username } }),
    1,
  );
  await assert.rejects(
    auth.register(value, source()),
    code("ACCOUNT_UNAVAILABLE"),
  );
  assert.equal(await db.user.count(), before + 1);
});

test("reserved/invalid usernames and weak or oversized passwords are rejected consistently", async () => {
  for (const name of RESERVED_USERNAMES)
    assert.equal(usernameSchema.safeParse(name.toUpperCase()).success, false);
  for (const name of ["a", "1person", "has space", "ümlaut", "x".repeat(31)])
    assert.equal(usernameSchema.safeParse(name).success, false);
  for (const extra of [
    { username: "admin" },
    { password: "short" },
    { password: "x".repeat(129) },
    { displayName: " " },
    { userId: randomUUID() },
  ]) {
    await assert.rejects(
      auth.register({ ...input(), ...extra }, source()),
      code("INVALID_REGISTRATION"),
    );
  }
  const value = input();
  const session = await auth.register(
    { ...value, password: "这是一个很长的密码短语 可以粘贴使用 ✨" },
    source(),
  );
  assert.ok(
    await auth.login(
      {
        username: value.username,
        password: "这是一个很长的密码短语 可以粘贴使用 ✨",
      },
      source(),
    ),
  );
  await assert.rejects(
    db.profile.update({
      where: { userId: session.user.id },
      data: { username: "ADMIN" },
    }),
  );
  await assert.rejects(
    db.profile.update({
      where: { userId: session.user.id },
      data: { username: "admin" },
    }),
  );
});

test("login failure is generic and performs one Argon2 verify for absent/existing/suspended accounts", async () => {
  const value = input();
  const registered = await auth.register(value, source());
  let calls = 0;
  const observed = new AuthenticationService(repository, limiter, secret, {
    hash: passwords.hash,
    async verify(candidate, stored) {
      calls++;
      return passwords.verify(candidate, stored);
    },
  });
  const before = await db.session.count();
  for (const credentials of [
    { username: value.username, password: "wrong" },
    { username: input().username, password },
    { username: "invalid space", password },
  ]) {
    const previous = calls;
    await assert.rejects(
      observed.login(credentials, source()),
      code("INVALID_CREDENTIALS"),
    );
    assert.equal(calls, previous + 1);
  }
  await db.user.update({
    where: { id: registered.user.id },
    data: { status: "SUSPENDED" },
  });
  await assert.rejects(
    observed.login({ username: value.username, password }, source()),
    code("INVALID_CREDENTIALS"),
  );
  assert.equal(calls, 4);
  assert.equal(await db.session.count(), before);
});

test("login, logout, expiry, rotation and multiple devices retain the existing lifecycle", async () => {
  const value = input();
  const first = await auth.register(value, source());
  const device = await auth.login(
    { username: ` ${value.username.toUpperCase()} `, password },
    source(),
  );
  assert.equal(first.user.id, device.user.id);
  assert.notEqual(first.token, device.token);
  const replacement = await auth.login(
    { username: value.username, password },
    source(),
    first.token,
  );
  assert.equal(await accounts.current(first.token), null);
  assert.ok(await accounts.current(device.token));
  assert.ok(await accounts.current(replacement.token));
  const rotations = await Promise.allSettled([
    accounts.rotate(replacement.token),
    accounts.rotate(replacement.token),
  ]);
  assert.equal(
    rotations.filter((result) => result.status === "fulfilled").length,
    1,
  );
  const rotated = rotations.find((result) => result.status === "fulfilled");
  assert.ok(rotated?.status === "fulfilled");
  assert.equal(
    rotated.value.expiresAt.getTime(),
    replacement.expiresAt.getTime(),
  );
  await accounts.logout(rotated.value.token);
  assert.equal(await accounts.current(rotated.value.token), null);
  const future = new AccountService(
    createAccountRepository(db),
    () => device.expiresAt,
  );
  assert.equal(await future.current(device.token), null);
});

test("profile renaming keeps UUID/credential ownership and cross-user writes remain forbidden", async () => {
  const value = input(),
    other = input();
  const one = await auth.register(value, source()),
    two = await auth.register(other, source());
  const renamed = `${value.username}x`;
  await accounts.saveProfile(one.token, {
    displayName: "Renamed",
    username: renamed,
    bio: "Hello",
  });
  await assert.rejects(
    auth.login({ username: value.username, password }, source()),
    code("INVALID_CREDENTIALS"),
  );
  assert.equal(
    (await auth.login({ username: renamed.toUpperCase(), password }, source()))
      .user.id,
    one.user.id,
  );
  await assert.rejects(
    accounts.saveProfile(one.token, {
      displayName: "Attack",
      username: renamed,
      userId: two.user.id,
    }),
  );
  assert.equal(
    (await accounts.current(two.token))?.profile.username,
    other.username,
  );
  assert.equal(
    await db.passwordCredential.count({ where: { userId: one.user.id } }),
    1,
  );
});

test("shared account/source/global limits work across independent database clients", async () => {
  const name = input().username;
  for (let i = 0; i < 10; i++)
    await assert.rejects(
      (i % 2 ? secondInstance : auth).login(
        { username: name, password },
        source(),
      ),
      code("INVALID_CREDENTIALS"),
    );
  await assert.rejects(
    secondInstance.login({ username: name.toUpperCase(), password }, source()),
    (error: unknown) =>
      error instanceof AuthenticationLimitError &&
      error.retryAfter > 0 &&
      error.retryAfter <= 900,
  );
  const bucket = {
    scope: "login-account" as const,
    slot: 65535,
    limit: 10,
    seconds: 900,
  };
  await db.authRateLimit.deleteMany({
    where: { scope: bucket.scope, slot: bucket.slot },
  });
  const shared = [
    createAuthenticationLimiter(db),
    createAuthenticationLimiter(otherDb),
  ];
  const results = await Promise.all(
    Array.from({ length: 24 }, (_, i) => shared[i % 2]!.consume([bucket])),
  );
  assert.equal(results.filter((value) => value === 0).length, 10);
  assert.equal(
    (
      await db.authRateLimit.findUniqueOrThrow({
        where: { scope_slot: { scope: bucket.scope, slot: bucket.slot } },
      })
    ).attempts,
    11,
  );
  await db.authRateLimit.update({
    where: { scope_slot: { scope: bucket.scope, slot: bucket.slot } },
    data: { expiresAt: new Date(0) },
  });
  assert.equal(await shared[1]!.consume([bucket]), 0);
  for (const value of [
    { scope: "register-source" as const, slot: 65534, limit: 2, seconds: 3600 },
    { scope: "register-global" as const, slot: 0, limit: 2, seconds: 3600 },
  ]) {
    await db.authRateLimit.deleteMany({
      where: { scope: value.scope, slot: value.slot },
    });
    assert.equal(await shared[0]!.consume([value]), 0);
    assert.equal(await shared[1]!.consume([value]), 0);
    assert.ok((await shared[0]!.consume([value])) > 0);
  }
  await db.authRateLimit.deleteMany({
    where: { scope: "register-global", slot: 0 },
  });
  await assert.rejects(
    db.authRateLimit.create({
      data: { scope: "unbounded", slot: 0, attempts: 1, expiresAt: new Date() },
    }),
  );
  await assert.rejects(
    db.authRateLimit.create({
      data: {
        scope: "login-source",
        slot: 65536,
        attempts: 1,
        expiresAt: new Date(),
      },
    }),
  );
});

test("existing external identities never acquire passwords through implicit linking", async () => {
  const username = input().username;
  const legacy = await accounts.signIn(
    {
      async verifyCredential() {
        return { issuer: "legacy-preserved", subject: randomUUID() };
      },
    },
    "fixture",
  );
  await accounts.saveProfile(legacy.token, { displayName: "Legacy", username });
  await assert.rejects(
    auth.login({ username, password }, source()),
    code("INVALID_CREDENTIALS"),
  );
  await assert.rejects(
    auth.register({ username, displayName: "Try linking", password }, source()),
    code("ACCOUNT_UNAVAILABLE"),
  );
  assert.equal(
    await db.passwordCredential.count({ where: { userId: legacy.user.id } }),
    0,
  );
  assert.equal(
    await db.externalIdentity.count({ where: { userId: legacy.user.id } }),
    1,
  );
});

test("HTTP auth protects CSRF, cookies, tokens, errors and absent recovery endpoints", async () => {
  const origin = "https://merkat.test";
  process.env.NODE_ENV = "production";
  process.env.VERCEL = "1";
  const handle = createApiHandler(
    () => ({
      accounts,
      plans: new PlanService(accounts, createPlanRepository(db)),
      authentication: () => auth,
    }),
    () => ({ production: true, appOrigin: origin }),
  );
  const call = (
    endpoint: string,
    body: unknown,
    override: Record<string, string> = {},
  ) =>
    handle(
      new Request(`${origin}/api/${endpoint}`, {
        method: "POST",
        headers: {
          origin,
          "content-type": "application/json",
          "x-vercel-forwarded-for": "192.0.2.10",
          ...override,
        },
        body: JSON.stringify(body),
      }),
      endpoint,
    );
  const value = input();
  assert.equal(
    (await call("auth/register", value, { origin: "https://evil.test" }))
      .status,
    403,
  );
  assert.equal(
    (await call("auth/register", value, { "sec-fetch-site": "cross-site" }))
      .status,
    403,
  );
  assert.equal(
    (
      await call("auth/register", value, {
        "x-vercel-forwarded-for": "spoofed",
      })
    ).status,
    503,
  );
  const registered = await call("auth/register", value);
  assert.equal(registered.status, 201);
  const cookie = registered.headers.get("set-cookie")!;
  for (const flag of [
    "__Host-merkat_session=",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Path=/",
  ])
    assert.ok(cookie.includes(flag));
  assert.ok(!cookie.includes("Domain="));
  const json = await registered.text();
  assert.ok(
    !json.includes(password) &&
      !json.includes("passwordHash") &&
      !json.includes("token"),
  );
  const wrong = await call("auth/login", {
    username: value.username,
    password: "wrong",
  });
  const absent = await call("auth/login", {
    username: input().username,
    password,
  });
  assert.equal(wrong.status, 401);
  assert.equal(absent.status, 401);
  assert.deepEqual(await wrong.json(), await absent.json());
  assert.equal(
    (await call("auth/login", { username: value.username, password })).status,
    200,
  );
  for (const endpoint of [
    "auth/forgot-password",
    "auth/reset-password",
    "auth/recover",
    "auth/change-password",
  ])
    assert.equal((await call(endpoint, {})).status, 404);
  process.env.VERCEL = "";
  assert.equal(
    (await call("auth/login", { username: value.username, password })).status,
    503,
  );
});

test("production trust and IPv6 source grouping cannot be bypassed with forwarded aliases", () => {
  const env = {
    NODE_ENV: "production",
    VERCEL: "1",
    APP_ORIGIN: "https://merkat.test",
    DATABASE_URL: "configured",
    AUTH_RATE_LIMIT_SECRET: secret,
  };
  const req = (ip: string) =>
    new Request("https://merkat.test", {
      headers: {
        "x-vercel-forwarded-for": ip,
        "x-forwarded-for": "203.0.113.99",
      },
    });
  assert.equal(authenticationConfigured(env), true);
  assert.equal(
    authenticationConfigured({ ...env, AUTH_RATE_LIMIT_SECRET: "" }),
    false,
  );
  assert.equal(authenticationConfigured({ ...env, VERCEL: "" }), false);
  assert.equal(
    authenticationSource(req("2001:db8:1234:5678::1"), env),
    authenticationSource(req("2001:0db8:1234:5678:ffff:ffff:ffff:ffff"), env),
  );
  assert.equal(authenticationSource(req("::ffff:192.0.2.1"), env), "192.0.2.1");
  assert.throws(() => authenticationSource(req("192.0.2.1, 203.0.113.1"), env));
  assert.throws(() =>
    authenticationSource(
      new Request("https://merkat.test", {
        headers: { "x-forwarded-for": "192.0.2.1" },
      }),
      env,
    ),
  );
  assert.equal(
    authenticationSource(req("203.0.113.1"), { NODE_ENV: "development" }),
    "local-development",
  );
});

test("shared limiter failure cannot fall back to password verification or issue an account", async () => {
  let calls = 0;
  const unavailable = new AuthenticationService(
    repository,
    {
      async consume() {
        throw new Error("Limiter unavailable");
      },
    },
    secret,
    {
      async hash(value) {
        calls++;
        return passwords.hash(value);
      },
      async verify(value, stored) {
        calls++;
        return passwords.verify(value, stored);
      },
    },
  );
  const value = input();
  await assert.rejects(unavailable.register(value, source()), {
    message: "Limiter unavailable",
  });
  await assert.rejects(
    unavailable.login({ username: value.username, password }, source()),
    { message: "Limiter unavailable" },
  );
  assert.equal(calls, 0);
  assert.equal(
    await db.profile.count({ where: { username: value.username } }),
    0,
  );
  assert.equal(isAuthenticationError(new Error("INVALID_CREDENTIALS")), false);
  assert.equal(isAuthenticationError({ code: "INVALID_CREDENTIALS" }), false);
});

test("reauthentication and profile updates have compatible locks and never change identity ownership", async () => {
  const value = input();
  const session = await auth.register(value, source());
  const result = await Promise.allSettled([
    auth.login({ username: value.username, password }, source(), session.token),
    accounts.saveProfile(session.token, {
      displayName: "Concurrent edit",
      username: value.username,
      bio: "Preserved",
    }),
  ]);
  assert.equal(result[0]!.status, "fulfilled");
  if (result[1]!.status === "rejected")
    assert.equal(result[1]!.reason.code, "UNAUTHORIZED");
  assert.equal(
    await db.passwordCredential.count({ where: { userId: session.user.id } }),
    1,
  );
  assert.equal(
    await db.profile.count({
      where: { userId: session.user.id, username: value.username },
    }),
    1,
  );
});

test("actual local HTTP route exports support registration/login/logout with development cookies", async () => {
  process.env.NODE_ENV = "development";
  process.env.APP_ORIGIN = "http://localhost:3000";
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.AUTH_RATE_LIMIT_SECRET = randomBytes(32).toString("hex");
  delete process.env.VERCEL;
  runtimeUsed = true;
  const value = input();
  const call = (path: string, body?: unknown, cookie?: string) =>
    browserPost(
      new Request(`http://localhost:3000/api/account/${path}`, {
        method: "POST",
        headers: {
          origin: "http://localhost:3000",
          ...(body ? { "content-type": "application/json" } : {}),
          ...(cookie ? { cookie } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
      { params: Promise.resolve({ path: [path] }) },
    );
  const registration = await call("register", value);
  assert.equal(registration.status, 201);
  const cookie = registration.headers.get("set-cookie")!;
  assert.match(cookie, /^merkat_session=/);
  assert.ok(
    cookie.includes("HttpOnly") &&
      cookie.includes("SameSite=Lax") &&
      !cookie.includes("Secure"),
  );
  assert.equal((await registration.json()).user.onboardingComplete, true);
  const tokenCookie = cookie.split(";")[0]!;
  assert.equal((await call("logout", undefined, tokenCookie)).status, 204);
  const revoked = await browserGet(
    new Request("http://localhost:3000/api/account/session", {
      headers: { cookie: tokenCookie },
    }),
    { params: Promise.resolve({ path: ["session"] }) },
  );
  assert.equal(revoked.status, 401);
  const login = await call("login", {
    username: value.username.toUpperCase(),
    password,
  });
  assert.equal(login.status, 200);
  assert.match(login.headers.get("set-cookie")!, /^merkat_session=/);
});
