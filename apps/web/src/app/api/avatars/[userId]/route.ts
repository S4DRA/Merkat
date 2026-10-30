import { handleAvatarRead } from "../../../../lib/server/avatar-read";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  context: { params: Promise<{ userId: string }> },
) {
  return handleAvatarRead(request, (await context.params).userId);
}
