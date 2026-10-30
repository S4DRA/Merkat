import "server-only";
import { isIP } from "node:net";
import { readWebEnvironment } from "../environment";

export function authenticationSecret(
  input: Record<string, string | undefined>,
) {
  const secret = input.AUTH_RATE_LIMIT_SECRET;
  if (!secret || !/^[a-fA-F0-9]{64}$/.test(secret))
    throw new Error("Authentication configuration is missing.");
  return secret;
}
export function authenticationConfigured(
  input: Record<string, string | undefined>,
) {
  try {
    readWebEnvironment(input);
    authenticationSecret(input);
    return (
      !!input.DATABASE_URL &&
      (input.NODE_ENV !== "production" || input.VERCEL === "1")
    );
  } catch {
    return false;
  }
}
export function authenticationSource(
  request: Request,
  input: Record<string, string | undefined>,
) {
  // Development is loopback/local work. Never trust client-supplied proxy headers.
  if (input.NODE_ENV !== "production") return "local-development";
  if (input.VERCEL !== "1")
    throw new Error("Trusted authentication ingress is unavailable.");
  const ip = request.headers.get("x-vercel-forwarded-for") ?? "";
  const version = isIP(ip);
  if (!version)
    throw new Error("Trusted authentication source is unavailable.");
  if (version === 4) return ip;
  // Canonicalize aliases and aggregate IPv6 /64; rotating addresses within one
  // client network must not create fresh source quotas. Normalize IPv4-mapped IPs.
  const normalized = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
  const [head = "", tail = ""] = normalized.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const parts = normalized.includes("::")
    ? [
        ...left,
        ...Array<string>(8 - left.length - right.length).fill("0"),
        ...right,
      ]
    : left;
  const numbers = parts.map((part) => parseInt(part, 16));
  if (numbers.slice(0, 5).every((part) => part === 0) && numbers[5] === 65535) {
    const high = numbers[6]!,
      low = numbers[7]!;
    return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
  }
  return `${numbers
    .slice(0, 4)
    .map((part) => part.toString(16))
    .join(":")}::/64`;
}
