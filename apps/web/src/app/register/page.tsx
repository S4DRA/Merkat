import { redirect } from "next/navigation";
import { currentAccount } from "../../lib/account-server";
import { AccountFrame } from "../../components/account/account-frame";
import { AuthenticationForm } from "../../components/account/authentication-form";
import { authenticationConfigured } from "../../lib/server/authentication-environment";

export default async function RegisterPage() {
  const account = await currentAccount();
  if (account) redirect(account.onboardingComplete ? "/chats" : "/onboarding");
  return (
    <AccountFrame title="Create account">
      <AuthenticationForm
        register
        available={authenticationConfigured(process.env)}
      />
    </AccountFrame>
  );
}
