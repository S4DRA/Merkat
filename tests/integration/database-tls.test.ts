import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chmod, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { AccountService, AuthenticationService } from "@merkat/backend";
import {
  createDatabase,
  createAccountRepository,
  createCredentialRepository,
  createAuthenticationLimiter,
} from "@merkat/database";
import { startTestDatabase } from "../support/postgres.js";

// Ephemeral certificates and keys stay in ignored local test artifacts. Nothing
// here connects to a hosted database or requires a production secret.
test("Prisma PostgreSQL verifies the configured CA and server identity over real TLS", async (t) => {
  const root = resolve("artifacts", "tls");
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(resolve(root, "database-"));
  async function certificate(name: string, subjectAltName: string) {
    const cert = resolve(directory, `${name}.crt`);
    const key = resolve(directory, `${name}.key`);
    await promisify(execFile)("openssl", [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      key,
      "-out",
      cert,
      "-days",
      "1",
      "-subj",
      "/CN=MERKAT isolated TLS fixture",
      "-addext",
      `subjectAltName=${subjectAltName}`,
    ]);
    await chmod(key, 0o600);
    return { certificate: cert, key, ca: await readFile(cert, "utf8") };
  }
  try {
    const trusted = await certificate("trusted", "DNS:localhost");
    const other = await certificate("other", "DNS:wrong.example.test");
    const cluster = await startTestDatabase({
      tls: trusted,
      restartable: true,
    });
    const url = new URL(cluster.url);
    url.hostname = "localhost";
    url.searchParams.set("sslmode", "verify-full");
    const environment = {
      NODE_ENV: "production",
      DATABASE_URL: url.href,
      DATABASE_CA_CERT: trusted.ca,
    };
    const connect = () => createDatabase(environment);
    try {
      await t.test(
        "trusted TLS and a real application session survive a PostgreSQL process restart",
        async () => {
          const first = connect();
          let token = "",
            userId = "";
          try {
            const rows = await first.$queryRaw<
              { ssl: boolean; username: string }[]
            >`
            SELECT ssl, current_user AS username FROM pg_stat_ssl WHERE pid=pg_backend_pid()`;
            assert.equal(rows[0]?.ssl, true);
            assert.equal(rows[0]?.username, url.username);
            await first.$executeRaw`CREATE TABLE tls_persistence (value integer NOT NULL)`;
            await first.$executeRaw`INSERT INTO tls_persistence VALUES (42)`;
            const session = await new AuthenticationService(
              createCredentialRepository(first),
              createAuthenticationLimiter(first),
              randomBytes(32).toString("hex"),
            ).register(
              {
                username: "tls_restart_user",
                password: randomBytes(24).toString("hex"),
              },
              "isolated-tls",
            );
            token = session.token;
            userId = session.user.id;
          } finally {
            await first.$disconnect();
          }
          await cluster.restart();
          const restarted = connect();
          try {
            assert.deepEqual(
              await restarted.$queryRaw`SELECT value FROM tls_persistence`,
              [{ value: 42 }],
            );
            assert.equal(
              (
                await new AccountService(
                  createAccountRepository(restarted),
                ).current(token)
              )?.id,
              userId,
            );
          } finally {
            await restarted.$disconnect();
          }
        },
      );
      await t.test("an unrelated CA is rejected", async () => {
        const untrusted = createDatabase({
          ...environment,
          DATABASE_CA_CERT: other.ca,
        });
        try {
          await assert.rejects(
            untrusted.$queryRaw`SELECT 1`,
            /certificate|TLS|SSL/i,
          );
        } finally {
          await untrusted.$disconnect();
        }
      });
    } finally {
      await cluster.stop();
    }
    await t.test(
      "a trusted certificate for a different host is rejected",
      async () => {
        const mismatch = await startTestDatabase({
          migrate: false,
          tls: other,
        });
        const target = new URL(mismatch.url);
        target.hostname = "localhost";
        target.searchParams.set("sslmode", "verify-full");
        const client = createDatabase({
          ...environment,
          DATABASE_URL: target.href,
          DATABASE_CA_CERT: other.ca,
        });
        try {
          await assert.rejects(
            client.$queryRaw`SELECT 1`,
            /certificate|TLS|SSL|IP address|hostname/i,
          );
        } finally {
          await client.$disconnect();
          await mismatch.stop();
        }
      },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
