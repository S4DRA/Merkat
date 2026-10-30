import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  AccountService,
  AccountError,
  hashSessionToken,
  type IdentityProvider,
} from "@merkat/backend";
import {
  createDatabase,
  createAccountRepository,
  readDatabaseEnvironment,
} from "@merkat/database";
import { normalizeUsername, sessionCookieName } from "@merkat/contracts";
import { createApp } from "../../apps/api/src/app.js";

if (!process.env.TEST_DATABASE_URL)
  throw new Error(
    "Run via npm test:integration with the isolated test database.",
  );
const db = createDatabase({ DATABASE_URL: process.env.TEST_DATABASE_URL });
const repository = createAccountRepository(db);
const accounts = new AccountService(repository);

test("portable server CA configuration requires verified TLS without conflicting file roots", () => {
  const ca = readFileSync(
    "tests/support/tls/localhost-test.crt",
    "utf8",
  ).trim();
  const input = {
    NODE_ENV: "production",
    DATABASE_URL:
      "postgresql://example:private@example.test/merkat?sslmode=verify-full",
    DATABASE_CA_CERT: ca,
  };
  assert.equal(readDatabaseEnvironment(input).DATABASE_CA_CERT, ca);
  for (const mode of [
    "",
    "?sslmode=disable",
    "?sslmode=verify-full&sslrootcert=/unavailable.crt",
    "?sslmode=verify-full&sslmode=disable",
  ]) {
    assert.throws(
      () =>
        readDatabaseEnvironment({
          ...input,
          DATABASE_URL:
            "postgresql://example:private@example.test/merkat" + mode,
        }),
      (error) => error instanceof Error && !error.message.includes("private"),
    );
  }
  assert.throws(() =>
    readDatabaseEnvironment({
      ...input,
      DATABASE_CA_CERT: "not a certificate",
    }),
  );
});

test("production database configuration requires verified remote TLS and rejects host overrides", () => {
  const remote = "postgresql://example:private@example.test/merkat";
  for (const suffix of [
    "",
    "?sslmode=disable",
    "?sslmode=prefer",
    "?sslmode=require",
    "?sslmode=verify-ca",
    "?sslmode=no-verify",
    "?sslmode=verify-full&sslmode=disable",
    "?sslmode=disable&sslmode=verify-full",
  ]) {
    assert.throws(
      () =>
        readDatabaseEnvironment({
          NODE_ENV: "production",
          DATABASE_URL: remote + suffix,
        }),
      (error) =>
        error instanceof Error &&
        error.message.includes("sslmode=verify-full") &&
        !error.message.includes("private"),
    );
  }
  const secure = remote + "?sslmode=verify-full";
  assert.equal(
    readDatabaseEnvironment({ NODE_ENV: "production", DATABASE_URL: secure })
      .DATABASE_URL,
    secure,
  );
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    const local = `postgresql://example:private@${host}/merkat`;
    assert.equal(
      readDatabaseEnvironment({ NODE_ENV: "production", DATABASE_URL: local })
        .DATABASE_URL,
      local,
    );
    assert.throws(() =>
      readDatabaseEnvironment({
        NODE_ENV: "production",
        DATABASE_URL: local + "?host=example.test",
      }),
    );
  }
  assert.throws(() =>
    readDatabaseEnvironment({
      NODE_ENV: "production",
      DATABASE_URL: secure + "&host=localhost",
    }),
  );
  assert.equal(
    readDatabaseEnvironment({ NODE_ENV: "development", DATABASE_URL: remote })
      .DATABASE_URL,
    remote,
  );
});
const origin = "https://merkat.test";
const app = createApp("silent", {
  accounts,
  appOrigin: origin,
  production: true,
});
const provider = (
  subject: string = randomUUID(),
  issuer = "test-only",
): IdentityProvider => ({
  async verifyCredential() {
    return { issuer, subject };
  },
});
const cookie = (token: string) => `${sessionCookieName(true)}=${token}`;
after(async () => {
  await app.close();
  await db.$disconnect();
});

test("normalization, unique usernames and session-owned profile writes", async () => {
  assert.equal(normalizeUsername("  Alice_Test "), "alice_test");
  const first = await accounts.signIn(provider(), "test fixture");
  const second = await accounts.signIn(provider(), "test fixture");
  const username = `u${randomUUID().replaceAll("-", "").slice(0, 15)}`;
  const saved = await accounts.saveProfile(first.token, {
    displayName: " Alice ",
    username: ` ${username.toUpperCase()} `,
    bio: "Hello",
  });
  assert.equal(saved.id, first.user.id);
  assert.equal(saved.profile.username, username);
  assert.equal(saved.onboardingComplete, true);
  await assert.rejects(
    accounts.saveProfile(second.token, {
      displayName: "Other",
      username: username.toUpperCase(),
    }),
    (error: unknown) =>
      error instanceof AccountError && error.code === "USERNAME_UNAVAILABLE",
  );
  await assert.rejects(
    accounts.saveProfile(first.token, {
      userId: second.user.id,
      displayName: "Attack",
      username,
    }),
  );
  await assert.rejects(
    db.profile.update({
      where: { userId: second.user.id },
      data: { username: "MixedCase" },
    }),
  );
  await assert.rejects(
    db.profile.update({
      where: { userId: second.user.id },
      data: { username },
    }),
  );
  const changed = await accounts.saveProfile(first.token, {
    displayName: "Renamed",
    username: `${username}x`,
  });
  assert.equal(changed.id, first.user.id);
});

test("external identity is stable under concurrent login and rejects invalid providers", async () => {
  const identity = provider();
  const sessions = await Promise.all([
    accounts.signIn(identity, "test"),
    accounts.signIn(identity, "test"),
  ]);
  assert.equal(sessions[0].user.id, sessions[1].user.id);
  assert.notEqual(sessions[0].token, sessions[1].token);
  assert.equal(
    await db.externalIdentity.count({ where: { userId: sessions[0].user.id } }),
    1,
  );
  const before = await db.user.count();
  await assert.rejects(
    accounts.signIn(
      {
        async verifyCredential() {
          throw new Error("verification failed");
        },
      },
      "invalid",
    ),
  );
  await assert.rejects(accounts.signIn(provider("", ""), "invalid"));
  assert.equal(await db.user.count(), before);
});

test("sessions hash secrets, expire, rotate once, revoke and reject suspended accounts", async () => {
  let now = new Date();
  const clocked = new AccountService(repository, () => now);
  const identity = provider();
  const session = await clocked.signIn(identity, "test");
  const row = await db.session.findUniqueOrThrow({
    where: { tokenHash: hashSessionToken(session.token) },
  });
  assert.notEqual(row.tokenHash, session.token);
  assert.equal((await clocked.current(session.token))?.id, session.user.id);
  assert.equal(await clocked.current("client-supplied-user-id"), null);
  const rotations = await Promise.allSettled([
    clocked.rotate(session.token),
    clocked.rotate(session.token),
  ]);
  assert.equal(
    rotations.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(await clocked.current(session.token), null);
  const rotated = rotations.find((result) => result.status === "fulfilled");
  assert.ok(rotated?.status === "fulfilled");
  assert.equal(rotated.value.expiresAt.getTime(), session.expiresAt.getTime());
  await clocked.logout(rotated.value.token);
  assert.equal(await clocked.current(rotated.value.token), null);
  const expiring = await clocked.signIn(identity, "test");
  now = expiring.expiresAt;
  assert.equal(await clocked.current(expiring.token), null);
  await assert.rejects(
    clocked.saveProfile(expiring.token, {
      displayName: "No",
      username: "expired",
    }),
  );
  await db.user.update({
    where: { id: session.user.id },
    data: { status: "SUSPENDED" },
  });
  await assert.rejects(accounts.signIn(identity, "test"));
});

test("HTTP auth, CSRF, cookie flags, no OTP endpoint, logout and ownership", async () => {
  assert.equal((await app.inject({ url: "/auth/session" })).statusCode, 401);
  assert.equal((await app.inject({ url: "/auth/otp" })).statusCode, 404);
  const session = await accounts.signIn(provider(), "test");
  const headers = { cookie: cookie(session.token), origin };
  const current = await app.inject({ url: "/auth/session", headers });
  assert.equal(current.statusCode, 200);
  assert.equal(current.headers["cache-control"], "no-store");
  assert.equal(current.json().user.id, session.user.id);
  assert.ok(!current.body.includes(session.token));
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/auth/logout",
        headers: { cookie: cookie(session.token) },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/auth/logout",
        headers: { ...headers, origin: "https://evil.test" },
      })
    ).statusCode,
    403,
  );
  const invalid = await app.inject({
    method: "PATCH",
    url: "/account/profile",
    headers,
    payload: {
      displayName: "User",
      username: "good_user",
      userId: randomUUID(),
    },
  });
  assert.equal(invalid.statusCode, 400);
  const rotation = await app.inject({
    method: "POST",
    url: "/auth/session/rotate",
    headers,
  });
  assert.equal(rotation.statusCode, 204);
  const setCookie = String(rotation.headers["set-cookie"]);
  for (const flag of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/"])
    assert.ok(setCookie.includes(flag));
  assert.ok(!setCookie.includes("Domain="));
  const freshCookie = setCookie.split(";")[0]!;
  assert.equal(
    (await app.inject({ url: "/auth/session", headers })).statusCode,
    401,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/auth/logout",
        headers: { cookie: freshCookie, origin },
      })
    ).statusCode,
    204,
  );
  assert.equal(
    (
      await app.inject({
        url: "/auth/session",
        headers: { cookie: freshCookie },
      })
    ).statusCode,
    401,
  );
});

test("foreign keys and deletion cascade retain account integrity", async () => {
  const session = await accounts.signIn(provider(), "test");
  await assert.rejects(
    db.user.update({
      where: { id: session.user.id },
      data: { id: randomUUID() },
    }),
  );
  await db.user.delete({ where: { id: session.user.id } });
  assert.equal(
    await db.profile.count({ where: { userId: session.user.id } }),
    0,
  );
  assert.equal(
    await db.externalIdentity.count({ where: { userId: session.user.id } }),
    0,
  );
  assert.equal(await accounts.current(session.token), null);
});

test("reauthentication replaces only the current device session", async () => {
  const identity = provider();
  const currentDevice = await accounts.signIn(identity, "test");
  const otherDevice = await accounts.signIn(identity, "test");
  const replacement = await accounts.signIn(
    identity,
    "test",
    currentDevice.token,
  );
  assert.notEqual(replacement.token, currentDevice.token);
  assert.equal(await accounts.current(currentDevice.token), null);
  assert.equal(
    (await accounts.current(otherDevice.token))?.id,
    currentDevice.user.id,
  );
  assert.equal(
    (await accounts.current(replacement.token))?.id,
    currentDevice.user.id,
  );
});
