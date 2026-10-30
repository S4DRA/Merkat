import { z } from "zod";
const optional = (value: unknown) => (value === "" ? undefined : value);
const schema = z.object({
  NODE_ENV: z.preprocess(
    optional,
    z.enum(["development", "test", "production"]).default("development"),
  ),
  APP_ORIGIN: z.url().refine((value) => {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && url.origin === value;
  }),
  API_HOST: z.preprocess(optional, z.string().min(1).default("127.0.0.1")),
  API_PORT: z.preprocess(
    optional,
    z.coerce.number().int().min(1).max(65535).default(3001),
  ),
  LOG_LEVEL: z.preprocess(
    optional,
    z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
  ),
});
export function readApiEnvironment(input: Record<string, string | undefined>) {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new Error(
      `Invalid API environment: ${result.error.issues.map((issue) => issue.path.join(".")).join(", ")}`,
    );
  if (
    result.data.NODE_ENV === "production" &&
    !result.data.APP_ORIGIN.startsWith("https://")
  )
    throw new Error(
      "Invalid API environment: production APP_ORIGIN requires HTTPS.",
    );
  return result.data;
}
