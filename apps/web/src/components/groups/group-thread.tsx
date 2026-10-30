"use client";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ArrowLeft,
  ArrowDown,
  ChevronDown,
  Settings,
  Reply,
  Send,
  X,
} from "lucide-react";
import type {
  GroupDetail,
  GroupChannelView,
  GroupMessageView,
  GroupMessagePage,
} from "@merkat/contracts";
import { MESSAGE_MAX_LENGTH } from "@merkat/contracts";
import { Button, IconButton } from "../ui/primitives";
import {
  directRequest,
  directError,
  DirectRequestError,
  mergeMessages,
} from "../../lib/direct-client";
type Pending = {
  clientId: string;
  text: string;
  replyToId?: string;
  state: "sending" | "failed";
  error?: string | undefined;
};
export type GroupThreadData = {
  messages: GroupMessageView[];
  hasOlder: boolean;
  syncedSequence: number;
};
export type GroupPosition = {
  draft: string;
  pending: Pending[];
  reply: GroupMessageView | null;
  top: number;
  bottom: boolean;
};
type Props = {
  userId: string;
  group: GroupDetail;
  channel: GroupChannelView;
  base: string;
  connection: string;
  revision: number;
  cached: GroupThreadData | undefined;
  position: GroupPosition | undefined;
  remember: (
    id: string,
    data: GroupThreadData,
    position: GroupPosition,
  ) => void;
  updated: (g: GroupDetail) => void;
  refresh: () => void;
  unavailable: () => void;
  openChannels: () => void;
  openSettings: () => void;
  unauthorized: (e: unknown) => void;
};
const stamp = (date: string) =>
  new Date(date).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
export function GroupThread({
  userId,
  group,
  channel,
  base,
  connection,
  revision,
  cached,
  position,
  remember,
  updated,
  refresh,
  unavailable,
  openChannels,
  openSettings,
  unauthorized,
}: Props) {
  const groupId = group.id,
    channelId = channel.id;
  const [data, setData] = useState<GroupThreadData | null>(cached ?? null),
    [draft, setDraft] = useState(position?.draft ?? ""),
    [pending, setPending] = useState<Pending[]>(
      () =>
        position?.pending.map((p) => ({
          ...p,
          state: "failed",
          error: "Check connection and retry.",
        })) ?? [],
    ),
    [reply, setReply] = useState<GroupMessageView | null>(
      position?.reply ?? null,
    ),
    [error, setError] = useState(""),
    [receiptError, setReceiptError] = useState(""),
    [olderPending, setOlderPending] = useState(false),
    [attempt, setAttempt] = useState(0),
    [atBottom, setAtBottom] = useState(position?.bottom ?? true),
    [seenSequence, setSeenSequence] = useState(cached?.syncedSequence ?? 0);
  const scroller = useRef<HTMLDivElement>(null),
    composer = useRef<HTMLTextAreaElement>(null),
    live = useRef(data),
    alive = useRef(true),
    busy = useRef(false),
    queued = useRef(false),
    nearBottom = useRef(position?.bottom ?? true),
    restore = useRef(position?.top),
    prepend = useRef<{ height: number; top: number } | null>(null),
    receipts = useRef({ delivered: 0, read: 0 }),
    receiptBusy = useRef(false);
  const saved = useRef<GroupPosition>({
    draft,
    pending,
    reply,
    top: position?.top ?? 0,
    bottom: position?.bottom ?? true,
  });
  const apply = useCallback((value: GroupThreadData) => {
    live.current = value;
    setData(value);
  }, []);
  useLayoutEffect(() => {
    saved.current = { ...saved.current, draft, pending, reply };
  }, [draft, pending, reply]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (live.current)
        remember(channelId, live.current, {
          ...saved.current,
          bottom: nearBottom.current,
        });
    };
  }, [channelId, remember]);
  const reconcile = useCallback(async () => {
    if (busy.current) {
      queued.current = true;
      return;
    }
    busy.current = true;
    try {
      do {
        queued.current = false;
        const initial = live.current;
        let after = initial?.syncedSequence,
          through: number | undefined;
        while (true) {
          const page = await directRequest<GroupMessagePage>(
            "groups/messages",
            {
              groupId,
              channelId,
              ...(after !== undefined ? { after } : {}),
              ...(through !== undefined ? { through } : {}),
            },
          );
          if (!alive.current) return;
          through = page.through;
          const current = live.current;
          const merged = mergeMessages(current?.messages ?? [], page.messages);
          apply({
            messages: merged,
            hasOlder: current?.hasOlder ?? page.hasMore,
            syncedSequence: Math.max(
              current?.syncedSequence ?? 0,
              page.messages.at(-1)?.sequence ?? 0,
            ),
          });
          updated(page.group);
          setError("");
          const next = page.messages.at(-1)?.sequence;
          if (
            after === undefined ||
            !page.hasMore ||
            next === undefined ||
            next <= after
          )
            break;
          after = next;
        }
      } while (queued.current);
    } catch (e) {
      if (!alive.current) return;
      setError(directError(e));
      unauthorized(e);
      if (e instanceof DirectRequestError && e.code === "NOT_FOUND") {
        live.current = null;
        setData(null);
        unavailable();
      }
    } finally {
      busy.current = false;
    }
  }, [groupId, channelId, apply, updated, unavailable, unauthorized]);
  useEffect(() => {
    void reconcile();
  }, [reconcile, revision, attempt]);
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element || !data) return;
    if (restore.current !== undefined) {
      element.scrollTop = restore.current;
      restore.current = undefined;
    } else if (prepend.current) {
      element.scrollTop =
        prepend.current.top + element.scrollHeight - prepend.current.height;
      prepend.current = null;
    } else if (nearBottom.current) element.scrollTop = element.scrollHeight;
  }, [data, pending]);
  useLayoutEffect(() => {
    if (composer.current) {
      composer.current.style.height = "auto";
      composer.current.style.height = `${Math.min(composer.current.scrollHeight, 160)}px`;
    }
  }, [draft]);
  const acknowledge = useCallback(
    function acknowledgeReceipt() {
      const current = live.current;
      if (
        !current ||
        !scroller.current ||
        receiptBusy.current ||
        document.visibilityState !== "visible" ||
        !document.hasFocus()
      )
        return;
      const delivered = current.syncedSequence,
        read = nearBottom.current ? delivered : receipts.current.read;
      if (
        delivered <= receipts.current.delivered &&
        read <= receipts.current.read
      )
        return;
      receiptBusy.current = true;
      let succeeded = false;
      void directRequest<GroupDetail>("groups/receipt", {
        groupId,
        channelId,
        deliveredSequence: delivered,
        ...(read > 0 ? { readSequence: read } : {}),
      })
        .then((g) => {
          if (!alive.current) return;
          receipts.current = { delivered, read };
          succeeded = true;
          setReceiptError("");
          updated(g);
        })
        .catch((e) => {
          if (alive.current) {
            setReceiptError(directError(e));
            unauthorized(e);
            if (e instanceof DirectRequestError && e.code === "NOT_FOUND")
              unavailable();
          }
        })
        .finally(() => {
          receiptBusy.current = false;
          // A newer message can arrive while this response is in flight. Drain the
          // latest visible cursor once more, without retry-looping failed requests.
          if (succeeded)
            queueMicrotask(() => {
              if (alive.current) acknowledgeReceipt();
            });
        });
    },
    [groupId, channelId, updated, unauthorized, unavailable],
  );
  useEffect(() => {
    acknowledge();
  }, [data, atBottom, acknowledge]);
  useEffect(() => {
    const wake = () => {
      if (document.visibilityState === "visible") {
        void reconcile();
        acknowledge();
      }
    };
    window.addEventListener("focus", wake);
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", wake);
    return () => {
      window.removeEventListener("focus", wake);
      window.removeEventListener("online", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [reconcile, acknowledge]);
  async function older() {
    const current = live.current,
      element = scroller.current;
    if (!current?.hasOlder || !element || olderPending) return;
    setOlderPending(true);
    setError("");
    try {
      const page = await directRequest<GroupMessagePage>("groups/messages", {
        groupId,
        channelId,
        before: current.messages[0]!.sequence,
      });
      if (!alive.current) return;
      prepend.current = {
        height: element.scrollHeight,
        top: element.scrollTop,
      };
      apply({
        ...live.current!,
        messages: mergeMessages(page.messages, live.current?.messages ?? []),
        hasOlder: page.hasMore,
      });
    } catch (e) {
      if (alive.current) {
        setError(directError(e));
        unauthorized(e);
      }
    } finally {
      if (alive.current) setOlderPending(false);
    }
  }
  async function submit(item: Pending) {
    setPending((items) =>
      items.some((p) => p.clientId === item.clientId)
        ? items.map((p) =>
            p.clientId === item.clientId
              ? { ...p, state: "sending", error: undefined }
              : p,
          )
        : [...items, item],
    );
    try {
      const message = await directRequest<GroupMessageView>("groups/send", {
        groupId,
        channelId,
        clientId: item.clientId,
        text: item.text,
        ...(item.replyToId ? { replyToId: item.replyToId } : {}),
      });
      if (!alive.current) return;
      setPending((items) => items.filter((p) => p.clientId !== item.clientId));
      if (live.current)
        apply({
          ...live.current,
          messages: mergeMessages(live.current.messages, [message]),
        });
      refresh();
      void reconcile();
    } catch (e) {
      if (alive.current) {
        setPending((items) =>
          items.map((p) =>
            p.clientId === item.clientId
              ? { ...p, state: "failed", error: directError(e) }
              : p,
          ),
        );
        unauthorized(e);
        if (e instanceof DirectRequestError && e.code === "NOT_FOUND")
          unavailable();
      }
    }
  }
  function send(e: FormEvent) {
    e.preventDefault();
    if (!data || !draft.trim() || pending.some((p) => p.state === "sending"))
      return;
    const item: Pending = {
      clientId: crypto.randomUUID(),
      text: draft.trim(),
      ...(reply ? { replyToId: reply.id } : {}),
      state: "sending",
    };
    setDraft("");
    setReply(null);
    nearBottom.current = true;
    setAtBottom(true);
    void submit(item);
    composer.current?.focus();
  }
  return (
    <section
      className="direct-thread group-thread"
      aria-label="Group conversation"
    >
      <header className="direct-thread-heading">
        <Link
          href={base}
          scroll={false}
          className="icon-link direct-back"
          aria-label={base === "/chats" ? "Back to Chats" : "Back to Groups"}
        >
          <ArrowLeft size={22} />
        </Link>
        <div className="group-thread-title">
          <h2>{group.name}</h2>
          <button
            type="button"
            className="group-channel-switch"
            onClick={openChannels}
            aria-label={`Switch channel: ${channel.name}`}
          >
            #{channel.name}
            <ChevronDown size={16} />
            <span className="group-channel-live" role="status">
              {connection === "live"
                ? "Live"
                : connection === "unavailable"
                  ? "Live unavailable"
                  : "Connecting…"}
            </span>
          </button>
        </div>
        <span className="direct-thread-connection" role="status">
          {connection === "live"
            ? "Live"
            : connection === "unavailable"
              ? "Live unavailable"
              : "Connecting…"}
        </span>
        <IconButton
          label="Group settings"
          icon={Settings}
          onClick={openSettings}
        />
      </header>
      {(error || receiptError) && (
        <div className="direct-feedback" role="alert">
          {error || receiptError}
          <Button
            onClick={() => {
              setAttempt((a) => a + 1);
              acknowledge();
            }}
          >
            Retry
          </Button>
        </div>
      )}
      <div
        ref={scroller}
        className="direct-messages"
        aria-label="Channel message history"
        tabIndex={0}
        onScroll={() => {
          const element = scroller.current!;
          const bottom =
            element.scrollHeight - element.scrollTop - element.clientHeight <
            48;
          if (nearBottom.current)
            setSeenSequence(live.current?.syncedSequence ?? 0);
          nearBottom.current = bottom;
          setAtBottom(bottom);
          saved.current = { ...saved.current, top: element.scrollTop, bottom };
          if (bottom) acknowledge();
        }}
      >
        {!data && !error && <p role="status">Loading messages…</p>}
        {data?.hasOlder && (
          <Button
            className="direct-more"
            loading={olderPending}
            onClick={() => void older()}
          >
            Load older messages
          </Button>
        )}
        {data?.messages.length === 0 && (
          <p className="direct-first">Start the conversation.</p>
        )}
        {data?.messages.map((message) => (
          <article
            key={message.id}
            className="direct-message group-message"
            data-own={message.senderId === userId}
            data-message-id={message.id}
            data-sequence={message.sequence}
          >
            <div className="group-message-author">
              <strong>
                {message.senderId === userId
                  ? "You"
                  : (message.sender.displayName ?? message.sender.username)}
              </strong>
              <button
                type="button"
                aria-label={`Reply to message ${message.sequence}`}
                onClick={() => {
                  setReply(message);
                  composer.current?.focus();
                }}
              >
                <Reply size={16} />
              </button>
            </div>
            {message.replyTo && (
              <blockquote className="group-reply">
                <span>Reply</span>
                <p>{message.replyTo.text}</p>
              </blockquote>
            )}
            <p>{message.text}</p>
            <footer>
              <time dateTime={message.createdAt}>
                {stamp(message.createdAt)}
              </time>
              {message.senderId === userId && <span>Sent</span>}
            </footer>
          </article>
        ))}
        {pending
          .filter(
            (p) =>
              !data?.messages.some(
                (m) => m.senderId === userId && m.clientId === p.clientId,
              ),
          )
          .map((p) => (
            <article
              key={p.clientId}
              className="direct-message"
              data-own="true"
              data-pending={p.state}
            >
              <p>{p.text}</p>
              <footer>
                {p.state === "sending" ? (
                  <span role="status">Sending…</span>
                ) : (
                  <>
                    <span role="alert">{p.error}</span>
                    <button type="button" onClick={() => void submit(p)}>
                      Retry message
                    </button>
                  </>
                )}
              </footer>
            </article>
          ))}
      </div>
      {!atBottom && data && data.syncedSequence > seenSequence && (
        <button
          className="direct-new-messages"
          onClick={() => {
            nearBottom.current = true;
            setAtBottom(true);
            setSeenSequence(data.syncedSequence);
            scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
            acknowledge();
          }}
        >
          <ArrowDown size={16} />
          New messages
        </button>
      )}
      {reply && (
        <div className="group-compose-reply">
          <div>
            <strong>
              Reply to{" "}
              {reply.senderId === userId
                ? "you"
                : (reply.sender.displayName ?? reply.sender.username)}
            </strong>
            <p>{reply.text}</p>
          </div>
          <IconButton
            label="Cancel reply"
            icon={X}
            onClick={() => setReply(null)}
          />
        </div>
      )}
      <form className="direct-composer" onSubmit={send}>
        <textarea
          ref={composer}
          aria-label={`Message ${channel.name}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={MESSAGE_MAX_LENGTH}
          rows={1}
          disabled={!data}
          placeholder={`Message #${channel.name}`}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing &&
              e.nativeEvent.keyCode !== 229 &&
              !matchMedia("(pointer: coarse)").matches
            ) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <Button
          type="submit"
          variant="primary"
          aria-label="Send message"
          disabled={
            !data || !draft.trim() || pending.some((p) => p.state === "sending")
          }
        >
          <Send size={21} />
        </Button>
      </form>
    </section>
  );
}
