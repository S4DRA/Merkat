import "server-only";
import {
  isAccountError,
  isPlanError,
  isAuthenticationError,
  isAuthenticationLimitError,
  isMessagingError,
  isFriendshipError,
  isSocialError,
  hashSessionToken,
} from "@merkat/backend";
import { sessionCookieName, appearanceSchema } from "@merkat/contracts";
import { z } from "zod";
import { readWebEnvironment } from "../environment";
import { getServices, type Services } from "./runtime";
import { authenticationSource } from "./authentication-environment";
import { requestFailureCode } from "./request-failure";
import {
  issueRealtimeCapability,
  realtimeConfigured,
} from "./realtime-capability";

type Configuration = { appOrigin: string; production: boolean };
const methods: Record<string, readonly string[]> = {
  "health/live": ["GET"],
  "auth/session": ["GET"],
  "auth/register": ["POST"],
  "auth/login": ["POST"],
  "auth/logout": ["POST"],
  "auth/session/rotate": ["POST"],
  "account/profile": ["PATCH"],
  "profiles/view": ["POST"],
  "preferences/get": ["POST"],
  "preferences/update": ["POST"],
  "calendar/list": ["POST"],
  "calendar/conversation": ["POST"],
  "calendar/detail": ["POST"],
  "calendar/create": ["POST"],
  "calendar/respond": ["POST"],
  "calendar/edit": ["POST"],
  "calendar/cancel": ["POST"],
  "calendar/share": ["POST"],
  "notifications/list": ["POST"],
  "notifications/read": ["POST"],
  "security/status": ["POST"],
  "security/recovery-codes": ["POST"],
  "security/change-password": ["POST"],
  "security/recover": ["POST"],
  "push/config": ["POST"],
  "push/subscribe": ["POST"],
  "push/remove": ["POST"],
  "push/status": ["POST"],
  "tabs/list": ["POST"],
  "tabs/detail": ["POST"],
  "tabs/create": ["POST"],
  "tabs/act": ["POST"],
  "tabs/context": ["POST"],
  "auth/phone/start": ["POST"],
  "auth/phone/verify": ["POST"],
  plans: ["GET", "POST", "PATCH"],
  "people/find": ["POST"],
  "messaging/connect": ["POST"],
  "messaging/rooms": ["POST"],
  "direct/list": ["POST"],
  "direct/open": ["POST"],
  "direct/messages": ["POST"],
  "direct/send": ["POST"],
  "direct/receipt": ["POST"],
  "direct/realtime": ["POST"],
  "friends/list": ["POST"],
  "friends/request": ["POST"],
  "friends/act": ["POST"],
  "groups/list": ["POST"],
  "groups/create": ["POST"],
  "groups/detail": ["POST"],
  "groups/edit": ["POST"],
  "groups/invite": ["POST"],
  "groups/invitation": ["POST"],
  "groups/member": ["POST"],
  "groups/leave": ["POST"],
  "groups/channel/create": ["POST"],
  "groups/channel/edit": ["POST"],
  "groups/messages": ["POST"],
  "groups/send": ["POST"],
  "groups/receipt": ["POST"],
  "privacy/settings": ["POST"],
  "privacy/update": ["POST"],
  "privacy/blocks": ["POST"],
  "privacy/block": ["POST"],
  "privacy/report": ["POST"],
};
class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code);
  }
}
function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
function empty(cookie?: string) {
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (cookie) headers.set("Set-Cookie", cookie);
  return new Response(null, { status: 204, headers });
}
export function requestToken(request: Request, production: boolean) {
  const name = sessionCookieName(production);
  const cookie = request.headers
    .get("cookie")
    ?.split(";")
    .find((part) => part.trim().startsWith(`${name}=`));
  const value = cookie?.trim().slice(name.length + 1);
  return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : undefined;
}
function sessionCookie(production: boolean, token = "", expires = new Date(0)) {
  return `${sessionCookieName(production)}=${token}; Path=/; Expires=${expires.toUTCString()}; HttpOnly; ${production ? "Secure; " : ""}SameSite=Lax`;
}
async function readBody(request: Request, limit: number) {
  if (Number(request.headers.get("content-length") || 0) > limit)
    throw new HttpError(413, "INVALID_REQUEST");
  if (!request.body) return undefined;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw new HttpError(413, "INVALID_REQUEST");
    }
    chunks.push(value);
  }
  if (!size) return undefined;
  if (
    !request.headers
      .get("content-type")
      ?.split(";")[0]
      ?.trim()
      .match(/^application\/json$/i)
  )
    throw new HttpError(415, "INVALID_REQUEST");
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new HttpError(400, "INVALID_REQUEST");
  }
}

/** Thin HTTP adaptation; domain/session/ownership decisions stay in services. */
export function createApiHandler(
  services: () => Pick<Services, "accounts" | "plans"> &
    Partial<
      Pick<
        Services,
        | "authentication"
        | "messaging"
        | "friendships"
        | "groups"
        | "privacy"
        | "profiles"
        | "calendar"
        | "tabs"
        | "security"
        | "push"
      >
    >,
  configuration: () => Configuration,
) {
  return async (request: Request, endpoint: string): Promise<Response> => {
    const matrix =
      endpoint.startsWith("matrix/") &&
      ["GET", "POST", "PUT"].includes(request.method);
    const supported = Object.hasOwn(methods, endpoint)
      ? methods[endpoint]
      : undefined;
    if (!matrix && !supported?.includes(request.method))
      return json({ error: "NOT_FOUND" }, 404);
    if (endpoint === "health/live") return json({ status: "ok" });
    try {
      const { production, appOrigin } = configuration();
      if (
        !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
        (request.headers.get("origin") !== appOrigin ||
          request.headers.get("sec-fetch-site") === "cross-site")
      )
        return json({ error: "REQUEST_REJECTED" }, 403);
      const token = requestToken(request, production);
      const body = await readBody(
        request,
        endpoint.startsWith("auth/phone/")
          ? 1024
          : matrix
            ? 1048576
            : endpoint === "direct/send" || endpoint === "groups/send"
              ? 24576
              : 8192,
      );
      if (endpoint === "auth/register" || endpoint === "auth/login") {
        const source = authenticationSource(request, process.env);
        const authentication = services().authentication?.();
        if (!authentication) throw new Error("Authentication is unavailable.");
        const session =
          endpoint === "auth/register"
            ? await authentication.register(body, source)
            : await authentication.login(body, source, token);
        // An account switch must retire the previous browser's push binding too.
        if (token) await services().accounts.logout(token);
        const response = json(
          { user: session.user },
          endpoint === "auth/register" ? 201 : 200,
        );
        response.headers.set(
          "Set-Cookie",
          sessionCookie(production, session.token, session.expiresAt),
        );
        return response;
      }
      if (endpoint === "security/recover") {
        const authentication = services().authentication?.();
        const security = services().security?.();
        if (!authentication || !security)
          throw new Error("Security unavailable");
        await authentication.checkCredentialLimit(
          body,
          authenticationSource(request, process.env),
        );
        return json(await security.recover(body));
      }
      // Phone providers remain inactive. No per-instance OTP state.
      if (endpoint === "auth/phone/start")
        return json({ error: "SIGN_IN_UNAVAILABLE" }, 503);
      if (endpoint === "auth/phone/verify")
        return json({ error: "CODE_REJECTED" }, 401);
      if (endpoint === "auth/logout") {
        if (token) await services().accounts.logout(token);
        return empty(sessionCookie(production));
      }
      if (!token)
        return matrix
          ? json({ errcode: "M_UNKNOWN_TOKEN", error: "Sign in again" }, 401)
          : json({ error: "UNAUTHORIZED" }, 401);
      const { accounts } = services();
      if (endpoint.startsWith("push/")) {
        const push = services().push;
        if (!push) throw new Error("Push unavailable");
        const hash = hashSessionToken(token);
        if (!(await accounts.current(token)))
          return json({ error: "UNAUTHORIZED" }, 401);
        if (endpoint === "push/config") return json(push.config());
        if (endpoint === "push/status")
          return json(await push.status(hash, body));
        return json(
          endpoint === "push/subscribe"
            ? await push.subscribe(hash, body)
            : await push.remove(hash, body),
        );
      }
      if (endpoint.startsWith("security/")) {
        const security = services().security?.();
        if (!security) throw new Error("Security unavailable");
        const hash = hashSessionToken(token);
        if (endpoint === "security/status")
          return json(await security.status(hash));
        const user = await accounts.current(token);
        if (!user) return json({ error: "UNAUTHORIZED" }, 401);
        const authentication = services().authentication?.();
        if (!authentication) throw new Error("Authentication unavailable");
        await authentication.checkCredentialLimit(
          { username: user.profile.username },
          authenticationSource(request, process.env),
        );
        return json(
          endpoint === "security/recovery-codes"
            ? await security.generate(hash, body)
            : await security.change(hash, body),
        );
      }
      if (
        endpoint.startsWith("calendar/") ||
        endpoint.startsWith("notifications/")
      ) {
        const calendar = services().calendar;
        if (!calendar) throw new Error("Calendar unavailable");
        const hash = hashSessionToken(token);
        if (endpoint === "notifications/list")
          return json(await calendar.notifications(hash));
        if (endpoint === "notifications/read")
          return json(await calendar.markRead(hash, body));
        if (endpoint === "calendar/list")
          return json(await calendar.list(hash, body));
        if (endpoint === "calendar/conversation")
          return json(await calendar.conversation(hash, body));
        if (endpoint === "calendar/detail")
          return json({ event: await calendar.detail(hash, body) });
        if (endpoint === "calendar/create")
          return json({ event: await calendar.create(hash, body) }, 201);
        if (endpoint === "calendar/respond")
          return json({ event: await calendar.respond(hash, body) });
        if (endpoint === "calendar/edit")
          return json({ event: await calendar.edit(hash, body) });
        if (endpoint === "calendar/cancel")
          return json({ event: await calendar.cancel(hash, body) });
        return json({ event: await calendar.share(hash, body) });
      }
      if (endpoint.startsWith("tabs/")) {
        const tabs = services().tabs;
        if (!tabs) throw new Error("Tabs unavailable");
        const hash = hashSessionToken(token);
        if (endpoint === "tabs/context")
          return json(await tabs.context(hash, body));
        if (endpoint === "tabs/list") return json(await tabs.list(hash, body));
        if (endpoint === "tabs/detail")
          return json({ tab: await tabs.detail(hash, body) });
        if (endpoint === "tabs/create")
          return json({ tab: await tabs.create(hash, body) }, 201);
        return json({ tab: await tabs.act(hash, body) });
      }
      if (endpoint === "profiles/view" || endpoint.startsWith("preferences/")) {
        const profiles = services().profiles;
        if (!profiles) throw new Error("Profiles unavailable");
        const hash = hashSessionToken(token);
        if (endpoint === "profiles/view") {
          const input = z.object({ userId: z.uuid() }).strict().safeParse(body);
          if (!input.success) throw new HttpError(400, "INVALID_REQUEST");
          return json({
            profile: await profiles.view(hash, input.data.userId),
          });
        }
        if (endpoint === "preferences/get")
          return json({ settings: await profiles.settings(hash) });
        const input = appearanceSchema.safeParse(body);
        if (!input.success) throw new HttpError(400, "INVALID_REQUEST");
        return json({
          settings: await profiles.updateSettings(hash, input.data),
        });
      }
      if (endpoint.startsWith("groups/")) {
        const groups = services().groups;
        if (!groups) throw Error("Groups unavailable");
        switch (endpoint) {
          case "groups/list":
            return json(await groups.list(token, body));
          case "groups/create":
            return json(await groups.create(token, body), 201);
          case "groups/detail":
            return json(await groups.detail(token, body));
          case "groups/edit":
            return json(await groups.edit(token, body));
          case "groups/invite":
            await groups.invite(token, body);
            return empty();
          case "groups/invitation":
            await groups.invitation(token, body);
            return empty();
          case "groups/member":
            return json(await groups.member(token, body));
          case "groups/leave":
            await groups.leave(token, body);
            return empty();
          case "groups/channel/create":
            return json(await groups.createChannel(token, body), 201);
          case "groups/channel/edit":
            return json(await groups.editChannel(token, body));
          case "groups/messages":
            return json(await groups.messages(token, body));
          case "groups/send":
            return json(await groups.send(token, body), 201);
          case "groups/receipt":
            return json(await groups.receipt(token, body));
        }
      }
      if (endpoint.startsWith("privacy/")) {
        const privacy = services().privacy;
        if (!privacy) throw Error("Privacy unavailable");
        switch (endpoint) {
          case "privacy/settings":
            return json(await privacy.settings(token));
          case "privacy/update":
            return json(await privacy.update(token, body));
          case "privacy/blocks":
            return json(await privacy.blocks(token, body));
          case "privacy/block":
            await privacy.block(token, body);
            return empty();
          case "privacy/report":
            await privacy.report(token, body);
            return empty();
        }
      }
      if (endpoint === "auth/session") {
        const user = await accounts.current(token);
        return user ? json({ user }) : json({ error: "UNAUTHORIZED" }, 401);
      }
      if (endpoint === "auth/session/rotate") {
        const session = await accounts.rotate(token);
        return empty(
          sessionCookie(production, session.token, session.expiresAt),
        );
      }
      if (endpoint === "account/profile")
        return json({ user: await accounts.saveProfile(token, body) });
      if (endpoint.startsWith("direct/")) {
        const messaging = services().messaging;
        if (!messaging) throw new Error("Messaging is unavailable");
        if (endpoint === "direct/list")
          return json(await messaging.list(token, body));
        if (endpoint === "direct/open")
          return json({ conversation: await messaging.open(token, body) });
        if (endpoint === "direct/messages")
          return json(await messaging.messages(token, body));
        if (endpoint === "direct/send")
          return json({ message: await messaging.send(token, body) });
        if (endpoint === "direct/receipt")
          return json({ conversation: await messaging.receipt(token, body) });
        // Authenticate even when the hosted integration hasn't been configured.
        if (!realtimeConfigured()) {
          await messaging.realtimeSession(token);
          if (
            [
              process.env.SUPABASE_REALTIME_URL,
              process.env.SUPABASE_PUBLISHABLE_KEY,
              process.env.MERKAT_REALTIME_SIGNING_JWK,
            ].some(Boolean)
          )
            throw new Error("Realtime configuration is incomplete or invalid.");
          return json({ available: false, reason: "NOT_CONFIGURED" });
        }
        return json(await issueRealtimeCapability(messaging, token));
      }
      if (endpoint.startsWith("friends/")) {
        const friendships = services().friendships;
        if (!friendships) throw new Error("Friends unavailable");
        if (endpoint === "friends/list")
          return json(await friendships.list(token, body));
        if (endpoint === "friends/request")
          return json({ friendship: await friendships.request(token, body) });
        await friendships.act(token, body);
        return empty();
      }
      if (matrix || endpoint.startsWith("messaging/")) {
        const user = await accounts.current(token);
        if (!user?.onboardingComplete)
          return matrix
            ? json({ errcode: "M_UNKNOWN_TOKEN", error: "Sign in again" }, 401)
            : json({ error: "UNAUTHORIZED" }, 401);
        return json({ error: "MESSAGING_UNAVAILABLE" }, 503);
      }
      const { plans } = services();
      if (endpoint === "people/find")
        return json({ person: await plans.findPerson(token, body) });
      if (request.method === "GET")
        return json({ plans: await plans.list(token) });
      if (request.method === "POST")
        return json({ plan: await plans.create(token, body) }, 201);
      await plans.respond(token, body);
      return empty();
    } catch (error) {
      if (isSocialError(error))
        return json(
          { error: error.code },
          error.code === "NOT_FOUND"
            ? 404
            : error.code === "FORBIDDEN" ||
                error.code === "INTERACTION_UNAVAILABLE"
              ? 403
              : error.code === "INVALID_REQUEST"
                ? 400
                : 409,
        );
      if (isMessagingError(error) || isFriendshipError(error)) {
        const response = json(
          { error: error.code },
          error.code === "NOT_FOUND"
            ? 404
            : error.code === "INTERACTION_UNAVAILABLE"
              ? 403
              : error.code === "SUBMISSION_CONFLICT"
                ? 409
                : error.code === "TRY_LATER"
                  ? 429
                  : 400,
        );
        if (error.code === "TRY_LATER")
          response.headers.set("Retry-After", String(error.retryAfter));
        return response;
      }
      if (isAuthenticationLimitError(error)) {
        const response = json({ error: "TRY_LATER" }, 429);
        response.headers.set("Retry-After", String(error.retryAfter));
        return response;
      }
      if (isAuthenticationError(error))
        return json(
          { error: error.code },
          error.code === "INVALID_CREDENTIALS"
            ? 401
            : error.code === "ACCOUNT_UNAVAILABLE"
              ? 409
              : 400,
        );
      if (error instanceof HttpError)
        return json({ error: error.code }, error.status);
      if (isAccountError(error))
        return json(
          { error: error.code },
          error.code === "UNAUTHORIZED"
            ? 401
            : error.code === "USERNAME_UNAVAILABLE"
              ? 409
              : 400,
        );
      if (isPlanError(error))
        return json(
          { error: error.code },
          error.code === "NOT_FOUND"
            ? 404
            : error.code === "CONVERSATION_UNAVAILABLE"
              ? 403
              : 400,
        );
      // Validated route keys and allowlisted codes only, never exception messages,
      // arbitrary Matrix paths, request URLs, credentials, metadata or bodies.
      console.error("Merkat API request failed.", {
        endpoint: Object.hasOwn(methods, endpoint) ? endpoint : "matrix",
        code: requestFailureCode(error),
      });
      return json({ error: "SERVICE_UNAVAILABLE" }, 503);
    }
  };
}
export const handleApiRequest = createApiHandler(getServices, () => {
  const env = readWebEnvironment(process.env);
  return {
    production: env.NODE_ENV === "production",
    appOrigin: env.APP_ORIGIN,
  };
});
