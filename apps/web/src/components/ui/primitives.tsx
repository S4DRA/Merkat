import Image from "next/image";
import { LoaderCircle, UserRound, type LucideIcon } from "lucide-react";
import type { ButtonHTMLAttributes } from "react";

export function Button({
  children,
  className = "",
  variant = "secondary",
  loading = false,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "quiet";
  loading?: boolean;
}) {
  return (
    <button
      type="button"
      {...props}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`button button--${variant} ${className}`}
    >
      {loading && (
        <LoaderCircle className="spinner" size={18} aria-hidden="true" />
      )}
      {children}
    </button>
  );
}
export function IconButton({
  icon: Icon,
  label,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: LucideIcon;
  label: string;
}) {
  return (
    <Button
      {...props}
      variant="quiet"
      className="icon-button"
      aria-label={label}
    >
      <Icon size={20} aria-hidden="true" />
    </Button>
  );
}
export function Badge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="badge" aria-label={`${count} unread`}>
      {count > 99 ? "99+" : count}
    </span>
  );
}
export function Avatar({
  name,
  src,
  online = false,
}: {
  name: string;
  src?: string | undefined;
  online?: boolean;
}) {
  return (
    <span
      className="avatar"
      role="img"
      aria-label={`${name}${online ? ", online" : ""}`}
    >
      {src ? (
        <Image
          src={src}
          alt=""
          fill
          sizes="44px"
          unoptimized={src.startsWith("/api/avatars/")}
        />
      ) : (
        <UserRound size={22} aria-hidden="true" />
      )}
      {online && <span className="presence-dot" />}
    </span>
  );
}
export function Skeleton() {
  return <span className="skeleton" aria-hidden="true" />;
}
