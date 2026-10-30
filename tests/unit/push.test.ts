import assert from "node:assert/strict";
import { test } from "node:test";
import { createDatabase, createPushRepository } from "@merkat/database";

test("unconfigured push fails closed without querying a database or claiming device delivery", async () => {
  const names = [
    "MERKAT_PUSH_PUBLIC_KEY",
    "MERKAT_PUSH_PRIVATE_KEY",
    "MERKAT_PUSH_SUBJECT",
  ] as const;
  const saved = names.map((name) => process.env[name]);
  for (const name of names) delete process.env[name];
  // A real lazy Prisma client, with no listening service; deliver must return before I/O.
  const db = createDatabase({
    DATABASE_URL: "postgresql://isolated:unused@127.0.0.1:1/test",
  });
  try {
    const push = createPushRepository(db);
    assert.deepEqual(push.config(), { available: false, publicKey: null });
    assert.deepEqual(await push.deliver(), {
      configured: false,
      attempted: 0,
      accepted: 0,
    });
  } finally {
    await db.$disconnect();
    names.forEach((name, i) => {
      if (saved[i] === undefined) delete process.env[name];
      else process.env[name] = saved[i];
    });
  }
});
