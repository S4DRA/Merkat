import { handleApiRequest } from "../../../lib/server/http-api";
export const runtime = "nodejs";
async function handle(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  return handleApiRequest(request, (await context.params).path.join("/"));
}
export { handle as GET, handle as POST, handle as PATCH, handle as PUT };
