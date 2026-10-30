import { redirect } from "next/navigation";
import { requireAccount } from "../../lib/account-server";
import { AccountFrame } from "../../components/account/account-frame";
import { ProfileForm } from "../../components/account/profile-form";
export default async function OnboardingPage() {
  const account = await requireAccount(false);
  if (account.onboardingComplete) redirect("/chats");
  return (
    <AccountFrame title="Your profile">
      <ProfileForm account={account} />
    </AccountFrame>
  );
}
