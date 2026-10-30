import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { sessionCookieName } from "@merkat/contracts";
import type { AccountRoutesOptions } from "./account-routes.js";
import { phoneSchema } from "./supabase-identity.js";

/** Bounded, single-process challenges. Restarts fail closed; deploy one API replica. */
export function registerPhoneRoutes(app: FastifyInstance, options: AccountRoutesOptions) {
  const challenges = new Map<string, { phone: string; expires: number; attempts: number; busy: boolean }>();
  const sends = new Map<string, number>();
  let windowStart = Date.now();
  let windowCount = 0;
  const flowCookie = options.production ? "__Host-merkat_login" : "merkat_login";
  const cookieOptions = { path: "/", httpOnly: true, secure: options.production, sameSite: "strict" as const };
  app.post("/auth/phone/start", { bodyLimit: 1024 }, async (request, reply) => {
    if (!options.phoneIdentity) return reply.code(503).send({ error: "SIGN_IN_UNAVAILABLE" });
    const parsed = z.object({ phone: phoneSchema }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_PHONE" });
    const now = Date.now();
    for (const [id, challenge] of challenges) if (challenge.expires < now) challenges.delete(id);
    for (const [phone, expires] of sends) if (expires < now) sends.delete(phone);
    if (now - windowStart >= 3600000) { windowStart = now; windowCount = 0; }
    if (sends.has(parsed.data.phone) || windowCount >= 100 || challenges.size >= 1000) {
      return reply.header("Retry-After", "60").code(429).send({ error: "TRY_LATER" });
    }
    sends.set(parsed.data.phone, now + 60000);
    windowCount++;
    await options.phoneIdentity.sendCode(parsed.data.phone);
    const previous = request.cookies[flowCookie];
    if (previous) challenges.delete(previous);
    const id = randomBytes(32).toString("base64url");
    challenges.set(id, { phone: parsed.data.phone, expires: now + 300000, attempts: 0, busy: false });
    return reply.setCookie(flowCookie, id, { ...cookieOptions, maxAge: 300 }).code(204).send();
  });
  app.post("/auth/phone/verify", { bodyLimit: 1024 }, async (request, reply) => {
    const id = request.cookies[flowCookie] ?? "";
    const challenge = challenges.get(id);
    const parsed = z.object({ token: z.string().regex(/^\d{6}$/) }).strict().safeParse(request.body);
    if (!options.phoneIdentity || !parsed.success || !challenge || challenge.expires < Date.now() || challenge.attempts >= 5 || challenge.busy)
      return reply.code(401).send({ error: "CODE_REJECTED" });
    challenge.attempts++;
    challenge.busy = true;
    try {
      const session = await options.accounts.signIn(options.phoneIdentity,
        JSON.stringify({ phone: challenge.phone, token: parsed.data.token }),
        request.cookies[sessionCookieName(options.production)]);
      challenges.delete(id);
      return reply.clearCookie(flowCookie, cookieOptions).setCookie(sessionCookieName(options.production), session.token, {
        path: "/", httpOnly: true, secure: options.production, sameSite: "lax", expires: session.expiresAt,
      }).send({ user: session.user });
    } finally { challenge.busy = false; }
  });
}
