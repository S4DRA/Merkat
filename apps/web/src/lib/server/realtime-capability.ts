import "server-only";
import { createPrivateKey, sign, type JsonWebKey } from "node:crypto";
import type { MessagingService } from "@merkat/backend";
import type { RealtimeCapability } from "@merkat/contracts";

function configuration(env: NodeJS.ProcessEnv) {
  const url = new URL(env.SUPABASE_REALTIME_URL ?? "");
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("Invalid realtime configuration");
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY ?? "";
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey))
    throw new Error("Invalid publishable key");
  const jwk = JSON.parse(env.MERKAT_REALTIME_SIGNING_JWK ?? "") as JsonWebKey;
  if (
    jwk.kty !== "EC" ||
    jwk.crv !== "P-256" ||
    typeof jwk.d !== "string" ||
    typeof jwk.kid !== "string" ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(jwk.kid)
  )
    throw new Error("Invalid signing key");
  return {
    url: url.origin,
    publishableKey,
    kid: jwk.kid,
    key: createPrivateKey({ key: jwk, format: "jwk" }),
  };
}
export function realtimeConfigured(env = process.env) {
  try {
    configuration(env);
    return true;
  } catch {
    return false;
  }
}
export async function issueRealtimeCapability(
  messaging: MessagingService,
  token: string,
  env = process.env,
  now = Date.now(),
): Promise<RealtimeCapability> {
  // Session validity is checked in the database, including at every refresh.
  const session = await messaging.realtimeSession(token);
  const config = configuration(env);
  const issued = Math.floor(now / 1000);
  const exp = Math.min(
    issued + 90,
    Math.floor(session.expiresAt.getTime() / 1000),
  );
  if (exp <= issued) throw new Error("Expired realtime session");
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode({ alg: "ES256", kid: config.kid, typ: "JWT" })}.${encode({ sub: session.userId, role: "authenticated", aud: "authenticated", iss: `${config.url}/auth/v1`, iat: issued, exp, merkat_purpose: "realtime", merkat_session_id: session.sessionId })}`;
  const signature = sign("sha256", Buffer.from(unsigned), {
    key: config.key,
    dsaEncoding: "ieee-p1363",
  }).toString("base64url");
  return {
    url: config.url,
    publishableKey: config.publishableKey,
    topic: `merkat:user:${session.userId}`,
    token: `${unsigned}.${signature}`,
    expiresAt: exp,
  };
}
