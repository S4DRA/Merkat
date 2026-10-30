import { AVATAR_MAX_BYTES } from "@merkat/contracts";
import {
  hashSessionToken,
  isAccountError,
  isSocialError,
  isMessagingError,
} from "@merkat/backend";
import { getServices } from "./runtime";
import { requestToken } from "./http-api";
import { readWebEnvironment } from "../environment";
import { normalizeAvatar } from "./profile-image";

const reply = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
export async function handleAvatarUpload(request: Request) {
  try {
    const environment = readWebEnvironment(process.env);
    if (
      request.headers.get("origin") !== environment.APP_ORIGIN ||
      request.headers.get("sec-fetch-site") === "cross-site"
    )
      return reply({ error: "REQUEST_REJECTED" }, 403);
    const token = requestToken(request, process.env.NODE_ENV === "production");
    if (!token || !(await getServices().accounts.current(token)))
      return reply({ error: "UNAUTHORIZED" }, 401);
    const hash = hashSessionToken(token);
    await getServices().profiles.reserveAvatarUpload(hash);
    if (request.method === "DELETE")
      return reply(await getServices().profiles.saveAvatar(hash, null));
    const mime = request.headers.get("content-type")?.split(";")[0] ?? "";
    if (!["image/png", "image/jpeg"].includes(mime))
      return reply({ error: "PNG_OR_JPG_REQUIRED" }, 415);
    if (Number(request.headers.get("content-length") || 0) > AVATAR_MAX_BYTES)
      return reply({ error: "AVATAR_TOO_LARGE" }, 413);
    const reader = request.body?.getReader();
    if (!reader) return reply({ error: "INVALID_AVATAR" }, 400);
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > AVATAR_MAX_BYTES) {
          await reader.cancel();
          return reply({ error: "AVATAR_TOO_LARGE" }, 413);
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    let normalized: Buffer;
    try {
      normalized = await normalizeAvatar(Buffer.concat(chunks), mime);
    } catch {
      return reply({ error: "INVALID_AVATAR" }, 400);
    }
    return reply(await getServices().profiles.saveAvatar(hash, normalized));
  } catch (error) {
    if (isAccountError(error)) return reply({ error: error.code }, 401);
    if (isMessagingError(error) && error.code === "TRY_LATER")
      return reply({ error: "TRY_LATER" }, 429);
    if (isSocialError(error)) return reply({ error: error.code }, 400);
    return reply({ error: "SERVICE_UNAVAILABLE" }, 503);
  }
}
