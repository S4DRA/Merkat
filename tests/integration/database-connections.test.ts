import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { createServer, connect, type Socket } from "node:net";
import { AccountService, hashSessionToken } from "@merkat/backend";
import { createDatabase, createAccountRepository } from "@merkat/database";
import { isTransientConnectionError } from "../../packages/database/src/connection-errors.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("Use the isolated integration runner.");
const target = new URL(databaseUrl);
if (target.hostname !== "127.0.0.1")
  throw new Error("Fault tests require the owned loopback database.");

// Faults affect only this test's local TCP proxy, never the shared database server
// or a hosted connection. No request or protocol contents are inspected/logged.
async function proxy(options: {
  delay?: number;
  failures?: number;
  failureDelay?: number;
}) {
  const sockets = new Set<Socket>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let connections = 0;
  const server = createServer((incoming) => {
    connections++;
    if (connections <= (options.failures ?? 0)) {
      sockets.add(incoming);
      incoming.on("close", () => sockets.delete(incoming));
      const timer = setTimeout(() => {
        timers.delete(timer);
        incoming.destroy();
      }, options.failureDelay ?? 0);
      timers.add(timer);
      return;
    }
    const upstream = connect({ host: "127.0.0.1", port: Number(target.port) });
    for (const socket of [incoming, upstream]) {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    }
    incoming.on("error", () => upstream.destroy());
    upstream.on("error", () => incoming.destroy());
    incoming.on("close", () => upstream.destroy());
    upstream.on("close", () => incoming.destroy());
    const timer = setTimeout(() => {
      timers.delete(timer);
      incoming.pipe(upstream);
      upstream.pipe(incoming);
    }, options.delay ?? 0);
    timers.add(timer);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No proxy port");
  const url = new URL(target);
  url.port = String(address.port);
  return {
    database: createDatabase({ DATABASE_URL: url.href }),
    connections: () => connections,
    async close() {
      for (const timer of timers) clearTimeout(timer);
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

test("a connection taking more than two seconds can still acquire a transaction within the driver deadline", async () => {
  const fault = await proxy({ delay: 2300 });
  try {
    const rows = await fault.database.$transaction(
      (tx) => tx.$queryRaw<{ healthy: number }[]>`SELECT 1 AS healthy`,
    );
    assert.equal(rows[0]?.healthy, 1);
  } finally {
    await fault.database.$disconnect();
    await fault.close();
  }
});

test("a dropped session lookup retries a fresh connection and preserves the authenticated account", async () => {
  const seed = createDatabase({ DATABASE_URL: databaseUrl });
  const fault = await proxy({ failures: 1 });
  try {
    const account = await new AccountService(
      createAccountRepository(seed),
    ).signIn(
      {
        async verifyCredential() {
          return { issuer: "connection-test", subject: randomUUID() };
        },
      },
      "isolated fixture",
    );
    const repository = createAccountRepository(fault.database);
    const restored = await repository.findSession(
      hashSessionToken(account.token),
      new Date(),
    );
    assert.equal(restored?.id, account.user.id);
    assert.equal(fault.connections(), 2);
  } finally {
    await seed.$disconnect();
    await fault.database.$disconnect();
    await fault.close();
  }
});

test("a persistent connection failure stays an error after one session-read retry", async () => {
  const fault = await proxy({ failures: Infinity });
  try {
    const repository = createAccountRepository(fault.database);
    await assert.rejects(
      repository.findSession(hashSessionToken("a".repeat(43)), new Date()),
    );
    assert.equal(fault.connections(), 2);
  } finally {
    await fault.database.$disconnect();
    await fault.close();
  }
});

test("a session that expires during a failed connection is not authenticated by the retry", async () => {
  const seed = createDatabase({ DATABASE_URL: databaseUrl });
  const fault = await proxy({ failures: 1, failureDelay: 150 });
  try {
    const account = await new AccountService(
      createAccountRepository(seed),
    ).signIn(
      {
        async verifyCredential() {
          return { issuer: "connection-expiry-test", subject: randomUUID() };
        },
      },
      "isolated fixture",
    );
    const tokenHash = hashSessionToken(account.token);
    const checkedAt = new Date();
    await seed.session.update({
      where: { tokenHash },
      data: { expiresAt: new Date(checkedAt.getTime() + 50) },
    });
    const restored = await createAccountRepository(fault.database).findSession(
      tokenHash,
      checkedAt,
    );
    assert.equal(restored, null);
    assert.equal(fault.connections(), 2);
  } finally {
    await seed.$disconnect();
    await fault.database.$disconnect();
    await fault.close();
  }
});

test("only transient connection errors qualify for a session-read retry", () => {
  assert.equal(
    isTransientConnectionError(
      new Error("Connection terminated due to connection timeout", {
        cause: new Error("Connection terminated unexpectedly"),
      }),
    ),
    true,
  );
  assert.equal(isTransientConnectionError({ code: "P1017" }), true);
  for (const code of ["P2021", "P2028", "P2002", "42501", "28P01"])
    assert.equal(isTransientConnectionError({ code }), false);
  assert.equal(
    isTransientConnectionError(new Error("An unknown database failure")),
    false,
  );
});
