"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { MoreHorizontal, X } from "lucide-react";
import type { BlockedList, PrivacySettings } from "@merkat/contracts";
import { Button, IconButton } from "./ui/primitives";
import { directRequest, directError } from "../lib/direct-client";

export function SocialDialog({
  title,
  close,
  children,
  sheet = false,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
  sheet?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`direct-new-chat social-dialog${sheet ? " social-sheet" : ""}`}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="direct-dialog-heading">
        <h2>{title}</h2>
        <IconButton
          label={`Close ${title.toLowerCase()}`}
          icon={X}
          onClick={close}
        />
      </div>
      {children}
    </dialog>
  );
}
export function ReportDialog({
  target,
  close,
}: {
  target: { kind: "USER" | "GROUP"; id: string };
  close: () => void;
}) {
  const [category, setCategory] = useState("SPAM"),
    [reason, setReason] = useState(""),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  const clientId = useRef<string>("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");
    clientId.current ||= crypto.randomUUID();
    try {
      await directRequest("privacy/report", {
        clientId: clientId.current,
        target,
        category,
        reason,
      });
      setSaved(true);
    } catch (e) {
      setError(directError(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <SocialDialog
      title={target.kind === "GROUP" ? "Report group" : "Report user"}
      close={close}
    >
      {saved ? (
        <>
          <p role="status">Report saved privately.</p>
          <Button onClick={close}>Done</Button>
        </>
      ) : (
        <form className="social-form" onSubmit={(e) => void submit(e)}>
          <label>
            Category
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              disabled={pending}
            >
              <option value="SPAM">Spam</option>
              <option value="HARASSMENT">Harassment</option>
              <option value="OTHER">Other</option>
            </select>
          </label>
          <label>
            Reason
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={1000}
              required
              disabled={pending}
            />
          </label>
          <Button type="submit" variant="primary" loading={pending}>
            Save report
          </Button>
          {error && <p role="alert">{error}</p>}
        </form>
      )}
    </SocialDialog>
  );
}
export function UserSafetyActions({
  userId,
  blocked = false,
  changed,
}: {
  userId: string;
  blocked?: boolean;
  changed: () => void;
}) {
  const [open, setOpen] = useState(false),
    [report, setReport] = useState(false),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  async function toggle() {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      await directRequest("privacy/block", { userId, blocked: !blocked });
      changed();
      setOpen(false);
    } catch (e) {
      setError(directError(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <IconButton
        label="Conversation options"
        icon={MoreHorizontal}
        onClick={() => setOpen(true)}
      />
      {open && (
        <SocialDialog title="Conversation options" close={() => setOpen(false)}>
          <div className="social-form">
            <p>
              Blocking stops direct messages and invitations. Shared groups stay
              visible.
            </p>
            <Button onClick={() => void toggle()} loading={pending}>
              {blocked ? "Unblock user" : "Block user"}
            </Button>
            <Button
              onClick={() => {
                setOpen(false);
                setReport(true);
              }}
            >
              Report user
            </Button>
            {error && <p role="alert">{error}</p>}
          </div>
        </SocialDialog>
      )}
      {report && (
        <ReportDialog
          target={{ kind: "USER", id: userId }}
          close={() => setReport(false)}
        />
      )}
    </>
  );
}
export function PrivacyControls() {
  const [settings, setSettings] = useState<PrivacySettings | null>(null),
    [blocks, setBlocks] = useState<BlockedList | null>(null),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      directRequest<PrivacySettings>("privacy/settings", {}, controller.signal),
      directRequest<BlockedList>("privacy/blocks", {}, controller.signal),
    ])
      .then(([s, b]) => {
        setSettings(s);
        setBlocks(b);
        setError("");
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(directError(e));
      });
    return () => controller.abort();
  }, [attempt]);
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!settings || pending) return;
    setPending(true);
    setError("");
    setSaved(false);
    try {
      setSettings(
        await directRequest<PrivacySettings>("privacy/update", settings),
      );
      setSaved(true);
    } catch (e) {
      setError(directError(e));
    } finally {
      setPending(false);
    }
  }
  async function unblock(id: string) {
    setPending(true);
    setError("");
    try {
      await directRequest("privacy/block", { userId: id, blocked: false });
      setBlocks((old) =>
        old ? { ...old, people: old.people.filter((p) => p.id !== id) } : old,
      );
    } catch (e) {
      setError(directError(e));
    } finally {
      setPending(false);
    }
  }
  async function more() {
    if (!blocks?.nextCursor || pending) return;
    setPending(true);
    try {
      const next = await directRequest<BlockedList>("privacy/blocks", {
        before: blocks.nextCursor,
      });
      setBlocks((old) =>
        old
          ? {
              ...next,
              people: [
                ...old.people,
                ...next.people.filter(
                  (p) => !old.people.some((o) => o.id === p.id),
                ),
              ],
            }
          : next,
      );
    } catch (e) {
      setError(directError(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="privacy-controls" aria-label="Privacy">
      <h2>Privacy</h2>
      {!settings && !error && <p role="status">Loading privacy…</p>}
      {settings && (
        <form className="social-form" onSubmit={(e) => void save(e)}>
          <label className="social-check">
            <input
              type="checkbox"
              checked={settings.allowNonFriendDms}
              onChange={(e) => {
                setSaved(false);
                setSettings({
                  ...settings,
                  allowNonFriendDms: e.target.checked,
                });
              }}
              disabled={pending}
            />
            Allow new DMs from non-friends
          </label>
          <label>
            Group invitations
            <select
              value={settings.groupInvitesFrom}
              disabled={pending}
              onChange={(e) => {
                setSaved(false);
                setSettings({
                  ...settings,
                  groupInvitesFrom: e.target
                    .value as PrivacySettings["groupInvitesFrom"],
                });
              }}
            >
              <option value="FRIENDS">Friends</option>
              <option value="EVERYONE">Everyone</option>
              <option value="NOBODY">Nobody</option>
            </select>
          </label>
          <Button type="submit" loading={pending}>
            Save privacy
          </Button>
          {saved && <p role="status">Saved.</p>}
        </form>
      )}
      <h3>Blocked users</h3>
      {blocks?.people.length === 0 && <p>No blocked users.</p>}
      {blocks?.people.map((person) => (
        <div key={person.id} className="social-member-row">
          <span>{person.displayName ?? person.username}</span>
          <Button disabled={pending} onClick={() => void unblock(person.id)}>
            Unblock
          </Button>
        </div>
      ))}
      {blocks?.nextCursor && (
        <Button disabled={pending} onClick={() => void more()}>
          More blocked users
        </Button>
      )}
      {error && (
        <p role="alert">
          {error}
          <Button onClick={() => setAttempt((a) => a + 1)}>
            Retry privacy
          </Button>
        </p>
      )}
    </section>
  );
}
