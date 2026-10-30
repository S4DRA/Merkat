import { readFile } from "node:fs/promises";
import { Client } from "pg";

// Independent scenarios reuse fixture identities. Give each scenario its own
// quota window without weakening application limits or waiting a real minute.
export async function resetFixtureRateLimits() {
  const config = JSON.parse(await readFile("artifacts/browser-database.json", "utf8"));
  const url = new URL(config.url);
  if (config.owner !== "merkat-isolated-browser-test-v1" ||
      !["127.0.0.1", "localhost"].includes(url.hostname) ||
      !/^test_[0-9a-f]{12}$/.test(url.username) || url.pathname !== "/postgres")
    throw new Error("Expected the isolated browser-test database");
  const db = new Client({ connectionString: config.url });
  try {
    await db.connect();
    await db.query(`UPDATE "MessagingRateLimit" SET "windowStartedAt"=clock_timestamp()-INTERVAL '61 seconds'`);
  } finally { await db.end(); }
}
