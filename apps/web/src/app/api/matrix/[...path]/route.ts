import { handleApiRequest } from "../../../../lib/server/http-api";
export const runtime = "nodejs";
async function handle(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const path = (await context.params).path;
  return handleApiRequest(
    request,
    `matrix/${path.map(encodeURIComponent).join("/")}`,
  );
}
export { handle as GET, handle as POST, handle as PUT };
