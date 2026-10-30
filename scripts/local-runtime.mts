import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { Client } from "pg";

type Runtime = {
  owner: "merkat-local-runtime-v1";
  id: string;
  pid: number;
  webPort: number;
  databasePort: number;
};
const validPort = (port: number) =>
  Number.isInteger(port) && port >= 1024 && port <= 65535;
function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}
async function readRuntime(path: string): Promise<Runtime> {
  let record: Runtime;
  try {
    record = JSON.parse(await readFile(path, "utf8")) as Runtime;
  } catch (error) {
    if (error instanceof SyntaxError)
      throw new Error(
        "Unrecognized local runtime record; no process or database was changed.",
      );
    throw error;
  }
  if (
    record.owner !== "merkat-local-runtime-v1" ||
    !/^[a-f0-9]{32}$/.test(record.id) ||
    !Number.isInteger(record.pid) ||
    record.pid <= 0 ||
    !validPort(record.webPort) ||
    !validPort(record.databasePort)
  )
    throw new Error(
      "Unrecognized local runtime record; no process or database was changed.",
    );
  return record;
}

export async function claimLocalRuntime(
  root: string,
  ports: { webPort: number; databasePort: number },
) {
  const file = resolve(root, "runtime.json");
  await mkdir(root, { recursive: true });
  const record: Runtime = {
    owner: "merkat-local-runtime-v1",
    id: randomBytes(16).toString("hex"),
    pid: process.pid,
    ...ports,
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await writeFile(file, JSON.stringify(record), {
        flag: "wx",
        mode: 0o600,
      });
      return {
        owned: true as const,
        record,
        async release() {
          try {
            if ((await readRuntime(file)).id === record.id) await unlink(file);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    // Allow the winning process to finish its exclusive metadata write.
    await new Promise((resolve) => setTimeout(resolve, 30));
    const existing = await readRuntime(file);
    if (alive(existing.pid)) return { owned: false as const, record: existing };
    if ((await readRuntime(file)).id === existing.id) await unlink(file);
  }
  throw new Error("Another local startup is in progress; try again shortly.");
}

export async function isOwnedLocalDatabase(
  config: { user: string; password: string; port: number },
  expectedDirectory: string,
) {
  const client = new Client({
    ...config,
    host: "127.0.0.1",
    database: "postgres",
    connectionTimeoutMillis: 1500,
    query_timeout: 1500,
  });
  let connectionFailed = false;
  client.on("error", () => {
    connectionFailed = true;
  });
  try {
    await client.connect();
    const result = await client.query<{ data_directory: string }>(
      "SHOW data_directory",
    );
    const actual = resolve(result.rows[0]?.data_directory ?? "");
    const expected = resolve(expectedDirectory);
    return (
      !connectionFailed &&
      (process.platform === "win32"
        ? actual.toLowerCase() === expected.toLowerCase()
        : actual === expected)
    );
  } catch {
    // Failed authentication, non-Postgres listeners and other clusters are never
    // adopted. Do not log exceptions containing connection details/credentials.
    return false;
  } finally {
    await client.end();
  }
}
