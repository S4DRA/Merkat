import { z } from "zod";
const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  APP_ORIGIN: z.url().refine((value) => {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && url.origin === value;
  }),
});
// Evaluated only for API requests, never during a credential-free build.
export function readWebEnvironment(input: Record<string, string | undefined>) {
  // Vercel supplies this hostname server-side. Never derive an allowed origin
  // from a request Host/Forwarded header. Production/custom domains stay explicit.
  const previewHost = input.VERCEL_URL ?? "";
  const preview =
    input.VERCEL === "1" &&
    input.VERCEL_ENV === "preview" &&
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.vercel\.app$/.test(previewHost);
  const result = schema.safeParse({
    ...input,
    APP_ORIGIN:
      input.APP_ORIGIN || (preview ? `https://${previewHost}` : undefined),
  });
  if (!result.success)
    throw new Error("Invalid web environment: check APP_ORIGIN and NODE_ENV.");
  if (
    result.data.NODE_ENV === "production" &&
    !result.data.APP_ORIGIN.startsWith("https://")
  )
    throw new Error(
      "Invalid web environment: production APP_ORIGIN requires HTTPS.",
    );
  return result.data;
}
