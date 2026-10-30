import Fastify, { LogController } from "fastify";
import {
  registerAccountRoutes,
  type AccountRoutesOptions,
} from "./account-routes.js";
export function createApp(
  logLevel = "silent",
  accounts?: AccountRoutesOptions,
) {
  const app = Fastify({
    logController: new LogController({ disableRequestLogging: true }),
    logger: {
      level: logLevel,
      redact: [
        "req.headers.authorization",
        "req.headers.cookie",
        "res.headers['set-cookie']",
      ],
    },
    bodyLimit: 1048576,
  });
  // Liveness only. This does not claim database/provider readiness or authentication.
  app.get("/health/live", async () => ({ status: "ok" }));
  if (accounts)
    app.register(async (scope) => registerAccountRoutes(scope, accounts));
  return app;
}
