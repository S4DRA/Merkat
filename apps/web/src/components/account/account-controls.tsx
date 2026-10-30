"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Account } from "@merkat/contracts";
import { Button } from "../ui/primitives";
import { InstallAppButton } from "../install-app";
import { PrivacyControls } from "../privacy-controls";
export function AccountControls({
  account,
  showPrivacy = false,
}: {
  account: Account;
  showPrivacy?: boolean;
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
      router.replace("/login");
      router.refresh();
    } catch {
      setError("Couldn’t sign out. Try again.");
      setPending(false);
    }
  }
  return (
    <div className="account-controls">
      <h2>{account.profile.displayName}</h2>
      <p>@{account.profile.username}</p>
      {account.profile.bio && <p>{account.profile.bio}</p>}
      <Link className="button" href="/profile/edit">
        Edit profile
      </Link>
      <Button onClick={logout} loading={pending}>
        Sign out
      </Button>
      <InstallAppButton />
      {showPrivacy && <PrivacyControls />}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
