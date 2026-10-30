import { AccountError, type IdentityProvider } from "@merkat/backend";
import { z } from "zod";

export const phoneSchema = z.string().regex(/^\+[1-9]\d{7,14}$/);
export interface PhoneIdentityProvider extends IdentityProvider {
  sendCode(phone: string): Promise<void>;
}

/** A fresh server-to-server verification; never trusts browser identity claims. */
export function createSupabaseIdentity(url: string, publishableKey: string): PhoneIdentityProvider {
  const origin = new URL(url);
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/" || !publishableKey)
    throw new Error("Invalid Supabase identity configuration.");
  async function post(path: string, body: unknown) {
    const response = await fetch(new URL(`/auth/v1/${path}`, origin), {
      method: "POST",
      headers: { apikey: publishableKey, "Content-Type": "application/json" },
      body: JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      if (response.status >= 500) throw new Error("Identity provider unavailable");
      throw new AccountError("IDENTITY_REJECTED");
    }
    return response.json() as Promise<unknown>;
  }
  return {
    async sendCode(phone) {
      await post("otp", { phone: phoneSchema.parse(phone), channel: "sms", create_user: true });
    },
    async verifyCredential(credential) {
      const parsed = z.object({ phone: phoneSchema, token: z.string().regex(/^\d{6}$/) }).strict().safeParse(JSON.parse(credential));
      if (!parsed.success) throw new AccountError("IDENTITY_REJECTED");
      const result = z.object({ user: z.object({ id: z.uuid(), phone: z.string(), phone_confirmed_at: z.string().min(1) }) }).safeParse(
        await post("verify", { ...parsed.data, type: "sms" }),
      );
      if (!result.success || result.data.user.phone.replace(/^\+/, "") !== parsed.data.phone.slice(1))
        throw new AccountError("IDENTITY_REJECTED");
      return { issuer: `${origin.origin}/auth/v1`, subject: result.data.user.id };
    },
  };
}
