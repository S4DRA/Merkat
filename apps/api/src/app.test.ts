import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "./app.js";
import { readApiEnvironment } from "./environment.js";

test("liveness succeeds and no product API is exposed", async () => {
  const app = createApp();
  try {
    const response = await app.inject({ method: "GET", url: "/health/live" });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { status: "ok" });
    assert.equal(
      (await app.inject({ method: "GET", url: "/chats" })).statusCode,
      404,
    );
  } finally {
    await app.close();
  }
});
test("invalid configuration fails without exposing its value", () => {
  const base = { APP_ORIGIN: "http://localhost:3000" };
  assert.throws(
    () => readApiEnvironment({ ...base, API_PORT: "private-value" }),
    {
      message: "Invalid API environment: API_PORT",
    },
  );
  assert.throws(() => readApiEnvironment({ ...base, API_PORT: "0" }));
  assert.throws(() => readApiEnvironment({ ...base, NODE_ENV: "production" }));
  assert.equal(readApiEnvironment(base).API_HOST, "127.0.0.1");
});
