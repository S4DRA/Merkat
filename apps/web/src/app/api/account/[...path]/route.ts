import { handleApiRequest } from "../../../../lib/server/http-api";
export const runtime = "nodejs";
const routes: Record<string, { method: string; endpoint: string }> = {
  session: { method: "GET", endpoint: "auth/session" },
  register: { method: "POST", endpoint: "auth/register" },
  login: { method: "POST", endpoint: "auth/login" },
  logout: { method: "POST", endpoint: "auth/logout" },
  rotate: { method: "POST", endpoint: "auth/session/rotate" },
  profile: { method: "PATCH", endpoint: "account/profile" },
  "phone/start": { method: "POST", endpoint: "auth/phone/start" },
  "phone/verify": { method: "POST", endpoint: "auth/phone/verify" },
  plans: { method: "GET", endpoint: "plans" },
  "plans/create": { method: "POST", endpoint: "plans" },
  "plans/respond": { method: "PATCH", endpoint: "plans" },
  "people/find": { method: "POST", endpoint: "people/find" },
  "messaging/connect": { method: "POST", endpoint: "messaging/connect" },
  "messaging/rooms": { method: "POST", endpoint: "messaging/rooms" },
};
async function handle(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const route = routes[(await context.params).path.join("/")];
  return handleApiRequest(
    request,
    route?.method === request.method ? route.endpoint : "",
  );
}
export { handle as GET, handle as POST, handle as PATCH };
