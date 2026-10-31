"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { profileInputSchema, type Account } from "@merkat/contracts";
import { Button } from "../ui/primitives";
import { AvatarEditor } from "./avatar-editor";
export function ProfileForm({ account }: { account: Account }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const input = profileInputSchema.safeParse({
      displayName: form.get("displayName"),
      username: form.get("username"),
      bio: form.get("bio") ?? "",
    });
    if (!input.success) {
      setError("Check your profile details.");
      setPending(false);
      return;
    }
    try {
      const response = await fetch("/api/account/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input.data),
      });
      if (response.status === 401) {
        router.replace("/login");
        router.refresh();
        return;
      }
      if (!response.ok) {
        setError(
          response.status === 409
            ? "Username unavailable."
            : response.status === 400
              ? "Check your profile details."
              : "Couldn’t save. Try again.",
        );
        setPending(false);
        return;
      }
      router.replace(account.onboardingComplete ? "/profile" : "/chats");
      router.refresh();
    } catch {
      setError("Couldn’t connect. Try again.");
      setPending(false);
    }
  }
  return (
    <>
      <AvatarEditor
        avatarRef={account.profile.avatarRef}
        name={account.profile.displayName ?? account.profile.username ?? "Your"}
      />
      <form
        onSubmit={submit}
        className="account-form"
        data-dirty={dirty}
        aria-busy={pending || undefined}
        onChange={(event) => {
          const values = new FormData(event.currentTarget);
          setDirty(
            values.get("displayName") !== (account.profile.displayName ?? "") ||
              values.get("username") !== (account.profile.username ?? "") ||
              (values.get("bio") ?? "") !== account.profile.bio,
          );
        }}
      >
        <label>
          Display name
          <input
            name="displayName"
            autoComplete="nickname"
            required
            maxLength={60}
            defaultValue={account.profile.displayName ?? ""}
            disabled={pending}
          />
        </label>
        <label>
          Username
          <input
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            minLength={3}
            maxLength={30}
            pattern="[A-Za-z][A-Za-z0-9_]{2,29}"
            aria-describedby="username-help"
            defaultValue={account.profile.username ?? ""}
            disabled={pending}
          />
        </label>
        <small id="username-help">
          3–30 letters, numbers or underscores. Start with a letter.
        </small>
        {account.onboardingComplete && (
          <label>
            Bio
            <textarea
              name="bio"
              maxLength={160}
              defaultValue={account.profile.bio}
              disabled={pending}
              rows={3}
            />
          </label>
        )}
        {error && (
          <p role="alert" className="account-error">
            {error}
          </p>
        )}
        <Button variant="primary" loading={pending} type="submit">
          {account.onboardingComplete ? "Save" : "Continue"}
        </Button>
      </form>
    </>
  );
}
