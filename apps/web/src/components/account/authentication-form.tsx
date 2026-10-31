"use client";
import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import {
  registrationInputSchema,
  loginInputSchema,
  usernameSchema,
  passwordSchema,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
} from "@merkat/contracts";
import { Button } from "../ui/primitives";

function PasswordField({
  disabled,
  error,
  onBlur,
  register,
}: {
  disabled: boolean;
  error?: string | undefined;
  onBlur: () => void;
  register: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const id = "password";
  return (
    <div className="auth-field">
      <label htmlFor={id}>Password</label>
      <div className="password-control">
        <input
          id={id}
          name="password"
          type={visible ? "text" : "password"}
          autoComplete={register ? "new-password" : "current-password"}
          required
          minLength={register ? PASSWORD_MIN_LENGTH : 1}
          maxLength={PASSWORD_MAX_LENGTH}
          disabled={disabled}
          aria-invalid={!!error}
          aria-describedby={
            error
              ? `${id}-error`
              : register
                ? "password-help recovery-note"
                : undefined
          }
          onBlur={onBlur}
        />
        <button
          type="button"
          className="password-toggle"
          disabled={disabled}
          aria-controls={id}
          aria-label={`${visible ? "Hide" : "Show"} password`}
          aria-pressed={visible}
          onClick={() => setVisible(!visible)}
        >
          {visible ? (
            <EyeOff size={20} aria-hidden="true" />
          ) : (
            <Eye size={20} aria-hidden="true" />
          )}
        </button>
      </div>
      {error && (
        <small id={`${id}-error`} className="auth-field-error">
          {error}
        </small>
      )}
    </div>
  );
}

export function AuthenticationForm({
  register = false,
  available,
}: {
  register?: boolean;
  available: boolean;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  function validate(form: HTMLFormElement, field?: string) {
    const values = new FormData(form);
    const input = {
      username: String(values.get("username") ?? ""),
      password: String(values.get("password") ?? ""),
      ...(register ? { email: String(values.get("email") ?? "") } : {}),
    };
    const errors: Record<string, string> = {};
    if (register) {
      if (!registrationInputSchema.shape.email.safeParse(input.email).success)
        errors.email = "Enter a valid email or leave it blank.";
      if (!usernameSchema.safeParse(input.username).success)
        errors.username = "Choose a valid username.";
      if (!passwordSchema.safeParse(input.password).success)
        errors.password = `${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} characters.`;
    } else {
      if (!loginInputSchema.shape.username.safeParse(input.username).success)
        errors.username = "Check your username.";
      if (!input.password) errors.password = "Enter your password.";
    }
    setFieldErrors((previous) =>
      field ? { ...previous, [field]: errors[field] ?? "" } : errors,
    );
    return { input, errors, valid: Object.keys(errors).length === 0 };
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !available) return;
    setError("");
    const form = event.currentTarget;
    const { input, errors, valid } = validate(form);
    if (!valid) {
      form
        .querySelector<HTMLInputElement>(`[name="${Object.keys(errors)[0]}"]`)
        ?.focus();
      return;
    }
    const parsed = (
      register ? registrationInputSchema : loginInputSchema
    ).safeParse(input);
    if (!parsed.success) {
      setError("Check your details.");
      return;
    }
    setPending(true);
    setError("");
    try {
      const response = await fetch(
        `/api/account/${register ? "register" : "login"}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsed.data),
        },
      );
      if (!response.ok) {
        setError(
          response.status === 429
            ? "Too many attempts. Try again later."
            : response.status === 401
              ? "Username or password is incorrect."
              : response.status === 409
                ? "Couldn’t create account. Try different details."
                : response.status === 400
                  ? "Check your details."
                  : "Sign-in is unavailable. Try again.",
        );
        setPending(false);
        return;
      }
      router.replace("/chats");
      router.refresh();
    } catch {
      setError("Couldn’t connect. Try again.");
      setPending(false);
    }
  }
  return (
    <>
      <form
        ref={formRef}
        className="account-form auth-form"
        method="post"
        action={`/api/account/${register ? "register" : "login"}`}
        onSubmit={submit}
        onInput={(event) => {
          const field = (event.target as HTMLInputElement).name;
          // Clear corrected errors while typing so blur cannot move the submit
          // button between pointer-down and pointer-up.
          if (field && fieldErrors[field]) validate(event.currentTarget, field);
        }}
        noValidate
        aria-busy={pending}
      >
        <div className="auth-field">
          <label htmlFor="auth-username">Username</label>
          <input
            id="auth-username"
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            minLength={3}
            maxLength={30}
            pattern="[A-Za-z][A-Za-z0-9_]{2,29}"
            disabled={pending || !available}
            aria-invalid={!!fieldErrors.username}
            aria-describedby={
              fieldErrors.username
                ? "auth-username-error"
                : register
                  ? "auth-username-help"
                  : undefined
            }
            onBlur={(event) => validate(event.currentTarget.form!, "username")}
          />
          {fieldErrors.username && (
            <small id="auth-username-error" className="auth-field-error">
              {fieldErrors.username}
            </small>
          )}
        </div>
        {register && (
          <small id="auth-username-help">
            3–30 letters, numbers or underscores. Start with a letter.
          </small>
        )}
        <PasswordField
          register={register}
          disabled={pending || !available}
          error={fieldErrors.password}
          onBlur={() => {
            if (formRef.current) validate(formRef.current, "password");
          }}
        />
        {register && (
          <small id="password-help">
            {PASSWORD_MIN_LENGTH}–{PASSWORD_MAX_LENGTH} characters.
          </small>
        )}
        {register && (
          <div className="auth-field">
            <label htmlFor="auth-email">Email (optional)</label>
            <input
              id="auth-email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={254}
              disabled={pending || !available}
              aria-invalid={!!fieldErrors.email}
              aria-describedby={
                fieldErrors.email ? "auth-email-error" : undefined
              }
              onBlur={(event) => validate(event.currentTarget.form!, "email")}
            />
            {fieldErrors.email && (
              <small id="auth-email-error" className="auth-field-error">
                {fieldErrors.email}
              </small>
            )}
          </div>
        )}
        {register && (
          <p id="recovery-note" className="auth-recovery">
            Optional recovery codes are available in Settings after joining.
          </p>
        )}
        <div className="auth-feedback" aria-live="polite">
          {error && (
            <p role="alert" className="account-error">
              {error}
            </p>
          )}
          {!available && <p role="status">Sign-in is unavailable.</p>}
        </div>
        <Button
          variant="primary"
          type="submit"
          loading={pending}
          disabled={!available}
        >
          {register ? "Create account" : "Sign in"}
        </Button>
      </form>
      <Link
        className="space-link auth-switch"
        href={register ? "/login" : "/register"}
      >
        {register ? "Sign in" : "Create account"}
      </Link>
      {!register && (
        <Link className="space-link" href="/recover">
          Use a recovery code
        </Link>
      )}
    </>
  );
}
