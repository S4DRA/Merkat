"use client";
import { useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import type { PublicProfile } from "@merkat/contracts";
import { Avatar, Button, IconButton } from "../ui/primitives";
import { directRequest, directError } from "../../lib/direct-client";
export function ProfilePreview({
  userId,
  name,
  avatarRef,
  children,
}: {
  userId: string;
  name: string;
  avatarRef?: string | null | undefined;
  children?: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  const [profile, setProfile] = useState<PublicProfile | null>(null),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false);
  async function load() {
    setPending(true);
    setError("");
    setProfile(null);
    try {
      const result = await directRequest<{ profile: PublicProfile }>(
        "profiles/view",
        { userId },
      );
      setProfile(result.profile);
    } catch (error) {
      setError(directError(error));
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <button
        type="button"
        ref={trigger}
        className="profile-trigger"
        aria-label={`View ${name}'s profile`}
        onClick={() => {
          dialog.current?.showModal();
          void load();
        }}
      >
        {children ?? <Avatar name={name} src={avatarRef ?? undefined} />}
      </button>
      <dialog
        ref={dialog}
        className="profile-dialog"
        onClose={() => trigger.current?.focus()}
        onClick={(e) => {
          if (e.target === e.currentTarget) dialog.current?.close();
        }}
        aria-label={`${name}'s profile`}
      >
        <div className="direct-dialog-heading">
          <h2>Profile</h2>
          <IconButton
            icon={X}
            label="Close profile"
            onClick={() => dialog.current?.close()}
          />
        </div>
        {pending && <p role="status">Loading profile…</p>}
        {error && (
          <div role="alert">
            <p>{error}</p>
            <Button onClick={() => void load()}>Try again</Button>
          </div>
        )}
        {profile && (
          <div className="public-profile">
            <Avatar
              name={profile.displayName ?? name}
              src={profile.avatarRef ?? undefined}
            />
            <h2>{profile.displayName}</h2>
            <p className="supporting-copy">@{profile.username}</p>
            {profile.bio && <p className="profile-bio">{profile.bio}</p>}
          </div>
        )}
      </dialog>
    </>
  );
}
