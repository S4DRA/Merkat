"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import { Check, MessageCircle, Search, UserPlus, Users, X } from "lucide-react";
import type {
  FriendList,
  FriendListInput,
  FriendView,
  DirectConversationView,
} from "@merkat/contracts";
import { Avatar, Badge, Button, IconButton, Skeleton } from "../ui/primitives";
import {
  directRequest,
  directError,
  DirectRequestError,
} from "../../lib/direct-client";
import { useDirectRealtime } from "../chats/use-direct-realtime";

type Section = FriendListInput["section"];
const sections = [
  { id: "FRIENDS", label: "Friends" },
  { id: "INCOMING", label: "Requests" },
  { id: "OUTGOING", label: "Sent" },
] as const;
export function FriendsWorkspace() {
  const router = useRouter();
  const [section, setSection] = useState<Section>("FRIENDS");
  const [page, setPage] = useState<FriendList | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState("");
  const [find, setFind] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const currentSection = useRef(section);
  const version = useRef(0);
  const unauthorized = useCallback(
    (error: unknown) => {
      if (
        error instanceof DirectRequestError &&
        error.code === "UNAUTHORIZED"
      ) {
        setPage(null);
        router.replace("/login");
        router.refresh();
      }
    },
    [router],
  );
  const refresh = useCallback(() => {
    const selected = currentSection.current;
    const request = ++version.current;
    void directRequest<FriendList>("friends/list", { section: selected })
      .then((value) => {
        if (request === version.current) {
          setPage(value);
          setError("");
        }
      })
      .catch((error) => {
        if (request === version.current) {
          setError(directError(error));
          unauthorized(error);
        }
      });
  }, [unauthorized]);
  const connection = useDirectRealtime(refresh, unauthorized, attempt);
  useEffect(() => {
    currentSection.current = section;
    const request = ++version.current;
    const controller = new AbortController();
    directRequest<FriendList>("friends/list", { section }, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted && request === version.current) {
          setPage(value);
          setError("");
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted && request === version.current) {
          setError(directError(error));
          unauthorized(error);
        }
      });
    return () => controller.abort();
  }, [section, unauthorized]);
  useEffect(() => {
    const focus = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", focus);
    window.addEventListener("online", focus);
    document.addEventListener("visibilitychange", focus);
    return () => {
      window.removeEventListener("focus", focus);
      window.removeEventListener("online", focus);
      document.removeEventListener("visibilitychange", focus);
    };
  }, [refresh]);
  function switchSection(id: Section) {
    if (id !== section) {
      currentSection.current = id;
      setSection(id);
      setPage(null);
      setError("");
    }
  }
  async function act(
    friend: FriendView,
    action: "ACCEPT" | "DECLINE" | "CANCEL" | "REMOVE",
  ) {
    if (pending) return;
    setPending(friend.id);
    setError("");
    try {
      await directRequest<void>("friends/act", { id: friend.id, action });
      refresh();
    } catch (error) {
      setError(directError(error));
      unauthorized(error);
    } finally {
      setPending("");
    }
  }
  async function message(friend: FriendView) {
    if (!friend.person.username || pending) return;
    setPending(friend.id);
    setError("");
    try {
      const { conversation } = await directRequest<{
        conversation: DirectConversationView;
      }>("direct/open", { username: friend.person.username });
      router.push(`/chats?conversation=${conversation.id}`);
    } catch (error) {
      setError(directError(error));
      unauthorized(error);
    } finally {
      setPending("");
    }
  }
  async function more() {
    if (!page?.nextCursor || pending) return;
    setPending("more");
    const selected = section;
    try {
      const value = await directRequest<FriendList>("friends/list", {
        section,
        before: page.nextCursor,
      });
      if (currentSection.current === selected)
        setPage((old) =>
          old
            ? {
                ...value,
                people: [
                  ...old.people,
                  ...value.people.filter(
                    (p) => !old.people.some((existing) => existing.id === p.id),
                  ),
                ],
              }
            : value,
        );
    } catch (error) {
      setError(directError(error));
      unauthorized(error);
    } finally {
      setPending("");
    }
  }
  return (
    <section className="friends-workspace" aria-label="Friends">
      <header className="friends-heading">
        <h1>Friends</h1>
        <IconButton
          label="Find friends"
          icon={Search}
          onClick={() => setFind(true)}
        />
      </header>
      <div
        className="friends-tabs"
        role="tablist"
        aria-label="Friends sections"
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
            return;
          event.preventDefault();
          const index = sections.findIndex((item) => item.id === section);
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? 2
                : (index + (event.key === "ArrowRight" ? 1 : 2)) % 3;
          const item = sections[next]!;
          switchSection(item.id);
          document.getElementById(`friends-tab-${item.id}`)?.focus();
        }}
      >
        {sections.map((item) => (
          <button
            key={item.id}
            id={`friends-tab-${item.id}`}
            type="button"
            role="tab"
            aria-selected={section === item.id}
            aria-controls="friends-panel"
            tabIndex={section === item.id ? 0 : -1}
            onClick={() => switchSection(item.id)}
          >
            {item.label}
            {item.id === "INCOMING" && page && (
              <Badge count={page.incomingCount} />
            )}
          </button>
        ))}
      </div>
      <div className="friends-status" role="status">
        {connection === "live"
          ? "Live"
          : connection === "unavailable"
            ? "Live updates unavailable"
            : "Connecting…"}
        {connection !== "live" && (
          <button
            type="button"
            onClick={() => {
              setAttempt((v) => v + 1);
              refresh();
            }}
          >
            Reconnect
          </button>
        )}
      </div>
      {error && (
        <div className="direct-feedback" role="alert">
          {error}
          <Button onClick={refresh}>Retry</Button>
        </div>
      )}
      <div
        id="friends-panel"
        role="tabpanel"
        aria-labelledby={`friends-tab-${section}`}
        className="friends-list"
      >
        {!page && !error && (
          <div className="direct-loading" role="status">
            <Skeleton />
            <span>Loading…</span>
          </div>
        )}
        {page?.people.length === 0 && (
          <div className="direct-empty">
            <Users size={38} strokeWidth={1.5} />
            <h2>
              {section === "FRIENDS"
                ? "Find your people."
                : section === "INCOMING"
                  ? "All caught up."
                  : "No requests sent."}
            </h2>
            {section === "FRIENDS" && (
              <Button onClick={() => setFind(true)}>Find friends</Button>
            )}
          </div>
        )}
        {page?.people.map((friend) => (
          <article key={friend.id} className="friend-row">
            <Avatar
              name={
                friend.person.displayName ?? friend.person.username ?? "Person"
              }
            />
            <div className="friend-name">
              <strong>
                {friend.person.displayName ?? friend.person.username}
              </strong>
              <p>@{friend.person.username}</p>
            </div>
            <div className="friend-actions">
              {section === "FRIENDS" ? (
                <>
                  <Button
                    aria-label={`Message ${friend.person.username}`}
                    onClick={() => void message(friend)}
                    disabled={!!pending}
                  >
                    <MessageCircle size={18} />
                    <span>Message</span>
                  </Button>
                  <button
                    className="friend-subtle"
                    type="button"
                    onClick={() => void act(friend, "REMOVE")}
                    disabled={!!pending}
                  >
                    Remove
                  </button>
                </>
              ) : section === "INCOMING" ? (
                <>
                  <Button
                    variant="primary"
                    loading={pending === friend.id}
                    disabled={!!pending}
                    onClick={() => void act(friend, "ACCEPT")}
                  >
                    <Check size={16} />
                    Accept
                  </Button>
                  <button
                    className="friend-subtle"
                    type="button"
                    disabled={!!pending}
                    onClick={() => void act(friend, "DECLINE")}
                  >
                    Decline
                  </button>
                </>
              ) : (
                <button
                  className="friend-subtle"
                  type="button"
                  disabled={!!pending}
                  onClick={() => void act(friend, "CANCEL")}
                >
                  Cancel request
                </button>
              )}
            </div>
          </article>
        ))}
        {page?.nextCursor && (
          <Button
            className="direct-more"
            loading={pending === "more"}
            onClick={() => void more()}
          >
            More people
          </Button>
        )}
      </div>
      {find && (
        <FindFriend
          close={() => setFind(false)}
          added={() => {
            setFind(false);
            switchSection("OUTGOING");
            refresh();
          }}
          unauthorized={unauthorized}
        />
      )}
    </section>
  );
}

function FindFriend({
  close,
  added,
  unauthorized,
}: {
  close: () => void;
  added: () => void;
  unauthorized: (error: unknown) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [username, setUsername] = useState("");
  const [person, setPerson] = useState<FriendView["person"] | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  async function find(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");
    setPerson(null);
    try {
      setPerson(
        (
          await directRequest<{ person: FriendView["person"] }>("people/find", {
            username,
          })
        ).person,
      );
    } catch (error) {
      setError(directError(error));
      unauthorized(error);
    } finally {
      setPending(false);
    }
  }
  async function request() {
    if (!person?.username || pending) return;
    setPending(true);
    setError("");
    try {
      await directRequest("friends/request", { username: person.username });
      added();
    } catch (error) {
      setError(directError(error));
      unauthorized(error);
    } finally {
      setPending(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="direct-new-chat"
      aria-labelledby="find-friend-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClose={close}
    >
      <div className="direct-dialog-heading">
        <h2 id="find-friend-title">Find friends</h2>
        <IconButton label="Close find friends" icon={X} onClick={close} />
      </div>
      <form method="post" onSubmit={find}>
        <label htmlFor="friend-username">Username</label>
        <div className="direct-find">
          <span aria-hidden="true">@</span>
          <input
            id="friend-username"
            name="username"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            required
            pattern="[A-Za-z][A-Za-z0-9_]{2,29}"
            maxLength={30}
            value={username}
            disabled={pending}
            onChange={(e) => {
              setUsername(e.target.value);
              setPerson(null);
              setError("");
            }}
          />
          <Button type="submit" loading={pending}>
            Find
          </Button>
        </div>
      </form>
      {error && (
        <p className="direct-feedback" role="alert">
          {error}
        </p>
      )}
      {person && (
        <div className="direct-person">
          <Avatar name={person.displayName ?? person.username ?? "Person"} />
          <div>
            <strong>{person.displayName}</strong>
            <p>@{person.username}</p>
          </div>
          <Button
            variant="primary"
            loading={pending}
            onClick={() => void request()}
          >
            <UserPlus size={18} />
            Add
          </Button>
        </div>
      )}
    </dialog>
  );
}
