const transientCodes = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "P1001",
  "P1002",
  "P1017",
  "08003",
  "08006",
  "57P01",
]);
const transientMessages = new Set([
  "Connection terminated due to connection timeout",
  "Connection terminated unexpectedly",
  "Connection terminated",
  "timeout exceeded when trying to connect",
]);

// Driver errors may arrive directly or as a cause. Do not interpret arbitrary
// exception text, retry schema/auth errors, or treat P2028 as safe to replay.
export function isTransientConnectionError(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 4; depth++) {
    if (!current || typeof current !== "object") return false;
    if ("code" in current && typeof current.code === "string") {
      if (transientCodes.has(current.code)) return true;
      if (/^P\d{4}$/.test(current.code)) return false;
    }
    if (
      "message" in current &&
      typeof current.message === "string" &&
      transientMessages.has(current.message)
    )
      return true;
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
}
