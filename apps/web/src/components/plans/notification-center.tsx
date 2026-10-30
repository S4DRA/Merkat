"use client";
import Link from "next/link";
import { useRef, useState, useCallback, useEffect } from "react";
import { Bell, CheckCheck, X } from "lucide-react";
import { Button, IconButton, Badge } from "../ui/primitives";
import { directRequest, directError } from "../../lib/direct-client";
import { useDirectRealtime } from "../chats/use-direct-realtime";
import { DirectRequestError } from "../../lib/direct-client";
import { useRouter } from "next/navigation";
const onInvalidation = () => {};
type Notice = {
  id: string;
  title: string;
  body: string;
  href: string;
  createdAt: string;
  readAt: string | null;
};
export function NotificationCenter() {
  const router = useRouter();
  const unauthorized = useCallback(
    (error: unknown) => {
      if (
        error instanceof DirectRequestError &&
        error.code === "UNAUTHORIZED"
      ) {
        router.replace("/login");
        router.refresh();
      }
    },
    [router],
  );
  useDirectRealtime(onInvalidation, unauthorized, 0);
  const dialog = useRef<HTMLDialogElement>(null);
  const fetching = useRef(false),
    queued = useRef(false);
  const [notices, setNotices] = useState<Notice[]>([]),
    [unread, setUnread] = useState(0),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    if (fetching.current) {
      queued.current = true;
      return;
    }
    fetching.current = true;
    setLoading(true);
    try {
      do {
        queued.current = false;
        const r = await directRequest<{
          notifications: Notice[];
          unread: number;
        }>("notifications/list", {});
        setNotices(r.notifications);
        setUnread(r.unread);
        setError("");
      } while (queued.current);
    } catch (error) {
      setError(directError(error));
    } finally {
      fetching.current = false;
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void load();
    });
    const changed = () => void load();
    window.addEventListener("merkat:reconcile", changed);
    window.addEventListener("merkat:feature-change", changed);
    window.addEventListener("focus", changed);
    return () => {
      active = false;
      window.removeEventListener("merkat:reconcile", changed);
      window.removeEventListener("merkat:feature-change", changed);
      window.removeEventListener("focus", changed);
    };
  }, [load]);
  async function read(id?: string) {
    try {
      await directRequest("notifications/read", id ? { id } : {});
      setNotices((old) =>
        old.map((n) =>
          !id || n.id === id ? { ...n, readAt: new Date().toISOString() } : n,
        ),
      );
      setUnread((n) => (id ? Math.max(0, n - 1) : 0));
    } catch (error) {
      setError(directError(error));
    }
  }
  return (
    <>
      <div className="notification-trigger">
        <IconButton
          icon={Bell}
          label={unread ? `Notifications, ${unread} unread` : "Notifications"}
          onClick={() => {
            dialog.current?.showModal();
            void load();
          }}
        />
        <Badge count={unread} />
      </div>
      <dialog
        ref={dialog}
        className="feature-dialog notification-dialog"
        aria-label="Notifications"
      >
        <div className="direct-dialog-heading">
          <h2>Notifications</h2>
          <IconButton
            icon={X}
            label="Close notifications"
            onClick={() => dialog.current?.close()}
          />
        </div>
        <p className="supporting-copy">Plans worth remembering.</p>
        {unread > 0 && (
          <Button onClick={() => void read()}>
            <CheckCheck size={16} />
            Mark all read
          </Button>
        )}
        {loading && <p role="status">Loading notifications…</p>}
        {error && <p role="alert">{error}</p>}
        {!loading && !error && !notices.length && (
          <div className="feature-empty">
            <Bell size={28} />
            <h3>All quiet for now.</h3>
            <p>Your plan updates and reminders will appear here.</p>
          </div>
        )}
        <div className="notice-list">
          {notices.map((n) => (
            <Link
              key={n.id}
              href={n.href}
              className="notice"
              data-unread={!n.readAt}
              onClick={() => {
                if (!n.readAt) void read(n.id);
                dialog.current?.close();
              }}
            >
              <strong>{n.title}</strong>
              <p>{n.body}</p>
              <small>{new Date(n.createdAt).toLocaleString()}</small>
            </Link>
          ))}
        </div>
      </dialog>
    </>
  );
}
