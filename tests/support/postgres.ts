import EmbeddedPostgres from "embedded-postgres";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { createServer } from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { requireTestLoopback } from "./loopback.js";

export async function startTestDatabase(options: { migrate?: boolean } = {}) {
  await requireTestLoopback();
  const root = resolve("artifacts", "postgres");
  const databaseDir = resolve(root, randomUUID());
  // EmbeddedPostgres deletes only this fresh, verified test cluster on stop.
  if (!databaseDir.startsWith(root + sep))
    throw new Error("Invalid test database path");
  await mkdir(root, { recursive: true });
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No test port available");
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  const password = randomBytes(24).toString("hex");
  const user = `test_${randomBytes(6).toString("hex")}`;
  const database = new EmbeddedPostgres({
    databaseDir,
    user,
    password,
    port,
    persistent: false,
    authMethod: "scram-sha-256",
    // Prisma's pg adapter serializes UTC wall time; match Supabase's default UTC server timezone.
    postgresFlags: ["-h", "127.0.0.1", "-c", "timezone=UTC"],
    onLog: () => {},
    onError: (error) =>
      console.error(String(error).replaceAll(password, "[redacted]")),
  });
  try {
    await database.initialise();
    await database.start();
    const url = `postgresql://${user}:${password}@127.0.0.1:${port}/postgres`;
    if (options.migrate !== false)
      await promisify(execFile)(
        process.execPath,
        [resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"],
        {
          cwd: resolve("packages/database"),
          env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
          timeout: 60000,
        },
      );
    return { url, stop: () => database.stop() };
  } catch (error) {
    await database.stop();
    throw error;
  }
}
