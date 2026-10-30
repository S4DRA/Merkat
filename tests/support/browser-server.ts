import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { createServer as createHttpsServer } from "node:https";
import { request as httpRequest } from "node:http";
import { randomUUID, randomBytes, generateKeyPairSync } from "node:crypto";
import {
  createDatabase,
  createAccountRepository,
  createAuthenticationLimiter,
  createCredentialRepository,
} from "@merkat/database";
import { AccountService, AuthenticationService } from "@merkat/backend";
import { sessionCookieName } from "@merkat/contracts";
import { startTestDatabase } from "./postgres.js";

const postgres = await startTestDatabase();
const database = createDatabase({ DATABASE_URL: postgres.url });
const accounts = new AccountService(createAccountRepository(database));
const origin = "https://127.0.0.1:3100";
const authSecret = randomBytes(32).toString("hex");
await mkdir("artifacts", { recursive: true });
await writeFile("artifacts/browser-database.json", JSON.stringify({
  owner: "merkat-isolated-browser-test-v1", url: postgres.url,
}));
for (const fixture of ["authenticated", "onboarding", "rotation"]) {
  const onboarded = fixture !== "onboarding";
  // Trusted test fixture only. No application imports this file or exposes a login bypass.
  const session = await accounts.signIn(
    {
      async verifyCredential() {
        return { issuer: "browser-test", subject: randomUUID() };
      },
    },
    "test fixture",
  );
  if (onboarded)
    await accounts.saveProfile(session.token, {
      displayName: "Test Account",
      username: `${fixture}_test`,
      bio: "",
    });
  const storage = {
    cookies: [
      {
        name: sessionCookieName(true),
        value: session.token,
        domain: "127.0.0.1",
        path: "/",
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
        expires: Math.floor(session.expiresAt.getTime() / 1000),
      },
    ],
    origins: [],
  };
  await writeFile(`artifacts/${fixture}-state.json`, JSON.stringify(storage));
}
// Real password registration through the production domain service, isolated DB only.
// These test accounts and session artifacts are never imported by application code.
const authentication = new AuthenticationService(
  createCredentialRepository(database),
  createAuthenticationLimiter(database),
  authSecret,
);
for (const name of [
  "first",
  "second",
  "lifecycle_first",
  "lifecycle_second",
  "group_owner",
  "group_member",
  "group_outsider",
  "acceptance_first",
  "acceptance_second",
  "acceptance_third",
]) {
  const session = await authentication.register(
    {
      username: `dm_${name}_test`,
      displayName: `DM ${name}`,
      password: randomBytes(32).toString("base64url"),
    },
    `browser-fixture-${randomUUID()}`,
  );
  await writeFile(
    `artifacts/dm-${name}-state.json`,
    JSON.stringify({
      cookies: [
        {
          name: sessionCookieName(true),
          value: session.token,
          domain: "127.0.0.1",
          path: "/",
          httpOnly: true,
          secure: true,
          sameSite: "Lax",
          expires: Math.floor(session.expiresAt.getTime() / 1000),
        },
      ],
      origins: [],
    }),
  );
}
// A generated test key and reserved .invalid host support explicitly mocked socket tests.
// No actual hosted Supabase project or signing key is contacted.
const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const realtimeSigningJwk = JSON.stringify({
  ...privateKey.export({ format: "jwk" }),
  kid: randomUUID(),
});
const web = spawn(
  process.execPath,
  [
    resolve("node_modules/next/dist/bin/next"),
    "start",
    "--port",
    "3101",
    "--hostname",
    "127.0.0.1",
  ],
  {
    cwd: resolve("apps/web"),
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: postgres.url,
      APP_ORIGIN: origin,
      AUTH_RATE_LIMIT_SECRET: authSecret,
      SUPABASE_REALTIME_URL: "https://realtime.fixture.invalid",
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture",
      MERKAT_REALTIME_SIGNING_JWK: realtimeSigningJwk,
      VERCEL: "1",
    },
  },
);
// Test-only TLS ingress. Production still uses Vercel's standard HTTPS ingress.
const tls = createHttpsServer(
  {
    key: readFileSync(resolve("tests/support/tls/localhost-test.key")),
    cert: readFileSync(resolve("tests/support/tls/localhost-test.crt")),
  },
  (incoming, outgoing) => {
    const upstream = httpRequest(
      {
        hostname: "127.0.0.1",
        port: 3101,
        path: incoming.url,
        method: incoming.method,
        // Model Vercel's trusted ingress: client-supplied source headers are replaced.
        headers: {
          ...incoming.headers,
          "x-vercel-forwarded-for":
            incoming.socket.remoteAddress ?? "127.0.0.1",
        },
      },
      (response) => {
        outgoing.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(outgoing);
      },
    );
    upstream.on("error", () => {
      outgoing.writeHead(502);
      outgoing.end();
    });
    incoming.pipe(upstream);
  },
);
await new Promise<void>((resolve) => tls.listen(3100, "127.0.0.1", resolve));
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  web.kill();
  tls.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    tls.close((error) => (error ? reject(error) : resolve())),
  );
  await database.$disconnect();
  await postgres.stop();
}
process.once("SIGINT", () => {
  void close();
});
process.once("SIGTERM", () => {
  void close();
});
web.on("error", () => {
  console.error("Browser test web server failed.");
  process.exitCode = 1;
  void close();
});
web.on("exit", (code) => {
  if (!closing) {
    process.exitCode = code ?? 1;
    void close();
  }
});
