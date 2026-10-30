import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { AccountService, PlanService } from "@merkat/backend";
import {
  createAccountRepository,
  createDatabase,
  createPlanRepository,
} from "@merkat/database";
import { sessionCookieName } from "@merkat/contracts";
import { createApp } from "../../apps/api/src/app.js";
import { createApiHandler } from "../../apps/web/src/lib/server/http-api.js";
import { readWebEnvironment } from "../../apps/web/src/lib/environment.js";

test("preview origin comes only from trusted Vercel deployment configuration", () => {
  const input = {
    NODE_ENV: "production",
    VERCEL: "1",
    VERCEL_ENV: "preview",
    VERCEL_URL: "example-preview.vercel.app",
  };
  assert.equal(
    readWebEnvironment(input).APP_ORIGIN,
    "https://example-preview.vercel.app",
  );
  assert.equal(
    readWebEnvironment({ ...input, APP_ORIGIN: "https://custom.example" })
      .APP_ORIGIN,
    "https://custom.example",
  );
  for (const host of [
    "attacker.test",
    "user:password@example.vercel.app",
    "example.vercel.app/path",
    "example.vercel.app?x=1",
    "example.vercel.app.evil.test",
    "https://example.vercel.app",
    "example.vercel.app:443",
    "",
    "-example.vercel.app",
  ]) {
    assert.throws(() => readWebEnvironment({ ...input, VERCEL_URL: host }));
  }
  assert.throws(() => readWebEnvironment({ ...input, VERCEL: "" }));
  assert.throws(() =>
    readWebEnvironment({ ...input, VERCEL_ENV: "production" }),
  );
  assert.throws(() =>
    readWebEnvironment({ ...input, APP_ORIGIN: "http://example.test" }),
  );
});
import { GET as canonical } from "../../apps/web/src/app/api/[...path]/route.js";
import { GET as browserAlias } from "../../apps/web/src/app/api/account/[...path]/route.js";
import { getServices } from "../../apps/web/src/lib/server/runtime.js";

if (!process.env.TEST_DATABASE_URL)
  throw new Error("Use the isolated integration runner.");
const database = createDatabase({
  DATABASE_URL: process.env.TEST_DATABASE_URL,
});
const accounts = new AccountService(createAccountRepository(database));
const plans = createPlanRepository(database);
const origin = "https://merkat.test";
const app = createApp("silent", {
  accounts,
  plans,
  appOrigin: origin,
  production: true,
});
const handle = createApiHandler(
  () => ({ database, accounts, plans: new PlanService(accounts, plans) }),
  () => ({ appOrigin: origin, production: true }),
);
const issue = async (onboarded = true) => {
  const session = await accounts.signIn(
    {
      async verifyCredential() {
        return { issuer: "migration-test", subject: randomUUID() };
      },
    },
    "test fixture",
  );
  if (onboarded)
    await accounts.saveProfile(session.token, {
      displayName: "Migration Test",
      username: `m${randomUUID().replaceAll("-", "").slice(0, 20)}`,
    });
  return session;
};
const headers = (token?: string) => ({
  origin,
  ...(token ? { cookie: `${sessionCookieName(true)}=${token}` } : {}),
});
function request(
  path: string,
  method = "GET",
  token?: string,
  payload?: unknown,
) {
  return new Request(`${origin}/api${path}`, {
    method,
    headers: {
      ...headers(token),
      ...(payload !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
  });
}
after(async () => {
  await app.close();
  await database.$disconnect();
});

test("all migrated routes preserve Fastify statuses, bodies and no-store semantics", async () => {
  const session = await issue();
  const pending = await issue(false);
  const account = await accounts.current(session.token);
  const cases: {
    path: string;
    method?: "GET" | "POST" | "PATCH" | "PUT";
    token?: string;
    body?: Record<string, unknown>;
    status: number;
  }[] = [
    { path: "/health/live", status: 200 },
    { path: "/auth/session", status: 401 },
    { path: "/auth/session", token: session.token, status: 200 },
    { path: "/auth/session", token: "a".repeat(43), status: 401 },
    { path: "/auth/session/rotate", method: "POST", status: 401 },
    { path: "/account/profile", method: "PATCH", body: {}, status: 401 },
    {
      path: "/account/profile",
      method: "PATCH",
      token: session.token,
      body: {},
      status: 400,
    },
    {
      path: "/account/profile",
      method: "PATCH",
      token: session.token,
      body: {
        displayName: "Edited",
        username: account!.profile.username,
        bio: "hello",
      },
      status: 200,
    },
    {
      path: "/account/profile",
      method: "PATCH",
      token: session.token,
      body: {
        displayName: "Attack",
        username: "attack",
        userId: pending.user.id,
      },
      status: 400,
    },
    {
      path: "/auth/phone/start",
      method: "POST",
      body: { phone: "+905551234567" },
      status: 503,
    },
    {
      path: "/auth/phone/verify",
      method: "POST",
      body: { token: "123456" },
      status: 401,
    },
    { path: "/plans", status: 401 },
    { path: "/plans", token: pending.token, status: 401 },
    { path: "/plans", token: session.token, status: 200 },
    {
      path: "/plans",
      method: "POST",
      token: session.token,
      body: {},
      status: 400,
    },
    {
      path: "/plans",
      method: "PATCH",
      token: session.token,
      body: { id: randomUUID(), action: "CANCEL" },
      status: 404,
    },
    { path: "/people/find", method: "POST", body: {}, status: 401 },
    {
      path: "/people/find",
      method: "POST",
      token: session.token,
      body: {},
      status: 400,
    },
    {
      path: "/people/find",
      method: "POST",
      token: session.token,
      body: { username: "missing_person" },
      status: 404,
    },
    {
      path: "/people/find",
      method: "POST",
      token: session.token,
      body: { username: account!.profile.username },
      status: 200,
    },
    ...["/messaging/connect", "/messaging/rooms"].flatMap((path) => [
      { path, method: "POST" as const, body: {}, status: 401 },
      {
        path,
        method: "POST" as const,
        token: session.token,
        body: {},
        status: 503,
      },
    ]),
    { path: "/matrix/_matrix/client/v3/sync", status: 401 },
    {
      path: "/matrix/_matrix/client/v3/sync",
      token: session.token,
      status: 503,
    },
    {
      path: "/matrix/_matrix/client/v3/keys/query",
      method: "POST",
      token: session.token,
      body: {},
      status: 503,
    },
    {
      path: "/matrix/_matrix/client/v3/sendToDevice/m.room.encrypted/id",
      method: "PUT",
      token: session.token,
      body: {},
      status: 503,
    },
  ];
  for (const item of cases) {
    const legacy = await app.inject({
      method: item.method ?? "GET",
      url: item.path,
      headers: headers(item.token),
      ...(item.body !== undefined ? { payload: item.body } : {}),
    });
    const next = await handle(
      request(item.path, item.method, item.token, item.body),
      item.path.slice(1),
    );
    assert.equal(legacy.statusCode, item.status, `legacy ${item.path}`);
    assert.equal(next.status, legacy.statusCode, item.path);
    const text = await next.text();
    assert.deepEqual(JSON.parse(text), legacy.json(), item.path);
    assert.equal(next.headers.get("cache-control"), "no-store");
    if (item.token) assert.ok(!text.includes(item.token));
  }
});

test("migrated plan CRUD preserves membership, ownership and provider boundaries", async () => {
  const owner = await issue(),
    invitee = await issue(),
    outsider = await issue();
  const invited = await accounts.current(invitee.token);
  const input = {
    title: "Meet",
    startsAt: "2030-01-01T10:00:00Z",
    endsAt: "2030-01-01T11:00:00Z",
    usernames: [invited!.profile.username],
  };
  const created = await handle(
    request("/plans", "POST", owner.token, input),
    "plans",
  );
  assert.equal(created.status, 201);
  const { plan } = await created.json();
  assert.equal(plan.ownerId, owner.user.id);
  const legacy = await app.inject({
    url: "/plans",
    headers: headers(invitee.token),
  });
  const listing = await handle(
    request("/plans", "GET", invitee.token),
    "plans",
  );
  assert.deepEqual(await listing.json(), legacy.json());
  assert.deepEqual(
    await (
      await handle(request("/plans", "GET", outsider.token), "plans")
    ).json(),
    { plans: [] },
  );
  for (const action of ["GOING", "MAYBE", "DECLINED"]) {
    assert.equal(
      (
        await handle(
          request("/plans", "PATCH", invitee.token, { id: plan.id, action }),
          "plans",
        )
      ).status,
      204,
    );
    assert.equal(
      (
        await handle(
          request("/plans", "PATCH", outsider.token, { id: plan.id, action }),
          "plans",
        )
      ).status,
      404,
    );
  }
  assert.equal(
    (
      await handle(
        request("/plans", "PATCH", invitee.token, {
          id: plan.id,
          action: "CANCEL",
        }),
        "plans",
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await handle(
        request("/plans", "PATCH", owner.token, {
          id: plan.id,
          action: "CANCEL",
        }),
        "plans",
      )
    ).status,
    204,
  );
  assert.equal(
    (
      await handle(
        request("/plans", "PATCH", invitee.token, {
          id: plan.id,
          action: "GOING",
        }),
        "plans",
      )
    ).status,
    404,
  );
  for (const extra of [
    { conversationId: "!room:example.test" },
    { usernames: ["missing_person"] },
  ]) {
    const body = { ...input, ...extra };
    const old = await app.inject({
      url: "/plans",
      method: "POST",
      headers: headers(owner.token),
      payload: body,
    });
    const next = await handle(
      request("/plans", "POST", owner.token, body),
      "plans",
    );
    assert.equal(next.status, old.statusCode);
    assert.deepEqual(await next.json(), old.json());
  }
});

test("HTTP rotation/revocation preserve expiry, cookie flags and independent devices", async () => {
  const session = await issue();
  const initial = await database.session.findFirstOrThrow({
    where: { userId: session.user.id },
  });
  const identity = await database.externalIdentity.findFirstOrThrow({
    where: { userId: session.user.id },
  });
  const other = await accounts.signIn(
    {
      async verifyCredential() {
        return { issuer: identity.issuer, subject: identity.subject };
      },
    },
    "test",
  );
  const response = await handle(
    request("/auth/session/rotate", "POST", session.token),
    "auth/session/rotate",
  );
  assert.equal(response.status, 204);
  const cookie = response.headers.get("set-cookie")!;
  for (const flag of [
    "__Host-merkat_session=",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Path=/",
    "Expires=",
  ])
    assert.ok(cookie.includes(flag));
  assert.ok(!cookie.includes("Domain="));
  const token = cookie.split(";")[0]!.split("=")[1]!;
  assert.equal(await accounts.current(session.token), null);
  assert.equal((await accounts.current(token))?.id, session.user.id);
  assert.ok(
    Math.abs(
      session.expiresAt.getTime() -
        initial.createdAt.getTime() -
        30 * 86400 * 1000,
    ) < 1000,
  );
  assert.ok(cookie.includes(session.expiresAt.toUTCString()));
  assert.ok(await accounts.current(other.token));
  const logout = await handle(
    request("/auth/logout", "POST", token),
    "auth/logout",
  );
  assert.equal(logout.status, 204);
  assert.match(logout.headers.get("set-cookie")!, /Expires=Thu, 01 Jan 1970/);
  assert.equal(await accounts.current(token), null);
  assert.equal(
    (await handle(request("/auth/logout", "POST"), "auth/logout")).status,
    204,
  );
  const dev = createApiHandler(
    () => ({ database, accounts, plans: new PlanService(accounts, plans) }),
    () => ({ appOrigin: origin, production: false }),
  );
  const devLogout = await dev(request("/auth/logout", "POST"), "auth/logout");
  assert.match(devLogout.headers.get("set-cookie")!, /^merkat_session=/);
  assert.ok(!devLogout.headers.get("set-cookie")!.includes("Secure"));
});

test("CSRF, streamed body limits, parser errors and missing configuration fail closed", async () => {
  for (const path of ["constructor", "__proto__", "toString", "arbitrary"])
    assert.equal((await handle(request(`/${path}`), path)).status, 404);
  for (const values of [
    {},
    { origin: "https://evil.test" },
    { origin, "sec-fetch-site": "cross-site" },
    { origin: "null" },
  ]) {
    const next = await handle(
      new Request(`${origin}/api/auth/logout`, {
        method: "POST",
        headers: values,
      }),
      "auth/logout",
    );
    assert.equal(next.status, 403);
  }
  const big = new Request(`${origin}/api/account/profile`, {
    method: "PATCH",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ bio: "x".repeat(8192) }),
  });
  assert.equal((await handle(big, "account/profile")).status, 413);
  const malformed = new Request(`${origin}/api/account/profile`, {
    method: "PATCH",
    headers: { origin, "content-type": "application/json" },
    body: "{",
  });
  assert.equal((await handle(malformed, "account/profile")).status, 400);
  assert.equal(
    (
      await handle(
        new Request(`${origin}/api/account/profile`, {
          method: "PATCH",
          headers: { origin },
          body: "text",
        }),
        "account/profile",
      )
    ).status,
    415,
  );
  const unavailable = createApiHandler(
    () => {
      throw new Error("secret-url-and-token");
    },
    () => ({ appOrigin: origin, production: true }),
  );
  assert.equal(
    (await unavailable(request("/auth/session"), "auth/session")).status,
    401,
  );
  const failure = await unavailable(
    request("/auth/session", "GET", "a".repeat(43)),
    "auth/session",
  );
  assert.equal(failure.status, 503);
  assert.deepEqual(await failure.json(), { error: "SERVICE_UNAVAILABLE" });
  for (const value of [
    undefined,
    "https://user:password@example.test",
    "https://example.test/path",
    "http://example.test",
  ])
    assert.throws(() =>
      readWebEnvironment({ NODE_ENV: "production", APP_ORIGIN: value }),
    );
  assert.equal(
    readWebEnvironment({ NODE_ENV: "production", APP_ORIGIN: origin })
      .APP_ORIGIN,
    origin,
  );
});

test("actual Next route exports serve existing browser and canonical URLs directly", async () => {
  process.env.APP_ORIGIN = origin;
  process.env.NODE_ENV = "production";
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const session = await issue();
  try {
    const req = request("/auth/session", "GET", session.token);
    const response = await canonical(req, {
      params: Promise.resolve({ path: ["auth", "session"] }),
    });
    const alias = await browserAlias(
      request("/account/session", "GET", session.token),
      { params: Promise.resolve({ path: ["session"] }) },
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), await alias.json());
    const bad = await browserAlias(request("/account/arbitrary"), {
      params: Promise.resolve({ path: ["arbitrary"] }),
    });
    assert.equal(bad.status, 404);
  } finally {
    await getServices().database.$disconnect();
  }
});
