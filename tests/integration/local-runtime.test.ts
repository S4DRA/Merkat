import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, access } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { createDatabase } from "@merkat/database";
import {
  claimLocalRuntime,
  isOwnedLocalDatabase,
} from "../../scripts/local-runtime.mjs";

const freshRoot = () => resolve("artifacts/local-runtime-tests", randomUUID());
const ports = { webPort: 3000, databasePort: 5432 };
test("a second launcher reuses an active owned instance instead of claiming its ports", async () => {
  const root = freshRoot();
  const first = await claimLocalRuntime(root, ports);
  assert.equal(first.owned, true);
  if (!first.owned) throw new Error("No owned test runtime");
  const second = await claimLocalRuntime(root, ports);
  assert.equal(second.owned, false);
  assert.equal(second.record.id, first.record.id);
  await first.release();
  await assert.rejects(access(resolve(root, "runtime.json")));
});

test("an exited launcher record can be recovered without deleting database data", async () => {
  const root = freshRoot();
  const first = await claimLocalRuntime(root, ports);
  assert.equal(first.owned, true);
  if (!first.owned) throw new Error("No owned test runtime");
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", () => resolve());
  });
  assert.ok(child.pid);
  await writeFile(
    resolve(root, "runtime.json"),
    JSON.stringify({ ...first.record, pid: child.pid }),
  );
  const next = await claimLocalRuntime(root, ports);
  assert.equal(next.owned, true);
  assert.notEqual(next.record.id, first.record.id);
  await first.release(); // The old owner cannot remove the new owner's record.
  assert.equal(
    JSON.parse(await readFile(resolve(root, "runtime.json"), "utf8")).id,
    next.record.id,
  );
  if (next.owned) await next.release();
});

test("unrecognized runtime metadata is preserved and cannot authorize process reuse", async () => {
  const root = freshRoot();
  const claimed = await claimLocalRuntime(root, ports);
  if (!claimed.owned) throw new Error("No owned test runtime");
  const file = resolve(root, "runtime.json");
  await writeFile(
    file,
    JSON.stringify({ owner: "another-application", pid: process.pid }),
  );
  await assert.rejects(
    claimLocalRuntime(root, ports),
    /Unrecognized local runtime/,
  );
  assert.equal(
    JSON.parse(await readFile(file, "utf8")).owner,
    "another-application",
  );
});

test("an existing PostgreSQL is reused only after authentication and exact data-directory verification", async () => {
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw) throw new Error("Use the isolated runner");
  const url = new URL(raw);
  assert.equal(url.hostname, "127.0.0.1");
  const db = createDatabase({ DATABASE_URL: raw });
  try {
    const [row] = await db.$queryRaw<
      { data_directory: string }[]
    >`SHOW data_directory`;
    assert.ok(row);
    const connection = {
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      port: Number(url.port),
    };
    assert.equal(
      await isOwnedLocalDatabase(connection, row.data_directory),
      true,
    );
    assert.equal(
      await isOwnedLocalDatabase(
        connection,
        resolve(row.data_directory, "different"),
      ),
      false,
    );
    assert.equal(
      await isOwnedLocalDatabase(
        { ...connection, password: randomUUID() },
        row.data_directory,
      ),
      false,
    );
  } finally {
    await db.$disconnect();
  }
});
