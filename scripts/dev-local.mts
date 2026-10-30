import EmbeddedPostgres from "embedded-postgres";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { createServer } from "node:net";
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { claimLocalRuntime, isOwnedLocalDatabase } from "./local-runtime.mjs";

// Development only. Never reads or adopts a DATABASE_URL from an environment file.
const root = resolve("artifacts/local-development");
const directory = resolve(root, "postgres");
if (!directory.startsWith(root + sep))
  throw new Error("Invalid local database path");
const settingsPath = resolve(root, "connection.json");
type Settings = {
  owner: "merkat-local-development-v1";
  user: string;
  password: string;
  port: number;
  authSecret: string;
};
async function exists(path: string) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
async function reservePort(port = 0, host = "127.0.0.1") {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ port, host, ipv6Only: false }, resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Local port unavailable");
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}
async function settings(): Promise<Settings> {
  await mkdir(root, { recursive: true });
  if (await exists(settingsPath)) {
    let value: Settings;
    try {
      value = JSON.parse(await readFile(settingsPath, "utf8")) as Settings;
    } catch {
      throw new Error(
        "Invalid local development settings; no existing data was changed",
      );
    }
    if (
      value.owner !== "merkat-local-development-v1" ||
      !/^local_[a-f0-9]{12}$/.test(value.user) ||
      !/^[a-f0-9]{48}$/.test(value.password) ||
      !/^[a-f0-9]{64}$/.test(value.authSecret) ||
      !Number.isInteger(value.port) ||
      value.port < 1024 ||
      value.port > 65535
    )
      throw new Error(
        "Invalid local development settings; no existing data was changed",
      );
    return value;
  }
  if (await exists(directory))
    throw new Error(
      "Refusing to adopt an unrecognized local database directory",
    );
  const value: Settings = {
    owner: "merkat-local-development-v1",
    user: `local_${randomBytes(6).toString("hex")}`,
    password: randomBytes(24).toString("hex"),
    port: await reservePort(),
    authSecret: randomBytes(32).toString("hex"),
  };
  await writeFile(settingsPath, JSON.stringify(value), {
    flag: "wx",
    mode: 0o600,
  });
  return value;
}
let database: EmbeddedPostgres | undefined;
let web: ChildProcess | undefined;
let worker: ChildProcess | undefined;
let running = false;
let closing: Promise<void> | undefined;
let releaseRuntime: (() => Promise<void>) | undefined;
async function close() {
  closing ??= (async () => {
    for (const child of [web, worker])
      if (child?.pid && child.exitCode === null) {
        if (process.platform === "win32") {
          try {
            await promisify(execFile)("taskkill", [
              "/PID",
              String(child.pid),
              "/T",
              "/F",
            ]);
          } catch {
            console.error(
              "Local process already stopped or could not be stopped.",
            );
          }
        } else child.kill("SIGTERM");
      }
    if (database && running) {
      await database.stop();
      running = false;
    }
    await releaseRuntime?.();
  })();
  await closing;
}
let exitCode = 1;
try {
  const webPort = Number(process.env.MERKAT_LOCAL_PORT || 3000);
  if (!Number.isInteger(webPort) || webPort < 1024 || webPort > 65535)
    throw new Error("Use a local web port between 1024 and 65535");
  const config = await settings();
  const runtime = await claimLocalRuntime(root, {
    webPort,
    databasePort: config.port,
  });
  if (!runtime.owned) {
    console.log(
      `Merkat is already running or starting at http://localhost:${runtime.record.webPort}. Open that address; a second instance is not needed.`,
    );
    process.exit(0);
  }
  releaseRuntime = runtime.release;
  try {
    await reservePort(webPort);
  } catch {
    throw new Error(
      `Local web port ${webPort} is occupied by another process. Stop that process or set MERKAT_LOCAL_PORT.`,
    );
  }
  let reuseDatabase = false;
  try {
    await reservePort(config.port);
  } catch {
    reuseDatabase = await isOwnedLocalDatabase(config, directory);
    if (!reuseDatabase)
      throw new Error(
        `Local database port ${config.port} is occupied by an unrecognized service. No existing database or process was changed.`,
      );
  }
  const redact = (message: unknown) =>
    String(message)
      .replaceAll(config.password, "[redacted]")
      .replaceAll(config.authSecret, "[redacted]");
  if (!reuseDatabase)
    database = new EmbeddedPostgres({
      databaseDir: directory,
      user: config.user,
      password: config.password,
      port: config.port,
      persistent: true,
      authMethod: "scram-sha-256",
      postgresFlags: ["-h", "127.0.0.1", "-c", "timezone=UTC"],
      onLog: () => {},
      onError: (error) => console.error(redact(error)),
    });
  const initialized = await exists(resolve(directory, "PG_VERSION"));
  console.log(
    reuseDatabase
      ? "Reusing the verified Merkat local database…"
      : initialized
        ? "Starting existing Merkat local database…"
        : "Creating a fresh Merkat local database…",
  );
  if (database) {
    if (!initialized) await database.initialise();
    await database.start();
    running = true;
  }
  const connection = `postgresql://${config.user}:${config.password}@127.0.0.1:${config.port}/postgres`;
  // Only this known, loopback-only, owned cluster is migrated by this development command.
  try {
    await promisify(execFile)(
      process.execPath,
      [resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"],
      {
        cwd: resolve("packages/database"),
        env: {
          ...process.env,
          DATABASE_URL: connection,
          DIRECT_URL: connection,
        },
      },
    );
  } catch {
    throw new Error(
      "Local database migration failed. No external database was contacted.",
    );
  }
  console.log(`Merkat local: http://localhost:${webPort}/register`);
  console.log(
    "Username + password; email is optional. Data persists in artifacts/local-development. Ctrl+C stops the app.",
  );
  console.log(
    "Supabase live updates need the separate staging setup. Local accounts and persistent messaging work without it.",
  );
  worker = spawn(
    process.execPath,
    [
      "--conditions=react-server",
      "--import",
      "tsx",
      resolve("apps/worker/src/index.ts"),
    ],
    {
      cwd: resolve("."),
      stdio: "inherit",
      env: {
        ...process.env,
        NODE_ENV: "development",
        DATABASE_URL: connection,
        MERKAT_PUSH_PUBLIC_KEY: "",
        MERKAT_PUSH_PRIVATE_KEY: "",
        MERKAT_PUSH_SUBJECT: "",
      },
    },
  );
  web = spawn(
    process.execPath,
    [
      resolve("node_modules/next/dist/bin/next"),
      "dev",
      "--port",
      String(webPort),
      "--hostname",
      "127.0.0.1",
    ],
    {
      cwd: resolve("apps/web"),
      stdio: "inherit",
      env: {
        ...process.env,
        NODE_ENV: "development",
        DATABASE_URL: connection,
        APP_ORIGIN: `http://localhost:${webPort}`,
        AUTH_RATE_LIMIT_SECRET: config.authSecret,
        SUPABASE_REALTIME_URL: "",
        SUPABASE_PUBLISHABLE_KEY: "",
        MERKAT_REALTIME_SIGNING_JWK: "",
      },
    },
  );
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => {
      void close().then(() => process.exit(0));
    });
  exitCode = await Promise.race(
    [web, worker].map(
      (child) =>
        new Promise<number>((resolve, reject) => {
          child!.once("error", reject);
          child!.once("exit", (code) => resolve(code ?? 1));
        }),
    ),
  );
} catch (error) {
  console.error(
    error instanceof Error
      ? error.message
      : "Local development could not start.",
  );
} finally {
  await close();
}
// embedded-postgres has an exit hook; keep failures nonzero after cleanup.
process.exit(exitCode);
