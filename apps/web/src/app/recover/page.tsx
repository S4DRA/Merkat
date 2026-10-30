import Link from "next/link";
import { AccountFrame } from "../../components/account/account-frame";
import { RecoveryForm } from "../../components/account/security-controls";
export default function RecoverPage() {
  return (
    <AccountFrame title="Get back to your people">
      <RecoveryForm />
      <Link className="space-link" href="/login">
        Back to sign in
      </Link>
    </AccountFrame>
  );
}
