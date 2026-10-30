import assert from "node:assert/strict";
import { test } from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { Client } from "pg";
import {
  AccountService,
  AuthenticationService,
  MessagingService,
  GroupService,
  PlanService,
  PrivacyService,
} from "@merkat/backend";
import {
  checkRuntimeDatabase,
  createDatabase,
  createAccountRepository,
  createCredentialRepository,
  createAuthenticationLimiter,
  createMessagingRepository,
  createGroupRepository,
  createPlanRepository,
  createPrivacyRepository,
} from "@merkat/database";
import { createApiHandler } from "../../apps/web/src/lib/server/http-api.js";
import { requestFailureCode } from "../../apps/web/src/lib/server/request-failure.js";
import { startTestDatabase } from "../support/postgres.js";

test("existing six-migration database reproduces failures; reviewed migrations and runtime setup restore the current app without losing history", async () => {
  const cluster = await startTestDatabase({ migrate: false });
  const owner = new Client({ connectionString: cluster.url });
  const admin = createDatabase({ DATABASE_URL: cluster.url });
  let runtime: ReturnType<typeof createDatabase> | undefined;
  try {
    await owner.connect();
    const migrations = new URL(
      "../../packages/database/prisma/migrations/",
      import.meta.url,
    );
    const directories = (await readdir(migrations, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    const upgrade = "202610170003_groups_privacy";
    for (const name of directories.filter((name) => name < upgrade)) {
      await owner.query(
        await readFile(new URL(`${name}/migration.sql`, migrations), "utf8"),
      );
    }
    const password = randomBytes(24).toString("hex");
    // Disposable local PostgreSQL models only the required Supabase SQL contract.
    // This is not a hosted websocket/push-delivery test.
    await owner.query(`
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE merkat_runtime LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
      CREATE SCHEMA realtime;
      CREATE TABLE realtime.messages(extension text,payload jsonb,event text,topic text,private boolean);
      ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
      GRANT USAGE ON SCHEMA realtime TO anon,authenticated;
      GRANT SELECT,INSERT ON realtime.messages TO anon,authenticated;
      CREATE FUNCTION realtime.topic() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('realtime.topic',true) $$;
      CREATE FUNCTION realtime.send(payload jsonb,event text,topic text,private boolean) RETURNS void LANGUAGE sql AS $$ INSERT INTO realtime.messages VALUES('broadcast',payload,event,topic,private) $$;
      CREATE TABLE public._prisma_migrations(id text);
    `);
    for (const file of ["realtime.sql", "server-role.sql"]) {
      await owner.query(
        await readFile(
          new URL(`../../infra/supabase/${file}`, import.meta.url),
          "utf8",
        ),
      );
    }
    const url = new URL(cluster.url);
    url.username = "merkat_runtime";
    url.password = password;
    runtime = createDatabase({ DATABASE_URL: url.href });
    const authentication = new AuthenticationService(
      createCredentialRepository(runtime),
      createAuthenticationLimiter(runtime),
      randomBytes(32).toString("hex"),
    );
    const register = (username: string) =>
      authentication.register(
        { username, password: randomBytes(24).toString("hex") },
        randomUUID(),
      );
    const [a, b, c] = await Promise.all([
      register("recovery_owner"),
      register("recovery_member"),
      register("recovery_outsider"),
    ]);
    // Historical Phase 5 data, created without invoking Phase 6 services.
    const [firstUserId, secondUserId] = [a.user.id, b.user.id].sort() as [
      string,
      string,
    ];
    const conversation = await admin.directConversation.create({
      data: { firstUserId, secondUserId },
    });
    await admin.directConversation.update({
      where: { id: conversation.id },
      data: { lastSequence: 1 },
    });
    const historical = await admin.directMessage.create({
      select: { id: true }, // Only fields present in this deliberately old schema.
      data: {
        conversationId: conversation.id,
        senderId: a.user.id,
        clientId: randomUUID(),
        sequence: 1,
        text: "Saved before the upgrade",
      },
    });
    const accounts = new AccountService(createAccountRepository(runtime));
    const messaging = new MessagingService(createMessagingRepository(runtime));
    const groups = new GroupService(createGroupRepository(runtime));
    const plans = new PlanService(accounts, createPlanRepository(runtime));
    const privacy = new PrivacyService(createPrivacyRepository(runtime));
    const origin = "https://recovery.example.test";
    const handle = createApiHandler(
      () => ({ accounts, messaging, groups, plans, privacy }),
      () => ({ appOrigin: origin, production: true }),
    );
    const request = (endpoint: string, body: unknown, token = a.token) =>
      handle(
        new Request(`${origin}/api/${endpoint}`, {
          method: "POST",
          headers: {
            origin,
            "content-type": "application/json",
            cookie: `__Host-merkat_session=${token}`,
          },
          body: JSON.stringify(body),
        }),
        endpoint,
      );
    const before = await checkRuntimeDatabase(runtime);
    assert.equal(before.ready, false);
    assert.equal(before.missingGroupSchema, true);
    assert.ok(before.issues.includes("Missing table: UserBlock"));
    assert.ok(before.issues.some((issue) => issue.includes("discoveryCount")));
    for (const [endpoint, body] of [
      ["direct/list", {}],
      ["groups/list", {}],
      ["people/find", { username: "recovery_member" }],
    ] as const) {
      const response = await request(endpoint, body);
      assert.equal(response.status, 503, endpoint);
      assert.deepEqual(await response.json(), { error: "SERVICE_UNAVAILABLE" });
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
    await owner.query(
      await readFile(new URL(`${upgrade}/migration.sql`, migrations), "utf8"),
    );
    const noGrants = await checkRuntimeDatabase(runtime);
    assert.equal(noGrants.ready, false);
    assert.equal(noGrants.missingGroupSchema, false);
    assert.ok(
      noGrants.issues.some((issue) =>
        issue.includes("Missing runtime privileges: ChatGroup"),
      ),
    );
    const setup = await readFile(
      new URL("../../infra/supabase/groups-privacy.sql", import.meta.url),
      "utf8",
    );
    await owner.query(setup);
    await owner.query(setup); // The release's runtime setup is safely repeatable.
    for (const name of directories.filter((name) => name > upgrade)) {
      await owner.query(
        await readFile(new URL(`${name}/migration.sql`, migrations), "utf8"),
      );
    }
    assert.deepEqual(await checkRuntimeDatabase(runtime), {
      ready: true,
      missingGroupSchema: false,
      issues: [],
    });
    for (const [endpoint, body] of [
      ["direct/list", {}],
      ["groups/list", {}],
      ["people/find", { username: "recovery_member" }],
    ] as const)
      assert.equal((await request(endpoint, body)).status, 200, endpoint);
    assert.equal(
      (await messaging.list(a.token, {})).conversations[0]!.id,
      conversation.id,
    );
    assert.equal(
      (await messaging.messages(b.token, { conversationId: conversation.id }))
        .messages[0]!.id,
      historical.id,
    );
    const clientId = randomUUID();
    const message = {
      conversationId: conversation.id,
      clientId,
      text: "Works after upgrade",
    };
    const sent = await messaging.send(b.token, message);
    assert.equal((await messaging.send(b.token, message)).id, sent.id);
    await privacy.update(b.token, {
      allowNonFriendDms: true,
      groupInvitesFrom: "EVERYONE",
    });
    const group = await groups.create(a.token, {
      clientId: randomUUID(),
      name: "Recovered groups",
      usernames: ["recovery_member"],
    });
    const invite = (await groups.list(b.token, {})).invitations[0]!;
    await groups.invitation(b.token, { id: invite.id, action: "ACCEPT" });
    await groups.send(b.token, {
      groupId: group.id,
      channelId: group.defaultChannelId,
      clientId: randomUUID(),
      text: "Group messages work",
    });
    assert.equal((await groups.list(b.token, {})).groups[0]!.id, group.id);
    assert.equal(
      (
        await groups.messages(a.token, {
          groupId: group.id,
          channelId: group.defaultChannelId,
        })
      ).messages[0]!.text,
      "Group messages work",
    );
    assert.equal(
      (await request("groups/detail", { groupId: group.id }, c.token)).status,
      404,
    );
    await assert.rejects(runtime.safetyReport.findMany());
    await owner.query("SET ROLE authenticated");
    await assert.rejects(owner.query('SELECT * FROM public."GroupMessage"'));
    await owner.query("RESET ROLE");
    assert.equal(
      await admin.directMessage.count({
        where: { conversationId: conversation.id },
      }),
      2,
    );
    assert.ok(
      (await owner.query("SELECT payload FROM realtime.messages")).rows.every(
        (row) => JSON.stringify(row.payload) === "{}",
      ),
    );
  } finally {
    await runtime?.$disconnect();
    await admin.$disconnect();
    await owner.end();
    await cluster.stop();
  }
});

test("failure diagnostics expose only known error codes, never messages or metadata", () => {
  assert.equal(
    requestFailureCode({
      code: "P2021",
      message: "private SQL and credentials",
      meta: { token: "secret" },
    }),
    "P2021",
  );
  assert.equal(
    requestFailureCode({ code: "secret", message: "private" }),
    "UNEXPECTED_FAILURE",
  );
  assert.equal(requestFailureCode(new Error("private")), "UNEXPECTED_FAILURE");
  assert.equal(requestFailureCode(null), "UNEXPECTED_FAILURE");
});
