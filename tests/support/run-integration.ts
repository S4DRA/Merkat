import { spawn } from "node:child_process";
import { startTestDatabase } from "./postgres.js";
const database = await startTestDatabase();
let result = 1;
try {
  const child = spawn(
    process.execPath,
    [
      "--conditions=react-server",
      "--import",
      "tsx",
      "--test",
      "--test-concurrency=1",
      "tests/integration/accounts.test.ts",
      "tests/integration/migration.test.ts",
      "tests/integration/authentication.test.ts",
      "tests/integration/messaging.test.ts",
      "tests/integration/friendships.test.ts",
      "tests/integration/groups-privacy.test.ts",
      "tests/integration/production-recovery.test.ts",
      "tests/integration/database-connections.test.ts",
      "tests/integration/database-tls.test.ts",
      "tests/integration/list-http-recovery.test.ts",
      "tests/integration/local-runtime.test.ts",
      "tests/integration/collaboration.test.ts",
      "tests/integration/refinement.test.ts",
    ],
    {
      stdio: "inherit",
      env: { ...process.env, TEST_DATABASE_URL: database.url },
    },
  );
  const code = await new Promise<number>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
  result = code;
} finally {
  await database.stop();
}
// embedded-postgres's beforeExit hook otherwise replaces a nonzero exitCode with 0.
process.exit(result);
