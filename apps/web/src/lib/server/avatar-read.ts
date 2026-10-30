import { z } from "zod";
import { hashSessionToken, isAccountError } from "@merkat/backend";
import { getServices } from "./runtime";
import { requestToken } from "./http-api";

export async function handleAvatarRead(request: Request, userId: string) {
  const headers = {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "same-origin",
  };
  try {
    const token = requestToken(request, process.env.NODE_ENV === "production");
    if (!token) return new Response(null, { status: 401, headers });
    const id = z.uuid().safeParse(userId);
    if (!id.success) return new Response(null, { status: 404, headers });
    const avatar = await getServices().profiles.avatar(
      hashSessionToken(token),
      id.data,
    );
    return new Response(new Uint8Array(avatar.bytes), {
      headers: {
        ...headers,
        "Content-Type": "image/jpeg",
        "Content-Length": String(avatar.bytes.length),
      },
    });
  } catch (error) {
    return new Response(null, {
      status: isAccountError(error) ? 401 : 404,
      headers,
    });
  }
}
