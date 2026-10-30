import "server-only";
import { z } from "zod";
import {
  hashSessionToken,
  isAccountError,
  isSocialError,
  isMessagingError,
} from "@merkat/backend";
import { AVATAR_MAX_BYTES } from "@merkat/contracts";
import { getServices } from "./runtime";
import { requestToken } from "./http-api";
import { readWebEnvironment } from "../environment";
import { normalizeAvatar } from "./profile-image";
const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Resource-Policy": "same-origin",
};
const reply = (error: string, status: number) =>
  Response.json({ error }, { status, headers });
export async function handleGroupAvatar(request: Request, rawId: string) {
  try {
    const id = z.uuid().safeParse(rawId);
    if (!id.success) return reply("NOT_FOUND", 404);
    const token = requestToken(request, process.env.NODE_ENV === "production");
    if (!token) return reply("UNAUTHORIZED", 401);
    const hash = hashSessionToken(token),
      avatars = getServices().groupAvatars;
    if (request.method === "GET") {
      const avatar = await avatars.read(hash, id.data);
      return new Response(new Uint8Array(avatar.bytes), {
        headers: {
          ...headers,
          "Content-Type": "image/jpeg",
          "Content-Length": String(avatar.bytes.length),
        },
      });
    }
    const environment = readWebEnvironment(process.env);
    if (
      request.headers.get("origin") !== environment.APP_ORIGIN ||
      request.headers.get("sec-fetch-site") === "cross-site"
    )
      return reply("REQUEST_REJECTED", 403);
    await avatars.reserve(hash, id.data);
    if (request.method === "DELETE")
      return Response.json(
        { avatarRef: await avatars.save(hash, id.data, null) },
        { headers },
      );
    const mime = request.headers.get("content-type")?.split(";")[0] ?? "";
    if (!["image/png", "image/jpeg"].includes(mime))
      return reply("PNG_OR_JPG_REQUIRED", 415);
    if (Number(request.headers.get("content-length") || 0) > AVATAR_MAX_BYTES)
      return reply("AVATAR_TOO_LARGE", 413);
    const reader = request.body?.getReader();
    if (!reader) return reply("INVALID_AVATAR", 400);
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > AVATAR_MAX_BYTES) {
          await reader.cancel();
          return reply("AVATAR_TOO_LARGE", 413);
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
      return reply("INVALID_AVATAR", 400);
    }
    return Response.json(
      { avatarRef: await avatars.save(hash, id.data, normalized) },
      { headers },
    );
  } catch (error) {
    if (isAccountError(error)) return reply("UNAUTHORIZED", 401);
    if (isSocialError(error))
      return reply(
        error.code,
        error.code === "NOT_FOUND"
          ? 404
          : error.code === "FORBIDDEN"
            ? 403
            : 400,
      );
    if (isMessagingError(error) && error.code === "TRY_LATER")
      return reply(error.code, 429);
    return reply("SERVICE_UNAVAILABLE", 503);
  }
}
