import { timingSafeEqual } from "node:crypto";
import { getServices } from "./runtime";
export async function handleReminderJob(request: Request) {
  const secret = process.env.CRON_SECRET,
    auth = request.headers.get("authorization") ?? "";
  const headers = { "Cache-Control": "no-store" };
  if (!secret || secret.length < 32)
    return Response.json(
      { error: "SERVICE_UNAVAILABLE" },
      { status: 503, headers },
    );
  const expected = `Bearer ${secret}`;
  if (
    Buffer.byteLength(auth) !== Buffer.byteLength(expected) ||
    !timingSafeEqual(Buffer.from(auth), Buffer.from(expected))
  )
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401, headers });
  try {
    return Response.json(await getServices().calendar.deliverDue(), {
      headers,
    });
  } catch {
    return Response.json(
      { error: "SERVICE_UNAVAILABLE" },
      { status: 503, headers },
    );
  }
}
