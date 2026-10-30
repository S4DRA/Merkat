import { handleApiRequest } from "../../../lib/server/http-api";
export const runtime = "nodejs";
export function GET(request: Request) {
  return handleApiRequest(request, "health/live");
}
