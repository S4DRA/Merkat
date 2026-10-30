import Link from "next/link";
import { requireAccount } from "../../../lib/account-server";
import { AccountFrame } from "../../../components/account/account-frame";
import { ProfileForm } from "../../../components/account/profile-form";
export default async function EditProfilePage() {
  const account = await requireAccount();
  return (
    <AccountFrame title="Edit profile">
      <ProfileForm account={account} />
      <Link className="space-link" href="/profile">
        Back
      </Link>
    </AccountFrame>
  );
}
