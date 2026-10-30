import { createServer, connect } from "node:net";

// Fail before starting a database when the host permits listen() but denies connect().
// This is an environment failure, never a skipped or successful service test.
export async function requireTestLoopback(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const server = createServer((socket) => socket.end());
    let client: ReturnType<typeof connect> | undefined,
      done = false;
    const finish = (error?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      client?.destroy();
      server.close();
      if (error)
        reject(
          new Error(
            `TEST_ENVIRONMENT_BLOCKED: loopback unavailable (${(error as NodeJS.ErrnoException).code ?? error.message}). Real service tests did not run.`,
          ),
        );
      else resolve();
    };
    const timer = setTimeout(
      () => finish(new Error("connection timeout")),
      5000,
    );
    server.once("error", finish);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string")
        return finish(new Error("no test port"));
      client = connect({ host: "127.0.0.1", port: address.port });
      client.once("error", finish);
      client.once("connect", () => finish());
    });
  });
}
