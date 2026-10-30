import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { planInputSchema, sessionCookieName } from "@merkat/contracts";
import type { AccountRoutesOptions } from "./account-routes.js";
import { hashSessionToken } from "@merkat/backend";
export function registerPlanRoutes(app: FastifyInstance, options: AccountRoutesOptions) {
  const repository = options.plans;
  if (!repository) return;
  const cookie = sessionCookieName(options.production);
  app.get("/plans", async (request, reply) => {
    const user = await options.accounts.current(request.cookies[cookie]);
    if (!user?.onboardingComplete) return reply.code(401).send({ error: "UNAUTHORIZED" });
    return { plans: await repository.list(user.id) };
  });
  app.post("/plans", { bodyLimit: 8192 }, async (request, reply) => {
    const user = await options.accounts.current(request.cookies[cookie]);
    if (!user?.onboardingComplete) return reply.code(401).send({ error: "UNAUTHORIZED" });
    const parsed = planInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_PLAN" });
    if (parsed.data.conversationId && (!options.messaging || !await options.messaging.isMember(user.id, parsed.data.conversationId)))
      return reply.code(403).send({ error: "CONVERSATION_UNAVAILABLE" });
    try { return reply.code(201).send({ plan: await repository.create(user.id, parsed.data) }); }
    catch (error) {
      if (error instanceof Error && error.message === "PARTICIPANT_NOT_FOUND") return reply.code(400).send({ error: "PARTICIPANT_NOT_FOUND" });
      throw error;
    }
  });
  app.patch("/plans", async (request, reply) => {
    const user = await options.accounts.current(request.cookies[cookie]);
    if (!user?.onboardingComplete) return reply.code(401).send({ error: "UNAUTHORIZED" });
    const parsed = z.object({ id: z.uuid(), action: z.enum(["GOING", "MAYBE", "DECLINED", "CANCEL"]) }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_REQUEST" });
    const { id, action } = parsed.data;
    const changed = action === "CANCEL" ? await repository.cancel(user.id, id) : await repository.respond(user.id, id, action);
    return changed ? reply.code(204).send() : reply.code(404).send({ error: "NOT_FOUND" });
  });
  app.post("/people/find", async (request, reply) => {
    const user = await options.accounts.current(request.cookies[cookie]);
    if (!user?.onboardingComplete) return reply.code(401).send({ error: "UNAUTHORIZED" });
    const parsed = z.object({ username: z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_]{2,29}$/) }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_REQUEST" });
    const person = await repository.findPerson(parsed.data.username, hashSessionToken(request.cookies[cookie]!));
    return person ? { person } : reply.code(404).send({ error: "NOT_FOUND" });
  });
}
