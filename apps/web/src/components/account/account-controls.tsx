"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Account } from "@merkat/contracts";
import { Button } from "../ui/primitives";
import { InstallAppButton } from "../install-app";
import { PrivacyControls } from "../privacy-controls";
import { Avatar } from "../ui/primitives";
import { AppearanceControls } from "../appearance";
import { SecurityControls } from "./security-controls";
export function AccountControls({
  account,
  showPrivacy = false,
  compact = false,
}: {
  account: Account;
  showPrivacy?: boolean;
  compact?: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function logout() {
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/account/logout", { method: "POST" });
      if (!response.ok) throw new Error("logout failed");
      if ("serviceWorker" in navigator)
        void navigator.serviceWorker
          .getRegistration()
          .then((registration) =>
            registration?.active?.postMessage({ type: "MERKAT_SIGN_OUT" }),
          )
          .catch(() => {});
      router.replace("/login");
      router.refresh();
    } catch {
      setError("Couldn’t sign out. Try again.");
      setPending(false);
    }
  }
  return (
    <div className="account-controls">
      {!compact && (
        <>
          <div className="profile-identity">
            <Avatar
              name={
                account.profile.displayName ?? account.profile.username ?? "You"
              }
              src={account.profile.avatarRef ?? undefined}
            />
            <p className="eyebrow">YOUR MERKAT</p>
          </div>
          <h2>{account.profile.displayName}</h2>
          <p>@{account.profile.username}</p>
          {account.profile.bio && <p>{account.profile.bio}</p>}
        </>
      )}
      <div className="account-actions">
        <Link className="button" href="/profile/edit">
          Edit profile
        </Link>
        <Button onClick={logout} loading={pending}>
          Sign out
        </Button>
        <InstallAppButton />
      </div>
      {showPrivacy && <AppearanceControls />}
      {showPrivacy && (
        <div id="privacy">
          <PrivacyControls />
        </div>
      )}
      {showPrivacy && <SecurityControls />}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
