import cookie from "@fastify/cookie";
import type { FastifyInstance } from "fastify";
import { AccountError, type AccountService } from "@merkat/backend";
import { sessionCookieName } from "@merkat/contracts";
import type { PhoneIdentityProvider } from "./supabase-identity.js";
import { registerPhoneRoutes } from "./phone-routes.js";
import type { PlanRepository } from "@merkat/backend";
import type { MessagingProvider } from "./matrix-adapter.js";
import { registerPlanRoutes } from "./plan-routes.js";
import { registerMessagingRoutes } from "./messaging-routes.js";

export interface AccountRoutesOptions {
  accounts: AccountService;
  appOrigin: string;
  production: boolean;
  phoneIdentity?: PhoneIdentityProvider | undefined;
  plans?: PlanRepository;
  messaging?: MessagingProvider | undefined;
}
export async function registerAccountRoutes(
  app: FastifyInstance,
  options: AccountRoutesOptions,
) {
  await app.register(cookie);
  const cookieName = sessionCookieName(options.production);
  const cookieOptions = {
    path: "/",
    httpOnly: true,
    secure: options.production,
    sameSite: "lax" as const,
  };
  app.addHook("onRequest", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (
      !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
      (request.headers.origin !== options.appOrigin ||
        request.headers["sec-fetch-site"] === "cross-site")
    ) {
      return reply.code(403).send({ error: "REQUEST_REJECTED" });
    }
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AccountError) {
      const status =
        error.code === "UNAUTHORIZED"
          ? 401
          : error.code === "USERNAME_UNAVAILABLE"
            ? 409
            : 400;
      return reply.code(status).send({ error: error.code });
    }
    const status =
      typeof error === "object" && error !== null && "statusCode" in error
        ? Number(error.statusCode)
        : 500;
    if (status >= 400 && status < 500)
      return reply.code(status).send({ error: "INVALID_REQUEST" });
    // Never log exception messages, query parameters, tokens, profile bodies, or connection URLs.
    request.log.error({ requestId: request.id }, "Account request failed");
    return reply.code(503).send({ error: "SERVICE_UNAVAILABLE" });
  });
  app.get("/auth/session", async (request, reply) => {
    const user = await options.accounts.current(request.cookies[cookieName]);
    if (!user) return reply.code(401).send({ error: "UNAUTHORIZED" });
    return { user };
  });
  app.post("/auth/logout", async (request, reply) => {
    await options.accounts.logout(request.cookies[cookieName]);
    return reply.clearCookie(cookieName, cookieOptions).code(204).send();
  });
  app.post("/auth/session/rotate", async (request, reply) => {
    const session = await options.accounts.rotate(request.cookies[cookieName]);
    return reply
      .setCookie(cookieName, session.token, {
        ...cookieOptions,
        expires: session.expiresAt,
      })
      .code(204)
      .send();
  });
  app.patch("/account/profile", async (request) => ({
    user: await options.accounts.saveProfile(
      request.cookies[cookieName],
      request.body,
    ),
  }));
  registerPhoneRoutes(app, options);
  registerPlanRoutes(app, options);
  registerMessagingRoutes(app, options);
}
