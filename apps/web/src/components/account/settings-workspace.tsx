import Link from "next/link";
import type { Account } from "@merkat/contracts";
import { ArrowLeft } from "lucide-react";
import { AccountControls } from "./account-controls";
export function SettingsWorkspace({ account }: { account: Account }) {
  return (
    <div className="settings-workspace">
      <header className="feature-page-heading">
        <div>
          <Link className="space-link" href="/profile">
            <ArrowLeft size={16} />
            Back to profile
          </Link>
          <p className="eyebrow">YOUR SPACE. YOUR PREFERENCES.</p>
          <h1>Settings</h1>
          <p className="supporting-copy">
            Make Merkat comfortable, private and easy to use.
          </p>
        </div>
      </header>
      <div className="settings-main">
        <AccountControls account={account} showPrivacy compact />
      </div>
    </div>
  );
}
