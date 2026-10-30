import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sessionCookieName } from "@merkat/contracts";
import { getServices } from "./server/runtime";

export async function currentAccount() {
  const name = sessionCookieName(process.env.NODE_ENV === "production");
  const token = (await cookies()).get(name)?.value;
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return getServices().accounts.current(token);
}
export async function requireAccount(onboarded = true) {
  const account = await currentAccount();
  if (!account) redirect("/login");
  if (onboarded && !account.onboardingComplete) redirect("/onboarding");
  return account;
}
