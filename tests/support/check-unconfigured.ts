import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { setTimeout } from "node:timers/promises";

// A built product server with no database, identity provider or test session.
for (const configuredOrigin of [false, true]) {
  const socket = createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const address = socket.address();
  if (!address || typeof address === "string")
    throw new Error("No test port available");
  const port = address.port;
  await new Promise<void>((done) => socket.close(() => done()));
  const child = spawn(
    process.execPath,
    [
      resolve("node_modules/next/dist/bin/next"),
      "start",
      "--port",
      String(port),
      "--hostname",
      "127.0.0.1",
    ],
    {
      cwd: resolve("apps/web"),
      stdio: "ignore",
      env: {
        ...process.env,
        NODE_ENV: "production",
        DATABASE_URL: "",
        DIRECT_URL: "",
        APP_ORIGIN: configuredOrigin ? "https://merkat.test" : "",
      },
    },
  );
  try {
    const base = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        ready = (await fetch(`${base}/health/live`)).ok;
      } catch {
        /* Server is still starting. */
      }
      if (ready) break;
      if (child.exitCode !== null)
        throw new Error("Unconfigured server exited");
      await setTimeout(100);
    }
    assert.ok(ready, "Liveness must work without configuration");
    const login = await fetch(`${base}/login`);
    assert.equal(login.status, 200);
    assert.match(await login.text(), /Sign-in is unavailable/);
    const protectedPage = await fetch(`${base}/chats`, { redirect: "manual" });
    assert.equal(protectedPage.status, 307);
    assert.equal(protectedPage.headers.get("location"), "/login");
    assert.equal(
      (await fetch(`${base}/api/account/session`)).status,
      configuredOrigin ? 401 : 503,
    );
    const forged = await fetch(`${base}/api/account/session`, {
      headers: { cookie: `__Host-merkat_session=${"a".repeat(43)}` },
    });
    assert.equal(forged.status, 503);
    assert.deepEqual(await forged.json(), { error: "SERVICE_UNAVAILABLE" });
    console.info(
      `Unconfigured production server: login/liveness/authorization passed (APP_ORIGIN ${configuredOrigin ? "set" : "absent"}).`,
    );
  } finally {
    const exited = once(child, "exit");
    child.kill();
    await exited;
  }
}
