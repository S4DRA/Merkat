import { expect, type Page, type WebSocketRoute } from "@playwright/test";

// Explicit mock of Phoenix/Supabase socket transport. Database, sessions, capability issuer,
// all history/send/receipt APIs and React UI remain real. This is NOT hosted delivery evidence.
export async function mockRealtime(page: Page) {
  let socket: WebSocketRoute | undefined;
  let topic = "";
  let joinRef: string | null = null;
  let disconnected = false;
  let joins = 0;
  let authorizationUpdates = 0;
  let expiresAt = 0;
  function expiration(token: string) {
    const claims = JSON.parse(
      Buffer.from(token.split(".")[1]!, "base64url").toString(),
    );
    expect(claims.exp).toBeGreaterThan(Date.now() / 1000);
    return claims.exp as number;
  }
  await page.routeWebSocket("wss://realtime.fixture.invalid/**", (ws) => {
    socket = ws;
    ws.onMessage((data) => {
      const [join, ref, incomingTopic, event, payload] = JSON.parse(
        String(data),
      );
      if (event === "phx_join") {
        expect(payload.config.private).toBe(true);
        expect(payload.access_token).toBeTruthy();
        topic = incomingTopic;
        joinRef = join;
        joins++;
        expiresAt = expiration(payload.access_token);
      }
      if (event === "access_token") {
        authorizationUpdates++;
        expiresAt = expiration(payload.access_token);
      }
      if (
        event === "phx_join" ||
        event === "heartbeat" ||
        event === "phx_leave"
      )
        ws.send(
          JSON.stringify([
            join,
            ref,
            incomingTopic,
            "phx_reply",
            { status: "ok", response: {} },
          ]),
        );
    });
  });
  return {
    authorization() {
      // Counters/expiry only: never expose a capability token to test output.
      return { joins, authorizationUpdates, expiresAt };
    },
    async disconnect() {
      await expect.poll(() => !!socket && !!topic).toBe(true);
      const previous = socket!;
      socket = undefined;
      topic = "";
      await previous.close({ code: 1001, reason: "Test transport disconnect" });
    },
    async notify() {
      await expect.poll(() => !!socket && !!topic).toBe(true);
      if (!disconnected)
        socket!.send(
          JSON.stringify([
            joinRef,
            null,
            topic,
            "broadcast",
            { type: "broadcast", event: "changed", payload: {} },
          ]),
        );
    },
    pause() {
      disconnected = true;
    },
    async reconnect() {
      disconnected = false;
      await page.evaluate(() => window.dispatchEvent(new Event("online")));
      await this.notify();
    },
  };
}
