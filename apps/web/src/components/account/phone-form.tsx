"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "../ui/primitives";

export function PhoneForm() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setError("");
    const token = new FormData(event.currentTarget).get("token");
    try {
      const response = await fetch(`/api/account/phone/${sent ? "verify" : "start"}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sent ? { token } : { phone: phone.trim() }),
      });
      if (!response.ok) {
        setError(response.status === 429 ? "Please wait before requesting another code." : response.status === 503 ? "Sign-in is unavailable. Please try again later." : sent ? "That code could not be verified. Try again or request a new code." : "Check your phone number and try again.");
        return;
      }
      if (!sent) setSent(true);
      else { router.replace("/chats"); router.refresh(); }
    } catch { setError("Could not connect. Please try again."); }
    finally { setPending(false); }
  }
  return <form className="account-form" onSubmit={submit}>
    <label>Phone number<input type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={pending || sent} required pattern="\+[1-9][0-9]{7,14}" placeholder="+90…" aria-describedby="phone-help" /></label>
    <small id="phone-help">Include your country code. We will send a verification code by SMS.</small>
    {sent && <label>Verification code<input name="token" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} required disabled={pending} /></label>}
    {error && <p role="alert" className="account-error">{error}</p>}
    <Button type="submit" variant="primary" loading={pending}>{sent ? "Verify and sign in" : "Send code"}</Button>
    {sent && <Button type="button" disabled={pending} onClick={() => { setSent(false); setError(""); }}>Change number or request a new code</Button>}
  </form>;
}
