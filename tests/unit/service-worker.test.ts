import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
const source = await readFile("apps/web/public/sw.js", "utf8");
function worker(userId: string | null, offline = false) {
  const handlers = new Map<string, (event: unknown) => void>();
  const notifications: unknown[] = [];
  const responses: Promise<unknown>[] = [];
  const cached: string[] = [];
  const self = {
    location: { origin: "https://merkat.test" },
    addEventListener: (name: string, handler: (event: unknown) => void) =>
      handlers.set(name, handler),
    registration: {
      showNotification: async (...args: unknown[]) => {
        notifications.push(args);
      },
    },
    clients: { claim: async () => {}, matchAll: async () => [] },
    skipWaiting: async () => {},
  };
  vm.runInNewContext(source, {
    self,
    URL,
    Request,
    Response,
    Promise,
    caches: {
      open: async () => ({
        match: async () => null,
        put: async (request: Request) => cached.push(request.url),
      }),
      match: async () => new Response("offline"),
      keys: async () => [],
    },
    fetch: async (input: string | Request) => {
      if (offline) throw new Error("offline");
      return typeof input === "string" && input === "/api/auth/session"
        ? Response.json({ user: userId ? { id: userId } : null })
        : new Response("public", { status: 200 });
    },
  });
  return { handlers, notifications, responses, cached };
}
test("push payloads require the currently authenticated recipient; logout/account switch/offline never display private bodies", async () => {
  for (const [user, offline] of [
    [null, false],
    ["account-b", false],
    ["account-a", true],
    ["account-a", false],
  ] as const) {
    const w = worker(user, offline);
    let done = Promise.resolve();
    w.handlers.get("push")!({
      data: {
        json: () => ({
          id: "notice",
          userId: "account-a",
          title: "Private activity",
          body: "Private content",
          href: "/plans?event=00000000-0000-4000-8000-000000000001",
        }),
      },
      waitUntil: (value: Promise<void>) => {
        done = value;
      },
    });
    await done;
    assert.equal(
      w.notifications.length,
      user === "account-a" && !offline ? 1 : 0,
    );
  }
});
test("service worker leaves authenticated API, avatars and financial/calendar data outside its cache handler", () => {
  const w = worker("account-a");
  for (const path of [
    "/api/direct/list",
    "/api/calendar/list",
    "/api/tabs/detail",
    "/api/avatars/private",
    "/api/groups/private/avatar",
    "/api/security/codes",
  ]) {
    let intercepted = false;
    w.handlers.get("fetch")!({
      request: new Request(`https://merkat.test${path}`),
      respondWith: () => {
        intercepted = true;
      },
    });
    assert.equal(intercepted, false, path);
  }
});
