"use client";
import { useState, type FormEvent } from "react";
import { Download, KeyRound } from "lucide-react";
import { passwordSchema } from "@merkat/contracts";
import { Button } from "../ui/primitives";
import { directRequest, directError } from "../../lib/direct-client";
export function SecurityControls() {
  const [pending, setPending] = useState(false),
    [codes, setCodes] = useState<string[]>([]),
    [message, setMessage] = useState("");
  async function submit(
    e: FormEvent<HTMLFormElement>,
    kind: "codes" | "password",
  ) {
    e.preventDefault();
    if (pending) return;
    const form = e.currentTarget,
      values = new FormData(form);
    setMessage("");
    if (
      kind === "password" &&
      !passwordSchema.safeParse(values.get("newPassword")).success
    ) {
      setMessage("Use a passphrase of 15–128 characters.");
      return;
    }
    setPending(true);
    try {
      if (kind === "codes") {
        const result = await directRequest<{ codes: string[] }>(
          "security/recovery-codes",
          { currentPassword: values.get("currentPassword") },
        );
        setCodes(result.codes);
        setMessage(
          "New recovery codes created. Save them now; old codes no longer work.",
        );
      } else {
        await directRequest("security/change-password", {
          currentPassword: values.get("currentPassword"),
          newPassword: values.get("newPassword"),
        });
        setMessage(
          "Password changed. Other sessions and old recovery codes were revoked.",
        );
        setCodes([]);
      }
      form.reset();
    } catch (error) {
      setMessage(directError(error));
    } finally {
      setPending(false);
    }
  }
  function download() {
    const blob = new Blob(
      [
        "MERKAT RECOVERY CODES\nEach code works once. Keep these privately, away from your password.\n\n" +
          codes.join("\n"),
      ],
      { type: "text/plain" },
    );
    const url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = "merkat-recovery-codes.txt";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section className="settings-section">
      <div>
        <p className="eyebrow">KEEP YOUR SPACE YOURS</p>
        <h2>Account security</h2>
        <p className="supporting-copy">
          No email or phone verification. Optional recovery codes help you get
          back in if you forget your password.
        </p>
      </div>
      <details>
        <summary>Change password</summary>
        <form
          className="social-form"
          onSubmit={(e) => void submit(e, "password")}
        >
          <label>
            Current password
            <input
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
              maxLength={128}
            />
          </label>
          <label>
            New password
            <input
              name="newPassword"
              type="password"
              autoComplete="new-password"
              required
              minLength={15}
              maxLength={128}
            />
          </label>
          <Button type="submit" disabled={pending}>
            Change password
          </Button>
        </form>
      </details>
      <details>
        <summary>Create recovery codes</summary>
        <p className="supporting-copy">
          Creates eight single-use codes and replaces any previous set. Save
          them somewhere safe.
        </p>
        <form className="social-form" onSubmit={(e) => void submit(e, "codes")}>
          <label>
            Confirm your password
            <input
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
              maxLength={128}
            />
          </label>
          <Button type="submit" disabled={pending}>
            <KeyRound size={16} />
            Generate recovery codes
          </Button>
        </form>
      </details>
      {codes.length > 0 && (
        <div className="recovery-codes">
          <p>These codes are shown only in this session.</p>
          {codes.map((code) => (
            <code key={code}>{code}</code>
          ))}
          <div className="feature-actions">
            <Button onClick={download}>
              <Download size={16} />
              Save codes
            </Button>
            <Button onClick={() => setCodes([])}>I’ve saved them · hide</Button>
          </div>
        </div>
      )}
      <p role="status" className="settings-feedback">
        {pending ? "Updating security…" : message}
      </p>
    </section>
  );
}
export function RecoveryForm() {
  const [pending, setPending] = useState(false),
    [message, setMessage] = useState(""),
    [complete, setComplete] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const form = e.currentTarget,
      f = new FormData(form);
    setPending(true);
    setMessage("");
    try {
      await directRequest("security/recover", {
        username: f.get("username"),
        code: f.get("code"),
        newPassword: f.get("newPassword"),
      });
      form.reset();
      setComplete(true);
    } catch {
      setMessage(
        "Recovery failed. Check the username and unused recovery code, or try again later.",
      );
    } finally {
      setPending(false);
    }
  }
  return complete ? (
    <p role="status">Password updated. Sign in with your new password.</p>
  ) : (
    <form className="account-form" onSubmit={(e) => void submit(e)}>
      <p className="supporting-copy">
        Use one of the recovery codes you saved in Settings. Email and phone
        verification are not required.
      </p>
      <label>
        Username
        <input
          name="username"
          autoComplete="username"
          required
          maxLength={30}
          autoCapitalize="none"
        />
      </label>
      <label>
        Recovery code
        <input
          name="code"
          autoComplete="off"
          spellCheck={false}
          required
          maxLength={80}
        />
      </label>
      <label>
        New password
        <input
          name="newPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={15}
          maxLength={128}
        />
      </label>
      <Button type="submit" variant="primary" loading={pending}>
        Reset password
      </Button>
      {message && <p role="alert">{message}</p>}
      <p className="supporting-copy">
        Without your password or a previously saved recovery code, Merkat cannot
        unlock your account.
      </p>
    </form>
  );
}
