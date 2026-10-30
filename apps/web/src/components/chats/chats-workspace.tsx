"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ArrowDown,
  ArrowLeft,
  Check,
  CheckCheck,
  MessageSquarePlus,
  RefreshCw,
  Send,
  Search,
  X,
} from "lucide-react";
import type {
  ConversationList,
  DirectConversationView,
  DirectMessageView,
  MessagePage,
} from "@merkat/contracts";
import { MESSAGE_MAX_LENGTH } from "@merkat/contracts";
import { Avatar, Badge, Button, IconButton, Skeleton } from "../ui/primitives";
import {
  DirectRequestError,
  directError,
  directRequest,
  mergeMessages,
  reconcileMessages,
} from "../../lib/direct-client";
import { useDirectRealtime } from "./use-direct-realtime";
import { GroupInboxEntries } from "../groups/group-list";
import { UserSafetyActions } from "../privacy-controls";
import { ProfilePreview } from "../account/profile-preview";
import {
  ConversationFeatures,
  FeatureCard,
} from "../plans/conversation-features";

type Thread = {
  conversation: DirectConversationView;
  messages: DirectMessageView[];
  hasOlder: boolean;
  syncedSequence: number;
};
type Pending = {
  clientId: string;
  text: string;
  state: "sending" | "failed";
  error?: string;
};
type ThreadPosition = {
  top: number;
  bottom: boolean;
  draft: string;
  pending: Pending[];
};
export type DirectMemory = {
  threads: Map<string, Thread>;
  positions: Map<string, ThreadPosition>;
};
const time = (date: string) =>
  new Date(date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const stamp = (date: string) =>
  new Date(date).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export function ChatsWorkspace({
  userId,
  initialMemory,
  remember,
}: {
  userId: string;
  initialMemory?: DirectMemory;
  remember?:
    | ((
        id: string,
        thread: Thread | undefined,
        position: ThreadPosition,
      ) => void)
    | undefined;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const selected = params.get("conversation") ?? "";
  const [list, setList] = useState<ConversationList | null>(null);
  const [listError, setListError] = useState("");
  const [listPending, setListPending] = useState(false);
  const [localNewChat, setNewChat] = useState(false);
  const newChat = localNewChat || params.get("new") === "1";
  const [attempt, setAttempt] = useState(0);
  const [groupRevision, setGroupRevision] = useState(0);
  const [threads, setThreads] = useState(() => new Map(initialMemory?.threads));
  const [positions, setPositions] = useState(
    () => new Map(initialMemory?.positions),
  );
  const cache = useRef(new Map(initialMemory?.threads));
  const busy = useRef(false);
  const queued = useRef(false);
  const selectedRef = useRef(selected);
  useLayoutEffect(() => {
    selectedRef.current = selected;
  }, [selected]);
  const unauthorized = useCallback(
    (error: unknown) => {
      if (
        error instanceof DirectRequestError &&
        error.code === "UNAUTHORIZED"
      ) {
        cache.current.clear();
        setThreads(new Map());
        setList(null);
        router.replace("/login");
        router.refresh();
      }
    },
    [router],
  );
  const refresh = useCallback(async () => {
    if (busy.current) {
      queued.current = true;
      return;
    }
    busy.current = true;
    setGroupRevision((v) => v + 1);
    try {
      do {
        queued.current = false;
        const fresh = await directRequest<ConversationList>("direct/list", {});
        setList((old) => {
          if (!old || !old.nextCursor) return fresh;
          const ids = new Set(fresh.conversations.map((c) => c.id));
          return {
            ...fresh,
            nextCursor: old.nextCursor,
            conversations: [
              ...fresh.conversations,
              ...old.conversations.filter((c) => !ids.has(c.id)),
            ].sort(
              (a, b) =>
                b.activityAt.localeCompare(a.activityAt) ||
                b.id.localeCompare(a.id),
            ),
          };
        });
        setListError("");
        const id = selectedRef.current;
        const current = cache.current.get(id);
        if (current) {
          await reconcileMessages(
            current.messages,
            (after, through) =>
              directRequest<MessagePage>("direct/messages", {
                conversationId: id,
                after,
                ...(through !== undefined ? { through } : {}),
              }),
            (page, messages) => {
              const newest = cache.current.get(id) ?? current;
              cache.current.set(id, {
                ...newest,
                conversation: page.conversation,
                messages: mergeMessages(newest.messages, messages),
                syncedSequence: Math.max(
                  newest.syncedSequence,
                  page.messages.at(-1)?.sequence ?? newest.syncedSequence,
                ),
              });
              setThreads(new Map(cache.current));
            },
            current.syncedSequence,
          );
        }
      } while (queued.current);
    } catch (error) {
      setListError(directError(error));
      unauthorized(error);
    } finally {
      busy.current = false;
    }
  }, [unauthorized]);
  const refreshEvent = useCallback(() => {
    void refresh();
  }, [refresh]);
  const connection = useDirectRealtime(refreshEvent, unauthorized, attempt);
  useEffect(() => {
    const controller = new AbortController();
    directRequest<ConversationList>("direct/list", {}, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          setList(value);
          setListError("");
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setListError(directError(error));
          unauthorized(error);
        }
      });
    const focus = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", focus);
    window.addEventListener("online", focus);
    window.addEventListener("merkat:feature-change", focus);
    document.addEventListener("visibilitychange", focus);
    return () => {
      controller.abort();
      window.removeEventListener("focus", focus);
      window.removeEventListener("online", focus);
      window.removeEventListener("merkat:feature-change", focus);
      document.removeEventListener("visibilitychange", focus);
    };
  }, [refresh, unauthorized]);
  useEffect(() => {
    const viewport = window.visualViewport;
    const frame = document.querySelector<HTMLElement>(".app-shell");
    const resize = () => {
      if (frame && viewport)
        frame.style.setProperty(
          "--chat-viewport-height",
          `${viewport.height}px`,
        );
    };
    resize();
    viewport?.addEventListener("resize", resize);
    window.addEventListener("resize", resize);
    return () => {
      viewport?.removeEventListener("resize", resize);
      window.removeEventListener("resize", resize);
      frame?.style.removeProperty("--chat-viewport-height");
    };
  }, []);
  const changed = useCallback((id: string, thread: Thread) => {
    cache.current.set(id, thread);
    setThreads(new Map(cache.current));
  }, []);
  const savePosition = useCallback(
    (id: string, position: ThreadPosition) => {
      setPositions((old) => new Map(old).set(id, position));
      remember?.(id, cache.current.get(id), position);
    },
    [remember],
  );
  const selectedThread = threads.get(selected);
  function closeNewChat() {
    setNewChat(false);
    if (params.get("new") === "1")
      router.replace(selected ? `/chats?conversation=${selected}` : "/chats", {
        scroll: false,
      });
  }
  async function moreChats() {
    if (!list?.nextCursor || listPending) return;
    setListPending(true);
    try {
      const page = await directRequest<ConversationList>("direct/list", {
        before: list.nextCursor,
      });
      setList((old) =>
        old
          ? {
              ...page,
              conversations: [
                ...old.conversations,
                ...page.conversations.filter(
                  (c) =>
                    !old.conversations.some((existing) => existing.id === c.id),
                ),
              ],
            }
          : page,
      );
    } catch (error) {
      setListError(directError(error));
      unauthorized(error);
    } finally {
      setListPending(false);
    }
  }
  return (
    <div
      className="direct-workspace"
      data-thread-open={!!selected}
      data-conversation-open={!!selected}
    >
      <section className="direct-list" aria-label="Chats context">
        <header className="direct-list-heading">
          <div>
            <h1>
              Chats{" "}
              {list && list.unreadConversations > 0 && (
                <Badge count={list.unreadConversations} />
              )}
            </h1>
          </div>
          <IconButton
            label="Find people"
            icon={Search}
            onClick={() => setNewChat(true)}
          />
        </header>
        <div className="direct-connection" role="status">
          <span data-live={connection === "live"} />
          {connection === "live"
            ? "Live"
            : connection === "connecting"
              ? "Connecting…"
              : connection === "reconnecting"
                ? "Reconnecting…"
                : "Live updates unavailable"}
          {connection !== "live" && (
            <button
              type="button"
              onClick={() => {
                setAttempt((v) => v + 1);
                void refresh();
              }}
              aria-label="Reconnect live updates"
            >
              <RefreshCw size={14} />
            </button>
          )}
        </div>
        <div className="direct-list-scroll">
          {params.get("notice") === "unavailable" && (
            <p role="alert" className="direct-feedback">
              Group unavailable.
            </p>
          )}
          <GroupInboxEntries revision={groupRevision} />
          {!list && !listError && (
            <div className="direct-loading" role="status">
              <Skeleton />
              <Skeleton />
              <span>Loading chats…</span>
            </div>
          )}
          {listError && (
            <div className="direct-feedback" role="alert">
              {listError}
              <Button onClick={() => void refresh()}>Retry</Button>
            </div>
          )}
          {list?.conversations.length === 0 && (
            <div className="direct-empty">
              <MessageSquarePlus
                size={36}
                strokeWidth={1.5}
                aria-hidden="true"
              />
              <h2>Your people. Right here.</h2>
              <Button variant="primary" onClick={() => setNewChat(true)}>
                New chat
              </Button>
            </div>
          )}
          {list?.conversations.map((c) => (
            <Link
              key={c.id}
              href={`/chats?conversation=${c.id}`}
              scroll={false}
              className="direct-list-item"
              aria-current={selected === c.id ? "true" : undefined}
            >
              <Avatar
                name={c.peer.displayName ?? c.peer.username ?? "Person"}
                src={c.peer.avatarRef ?? undefined}
              />
              <span className="direct-list-copy">
                <span className="direct-list-line">
                  <strong>{c.peer.displayName ?? c.peer.username}</strong>
                  <time dateTime={c.activityAt}>{time(c.activityAt)}</time>
                </span>
                <span className="direct-list-line">
                  <span className="direct-preview">
                    {c.latestMessage
                      ? `${c.latestMessage.senderId === userId ? "You: " : ""}${c.latestMessage.text}`
                      : `@${c.peer.username}`}
                  </span>
                  <Badge count={c.unreadCount} />
                </span>
              </span>
            </Link>
          ))}
          {list?.nextCursor && (
            <Button
              className="direct-more"
              loading={listPending}
              onClick={() => void moreChats()}
            >
              More chats
            </Button>
          )}
        </div>
      </section>
      {selected ? (
        <ThreadView
          key={selected}
          id={selected}
          userId={userId}
          thread={selectedThread}
          position={positions.get(selected)}
          savePosition={savePosition}
          changed={changed}
          refresh={refreshEvent}
          unauthorized={unauthorized}
          connection={connection}
          networkError={listError}
        />
      ) : (
        <section className="direct-idle" aria-label="Chats overview">
          <MessageSquarePlus size={44} strokeWidth={1.5} aria-hidden="true" />
          <h2>Pick up the conversation.</h2>
          <Button onClick={() => setNewChat(true)}>New chat</Button>
        </section>
      )}
      {newChat && (
        <NewChat
          close={closeNewChat}
          open={(conversation) => {
            setNewChat(false);
            void refresh();
            if (params.get("new") === "1")
              router.replace(`/chats?conversation=${conversation.id}`, {
                scroll: false,
              });
            else
              router.push(`/chats?conversation=${conversation.id}`, {
                scroll: false,
              });
          }}
          unauthorized={unauthorized}
        />
      )}
    </div>
  );
}

function NewChat({
  close,
  open,
  unauthorized,
}: {
  close: () => void;
  open: (conversation: DirectConversationView) => void;
  unauthorized: (error: unknown) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [username, setUsername] = useState("");
  const [person, setPerson] = useState<{
    id: string;
    displayName: string | null;
    username: string | null;
  } | null>(null);
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
      const value = await directRequest<{ person: typeof person }>(
        "people/find",
        { username },
      );
      setPerson(value.person);
    } catch (error) {
      setError(directError(error));
      unauthorized(error);
    } finally {
      setPending(false);
    }
  }
  async function start() {
    if (pending || !person?.username) return;
    setPending(true);
    setError("");
    try {
      open(
        (
          await directRequest<{ conversation: DirectConversationView }>(
            "direct/open",
            { username: person.username },
          )
        ).conversation,
      );
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
      aria-labelledby="direct-new-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClose={close}
    >
      <div className="direct-dialog-heading">
        <h2 id="direct-new-title">New chat</h2>
        <IconButton label="Close new chat" icon={X} onClick={close} />
      </div>
      <Link href="/groups?new=1" className="group-create-link">
        Create group
      </Link>
      <form method="post" onSubmit={find}>
        <label htmlFor="direct-username">Username</label>
        <div className="direct-find">
          <span aria-hidden="true">@</span>
          <input
            id="direct-username"
            name="username"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            required
            maxLength={30}
            pattern="[A-Za-z][A-Za-z0-9_]{2,29}"
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
              setPerson(null);
              setError("");
            }}
            disabled={pending}
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
            onClick={() => void start()}
          >
            Chat
          </Button>
        </div>
      )}
    </dialog>
  );
}

function ThreadView({
  id,
  userId,
  thread,
  position,
  savePosition,
  changed,
  refresh,
  unauthorized,
  connection,
  networkError,
}: {
  id: string;
  userId: string;
  thread: Thread | undefined;
  position: ThreadPosition | undefined;
  savePosition: (id: string, position: ThreadPosition) => void;
  changed: (id: string, thread: Thread) => void;
  refresh: () => void;
  unauthorized: (error: unknown) => void;
  connection: string;
  networkError: string;
}) {
  const [error, setError] = useState("");
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [receiptError, setReceiptError] = useState("");
  const [draft, setDraft] = useState(position?.draft ?? "");
  const [pending, setPending] = useState<Pending[]>(
    () =>
      position?.pending.map((p) => ({
        ...p,
        state: "failed",
        error: "Check connection and retry.",
      })) ?? [],
  );
  const [atBottom, setAtBottom] = useState(position?.bottom ?? true);
  const [seenSequence, setSeenSequence] = useState(thread?.syncedSequence ?? 0);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(position?.bottom ?? true);
  const restoreTop = useRef(position?.top);
  const prepend = useRef<{ height: number; top: number } | null>(null);
  const receipts = useRef({ delivered: 0, read: 0 });
  const latest = useRef(thread);
  const mounted = useRef(true);
  const composer = useRef<HTMLTextAreaElement>(null);
  const saved = useRef<ThreadPosition>({
    top: position?.top ?? 0,
    bottom: position?.bottom ?? true,
    draft,
    pending,
  });
  useLayoutEffect(() => {
    saved.current = { ...saved.current, draft, pending };
    latest.current = thread;
  }, [draft, pending, thread]);
  useLayoutEffect(() => {
    // Parent mobile visibility can change before unmount; preserve the last visible offset.
    return () =>
      savePosition(id, { ...saved.current, bottom: nearBottom.current });
  }, [id, savePosition]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const apply = useCallback(
    (value: Thread) => {
      latest.current = value;
      changed(id, value);
    },
    [id, changed],
  );
  useEffect(() => {
    const controller = new AbortController();
    const current = latest.current;
    directRequest<MessagePage>(
      "direct/messages",
      {
        conversationId: id,
        ...(current ? { after: current.syncedSequence } : {}),
      },
      controller.signal,
    )
      .then((page) => {
        if (!controller.signal.aborted) {
          apply({
            conversation: page.conversation,
            messages: mergeMessages(
              latest.current?.messages ?? [],
              page.messages,
            ),
            syncedSequence: Math.max(
              latest.current?.syncedSequence ?? 0,
              page.messages.at(-1)?.sequence ?? 0,
            ),
            hasOlder: latest.current?.hasOlder ?? page.hasMore,
          });
          setError("");
          refresh();
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setError(directError(error));
          unauthorized(error);
        }
      });
    return () => controller.abort();
  }, [id, loadAttempt, apply, refresh, unauthorized]);
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    if (restoreTop.current !== undefined && latest.current) {
      element.scrollTop = restoreTop.current;
      restoreTop.current = undefined;
    } else if (prepend.current) {
      element.scrollTop =
        prepend.current.top + element.scrollHeight - prepend.current.height;
      saved.current = {
        ...saved.current,
        top: element.scrollTop,
        bottom: false,
      };
      prepend.current = null;
    } else if (nearBottom.current) element.scrollTop = element.scrollHeight;
  }, [thread?.messages, pending]);
  const acknowledge = useCallback(() => {
    const current = latest.current;
    const element = scroller.current;
    if (
      !current ||
      !element ||
      document.visibilityState !== "visible" ||
      !document.hasFocus()
    )
      return;
    const last = current.syncedSequence;
    // Read only when the newest loaded message is actually in view at the bottom.
    const read = nearBottom.current ? last : receipts.current.read;
    if (last <= receipts.current.delivered && read <= receipts.current.read)
      return;
    receipts.current = {
      delivered: Math.max(last, receipts.current.delivered),
      read: Math.max(read, receipts.current.read),
    };
    void directRequest<{ conversation: DirectConversationView }>(
      "direct/receipt",
      {
        conversationId: id,
        deliveredSequence: receipts.current.delivered,
        ...(read > 0 ? { readSequence: receipts.current.read } : {}),
      },
    )
      .then((result) => {
        if (!mounted.current || !latest.current) return;
        setReceiptError("");
        const value = { ...latest.current, conversation: result.conversation };
        apply(value);
        refresh();
      })
      .catch((error) => {
        receipts.current = { delivered: 0, read: 0 };
        if (mounted.current) {
          setReceiptError(directError(error));
          unauthorized(error);
        }
      });
  }, [id, apply, refresh, unauthorized]);
  useEffect(() => {
    acknowledge();
    window.addEventListener("focus", acknowledge);
    document.addEventListener("visibilitychange", acknowledge);
    return () => {
      window.removeEventListener("focus", acknowledge);
      document.removeEventListener("visibilitychange", acknowledge);
    };
  }, [thread?.messages, acknowledge]);
  async function older() {
    if (loadingOlder || !latest.current) return;
    setLoadingOlder(true);
    setError("");
    try {
      const page = await directRequest<MessagePage>("direct/messages", {
        conversationId: id,
        before: latest.current.messages[0]?.sequence,
      });
      if (!mounted.current || !latest.current) return;
      const element = scroller.current;
      if (element)
        prepend.current = {
          height: element.scrollHeight,
          top: element.scrollTop,
        };
      apply({
        ...latest.current,
        messages: mergeMessages(latest.current.messages, page.messages),
        hasOlder: page.hasMore,
      });
    } catch (error) {
      if (mounted.current) {
        setError(directError(error));
        unauthorized(error);
      }
    } finally {
      if (mounted.current) setLoadingOlder(false);
    }
  }
  async function submit(item: Pending) {
    setPending((items) => [
      ...items.filter((p) => p.clientId !== item.clientId),
      { ...item, state: "sending" },
    ]);
    try {
      const { message } = await directRequest<{ message: DirectMessageView }>(
        "direct/send",
        { conversationId: id, clientId: item.clientId, text: item.text },
      );
      if (!mounted.current) return;
      setPending((items) => items.filter((p) => p.clientId !== item.clientId));
      if (latest.current)
        apply({
          ...latest.current,
          messages: mergeMessages(latest.current.messages, [message]),
        });
      refresh();
    } catch (error) {
      if (mounted.current) {
        setPending((items) =>
          items.map((p) =>
            p.clientId === item.clientId
              ? { ...p, state: "failed", error: directError(error) }
              : p,
          ),
        );
        unauthorized(error);
      }
    }
  }
  function send(event: FormEvent) {
    event.preventDefault();
    if (
      thread?.conversation.canSend === false ||
      !draft.trim() ||
      pending.some((p) => p.state === "sending")
    )
      return;
    const item: Pending = {
      clientId: crypto.randomUUID(),
      text: draft.trim(),
      state: "sending",
    };
    setDraft("");
    nearBottom.current = true;
    setAtBottom(true);
    void submit(item);
    composer.current?.focus();
  }
  const peer = thread?.conversation.peer;
  return (
    <section className="direct-thread" aria-label="Conversation">
      <header className="direct-thread-heading">
        {thread && (
          <ConversationFeatures
            scope={{ kind: "DM", id: thread.conversation.id }}
            userId={userId}
          />
        )}
        <Link
          href="/chats"
          scroll={false}
          className="icon-link direct-back"
          aria-label="Back to Chats"
        >
          <ArrowLeft size={22} />
        </Link>
        {peer && (
          <ProfilePreview
            userId={peer.id}
            name={peer.displayName ?? peer.username ?? "Person"}
            avatarRef={peer.avatarRef}
          />
        )}
        <div>
          <h2>{peer?.displayName ?? peer?.username ?? "Conversation"}</h2>
          {peer && <p>@{peer.username}</p>}
        </div>
        {peer && (
          <UserSafetyActions
            userId={peer.id}
            blocked={thread?.conversation.blockedByYou ?? false}
            changed={refresh}
          />
        )}
        <span className="direct-thread-connection" role="status">
          {connection === "live"
            ? "Live"
            : connection === "unavailable"
              ? "Live unavailable"
              : "Connecting…"}
        </span>
      </header>
      {networkError && (
        <div className="direct-feedback" role="alert">
          {networkError}
          <Button onClick={refresh}>Retry connection</Button>
        </div>
      )}
      {(error || receiptError) && (
        <div className="direct-feedback" role="alert">
          {error || receiptError}
          <Button onClick={() => setLoadAttempt((v) => v + 1)}>Retry</Button>
        </div>
      )}
      <div
        ref={scroller}
        className="direct-messages"
        aria-label="Message history"
        tabIndex={0}
        onScroll={() => {
          const element = scroller.current!;
          const bottom =
            element.scrollHeight - element.scrollTop - element.clientHeight <
            48;
          if (nearBottom.current)
            setSeenSequence(latest.current?.syncedSequence ?? 0);
          nearBottom.current = bottom;
          setAtBottom(bottom);
          saved.current = { ...saved.current, top: element.scrollTop, bottom };
          if (bottom) acknowledge();
        }}
      >
        {!thread && !error && (
          <div className="direct-loading" role="status">
            <Skeleton />
            <span>Loading messages…</span>
          </div>
        )}
        {thread?.hasOlder && (
          <Button
            className="direct-more"
            loading={loadingOlder}
            onClick={() => void older()}
          >
            Load older messages
          </Button>
        )}
        {thread && thread.messages.length === 0 && (
          <p className="direct-first">Say hello.</p>
        )}
        {thread?.messages.map((message) => {
          const own = message.senderId === userId;
          const c = thread.conversation;
          const status =
            message.sequence <= c.peerReadSequence
              ? "Read"
              : message.sequence <= c.peerDeliveredSequence
                ? "Delivered"
                : "Sent";
          return (
            <article
              key={message.id}
              className="direct-message"
              data-own={own}
              data-message-id={message.id}
              data-sequence={message.sequence}
              aria-label={`${own ? "You" : (peer?.displayName ?? peer?.username)}, ${stamp(message.createdAt)}`}
            >
              {message.feature ? (
                <FeatureCard reference={message.feature} userId={userId} />
              ) : (
                <p>{message.text}</p>
              )}
              <footer>
                <time
                  dateTime={message.createdAt}
                  title={stamp(message.createdAt)}
                >
                  {stamp(message.createdAt)}
                </time>
                {own && (
                  <span
                    className="direct-delivery"
                    data-read={status === "Read"}
                    aria-label={status}
                  >
                    {status === "Sent" ? (
                      <Check size={14} />
                    ) : (
                      <CheckCheck size={14} />
                    )}
                    <span>{status}</span>
                  </span>
                )}
              </footer>
            </article>
          );
        })}
        {pending
          .filter(
            (item) =>
              !thread?.messages.some(
                (m) => m.senderId === userId && m.clientId === item.clientId,
              ),
          )
          .map((item) => (
            <article
              key={item.clientId}
              className="direct-message"
              data-own="true"
              data-pending={item.state}
            >
              <p>{item.text}</p>
              {item.state === "sending" ? (
                <footer role="status">Sending…</footer>
              ) : (
                <footer>
                  <span role="alert">{item.error}</span>
                  <button type="button" onClick={() => void submit(item)}>
                    Retry message
                  </button>
                </footer>
              )}
            </article>
          ))}
      </div>
      {!atBottom && (thread?.syncedSequence ?? 0) > seenSequence && (
        <button
          type="button"
          className="direct-new-messages"
          onClick={() => {
            const element = scroller.current;
            nearBottom.current = true;
            setAtBottom(true);
            if (element) element.scrollTop = element.scrollHeight;
            acknowledge();
          }}
        >
          New messages <ArrowDown size={16} />
        </button>
      )}
      {thread && /^@(calendar|event)\b/i.test(draft.trim()) && (
        <Button
          className="calendar-command"
          onClick={() => {
            window.dispatchEvent(
              new CustomEvent("merkat:calendar-command", {
                detail: JSON.stringify({
                  kind: "DM",
                  id: thread.conversation.id,
                }),
              }),
            );
            setDraft("");
          }}
        >
          Open conversation plans · create, share or view
        </Button>
      )}
      <form className="direct-composer" method="post" onSubmit={send}>
        <label className="visually-hidden" htmlFor="direct-message">
          Message
        </label>
        <textarea
          ref={composer}
          id="direct-message"
          name="message"
          placeholder="Message…"
          rows={1}
          maxLength={MESSAGE_MAX_LENGTH}
          value={draft}
          disabled={!thread || thread.conversation.canSend === false}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing &&
              !matchMedia("(pointer: coarse)").matches
            ) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <Button
          variant="primary"
          type="submit"
          aria-label="Send message"
          disabled={
            !thread ||
            thread.conversation.canSend === false ||
            !draft.trim() ||
            pending.some((p) => p.state === "sending")
          }
        >
          <Send size={20} aria-hidden="true" />
        </Button>
      </form>
    </section>
  );
}
