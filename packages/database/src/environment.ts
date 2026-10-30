import { z } from "zod";
const postgresUrl = z.string().refine((value) => {
  try {
    const url = new URL(value);
    return (
      ["postgres:", "postgresql:"].includes(url.protocol) &&
      !!url.hostname &&
      url.pathname.length > 1
    );
  } catch {
    return false;
  }
});
export function readDatabaseEnvironment(
  input: Record<string, string | undefined>,
) {
  const result = z
    .object({
      DATABASE_URL: postgresUrl,
      DATABASE_CA_CERT: z
        .string()
        .trim()
        .startsWith("-----BEGIN CERTIFICATE-----")
        .endsWith("-----END CERTIFICATE-----")
        .optional(),
    })
    .safeParse(input);
  if (!result.success)
    throw new Error("Invalid database environment: check DATABASE_URL.");
  if (result.data.DATABASE_CA_CERT) {
    const url = new URL(result.data.DATABASE_URL);
    if (
      url.searchParams.getAll("sslmode").length !== 1 ||
      url.searchParams.get("sslmode") !== "verify-full" ||
      url.searchParams.has("sslrootcert")
    )
      throw new Error(
        "Invalid database environment: DATABASE_CA_CERT requires sslmode=verify-full without sslrootcert.",
      );
  }
  if (input.NODE_ENV === "production") {
    const url = new URL(result.data.DATABASE_URL);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    // pg accepts a host query parameter that overrides the URL hostname. Reject
    // that ambiguity, and require authenticated TLS for every remote production DB.
    if (
      url.searchParams.has("host") ||
      (!loopback &&
        (url.searchParams.getAll("sslmode").length !== 1 ||
          url.searchParams.get("sslmode") !== "verify-full"))
    )
      throw new Error(
        "Invalid database environment: remote production DATABASE_URL requires sslmode=verify-full and a trusted server certificate.",
      );
  }
  return result.data;
}
