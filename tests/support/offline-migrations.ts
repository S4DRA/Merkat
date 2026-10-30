// PostgreSQL single-user mode: real SQL/constraints, no sockets, no application credentials.
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
const root = resolve("artifacts/offline-postgres"),
  directory = resolve(root, randomUUID());
if (!directory.startsWith(root + sep))
  throw new Error("Unexpected verification directory");
if (process.platform !== "win32")
  throw new Error(
    "This offline harness currently targets the installed Windows PostgreSQL binaries. Use the normal integration suite on other platforms.",
  );
await mkdir(root, { recursive: true });
const binaryRoot = resolve(
  "node_modules/@embedded-postgres/windows-x64/native/bin",
);
await promisify(execFile)(
  resolve(binaryRoot, "initdb.exe"),
  [
    "-D",
    directory,
    "--username=merkat_schema",
    "--auth=trust",
    "--no-locale",
    "--encoding=UTF8",
  ],
  { timeout: 60000, maxBuffer: 4 * 1024 * 1024 },
);
const commands: string[] = [
  "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE merkat_runtime;",
];
const migrationRoot = resolve("packages/database/prisma/migrations");
const folders = (await readdir(migrationRoot, { withFileTypes: true }))
  .filter((e) => e.isDirectory())
  .sort((a, b) => a.name.localeCompare(b.name));
for (const folder of folders) {
  const sql = await readFile(
    resolve(migrationRoot, folder.name, "migration.sql"),
    "utf8",
  );
  commands.push(`BEGIN;\n${sql}\nCOMMIT;`);
}
commands.push(
  await readFile(resolve("tests/support/production-integrity.sql"), "utf8"),
);
commands.push(
  "SELECT 'MERKAT_OFFLINE_MIGRATIONS_AND_CONSTRAINTS_PASS' AS result;",
);
const input = commands
  .map(
    (sql) =>
      sql
        .replace(/\r/g, "")
        .replace(/\n(?:[\t ]*\n)+/g, "\n")
        .trim() + "\n\n",
  )
  .join("");
const result = await new Promise<{
  output: string;
  errors: string;
  code: number;
}>((resolveResult, reject) => {
  const child = spawn(
    resolve(binaryRoot, "postgres.exe"),
    ["--single", "-j", "-D", directory, "-c", "timezone=UTC", "postgres"],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  let output = "",
    errors = "";
  const timeout = setTimeout(() => {
    child.kill();
    reject(new Error("Offline PostgreSQL verification timed out"));
  }, 60000);
  child.stdout.on("data", (chunk) => (output += String(chunk)));
  child.stderr.on("data", (chunk) => (errors += String(chunk)));
  child.once("error", (error) => {
    clearTimeout(timeout);
    reject(error);
  });
  child.once("exit", (code) => {
    clearTimeout(timeout);
    resolveResult({ output, errors, code: code ?? 1 });
  });
  child.stdin.end(input);
});
await writeFile(
  resolve(root, "last-result.log"),
  result.output + result.errors,
);
if (
  result.code !== 0 ||
  /\b(ERROR|FATAL|PANIC):/.test(result.errors) ||
  !result.output.includes("MERKAT_OFFLINE_MIGRATIONS_AND_CONSTRAINTS_PASS")
) {
  console.error(result.errors.slice(0, 3000));
  throw new Error("Offline PostgreSQL migration/integrity verification failed");
}
console.log(
  JSON.stringify({
    migrations: folders.length,
    engine: "PostgreSQL single-user mode",
    migrationAndConstraintChecks: "PASS",
    networkConnections: 0,
  }),
);
