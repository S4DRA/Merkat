// Log only known classifications. Never serialize exceptions: Prisma messages
// and metadata can include SQL parameters, connection URLs or private content.
const codes = new Set([
  "P2021",
  "P2022",
  "P2010",
  "P2024",
  "P2028",
  "P1001",
  "P1002",
  "42P01",
  "42703",
  "42501",
  "53300",
  "57P03",
  "ECONNREFUSED",
  "ETIMEDOUT",
]);
export function requestFailureCode(error: unknown): string {
  if (!error || typeof error !== "object") return "UNEXPECTED_FAILURE";
  const code = "code" in error ? error.code : undefined;
  return typeof code === "string" && codes.has(code)
    ? code
    : "UNEXPECTED_FAILURE";
}
