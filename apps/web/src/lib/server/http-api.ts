import "server-only";
import {
  isAccountError,
  isPlanError,
  isAuthenticationError,
  isAuthenticationLimitError,
  isMessagingError,
  isFriendshipError,
  isSocialError,
} from "@merkat/backend";
import { sessionCookieName } from "@merkat/contracts";
import { readWebEnvironment } from "../environment";
import { getServices, type Services } from "./runtime";
import { authenticationSource } from "./authentication-environment";
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
        "authentication" | "messaging" | "friendships" | "groups" | "privacy"
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
          return json({ error: "REALTIME_UNAVAILABLE" }, 503);
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
      // Fixed text only: never exception messages, request URLs, credentials or bodies.
      console.error("Merkat API request failed.");
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
