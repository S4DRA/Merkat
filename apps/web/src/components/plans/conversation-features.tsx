"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarDays, Plus, Receipt, X } from "lucide-react";
import type {
  CalendarEventView,
  ChatScope,
  FeatureReference,
  TabView,
} from "@merkat/contracts";
import { Button, IconButton } from "../ui/primitives";
import { directRequest, directError } from "../../lib/direct-client";
import { EventDetail, EventForm } from "./calendar-workspace";
import { TabCreate, TabDetail, money } from "./tab-workspace";
type TabList = {
  id: string;
  title: string;
  closedAt: string | null;
  currency: string;
}[];
export function ConversationFeatures({
  scope,
  userId,
}: {
  scope: ChatScope;
  userId: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    serialized = JSON.stringify(scope);
  const [mode, setMode] = useState<
      "list" | "event-new" | "tab-new" | "event" | "tab" | "event-share"
    >("list"),
    [selected, setSelected] = useState("");
  const [events, setEvents] = useState<CalendarEventView[]>([]),
    [tabs, setTabs] = useState<TabList>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const [shareEvents, setShareEvents] = useState<CalendarEventView[]>([]),
    [sharing, setSharing] = useState(false);
  const shareKeys = useRef(new Map<string, string>());
  async function chooseShare() {
    setMode("event-share");
    setLoading(true);
    setError("");
    try {
      const now = Date.now(),
        result = await directRequest<{ events: CalendarEventView[] }>(
          "calendar/list",
          {
            start: new Date(now - 30 * 86400000).toISOString(),
            end: new Date(now + 335 * 86400000).toISOString(),
          },
        );
      setShareEvents(
        result.events.filter(
          (e) =>
            e.ownerId === userId &&
            !e.cancelled &&
            (!e.scope || JSON.stringify(e.scope) === serialized),
        ),
      );
    } catch (error) {
      setError(directError(error));
    } finally {
      setLoading(false);
    }
  }
  async function share(id: string) {
    if (sharing) return;
    setSharing(true);
    setError("");
    const key = shareKeys.current.get(id) ?? crypto.randomUUID();
    shareKeys.current.set(id, key);
    try {
      const result = await directRequest<{ event: CalendarEventView }>(
        "calendar/share",
        { id, clientId: key, scope },
      );
      window.dispatchEvent(new Event("merkat:feature-change"));
      show("event", result.event.id);
    } catch (error) {
      setError(directError(error));
    } finally {
      setSharing(false);
    }
  }
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [e, t] = await Promise.all([
        directRequest<{ events: CalendarEventView[] }>(
          "calendar/conversation",
          JSON.parse(serialized),
        ),
        directRequest<{ tabs: TabList }>("tabs/list", JSON.parse(serialized)),
      ]);
      setEvents(e.events);
      setTabs(t.tabs);
    } catch (error) {
      setError(directError(error));
    } finally {
      setLoading(false);
    }
  }, [serialized]);
  useEffect(() => {
    const command = (event: Event) => {
      if ((event as CustomEvent<string>).detail === serialized) {
        setMode("list");
        dialog.current?.showModal();
        void load();
      }
    };
    window.addEventListener("merkat:calendar-command", command);
    return () => window.removeEventListener("merkat:calendar-command", command);
  }, [serialized, load]);
  function show(mode: "event" | "tab", id: string) {
    setSelected(id);
    setMode(mode);
  }
  return (
    <>
      <Button
        className="conversation-tools"
        aria-label="Conversation plans and tabs"
        onClick={() => {
          setMode("list");
          dialog.current?.showModal();
          void load();
        }}
      >
        <CalendarDays size={18} />
        <span>Plans & tabs</span>
      </Button>
      <dialog
        ref={dialog}
        className="feature-dialog"
        aria-label="Conversation plans and tabs"
      >
        <div className="direct-dialog-heading">
          <strong>
            {mode === "list"
              ? "Together, beyond the chat"
              : "Conversation activity"}
          </strong>
          <IconButton
            icon={X}
            label="Close conversation tools"
            onClick={() => dialog.current?.close()}
          />
        </div>
        {mode !== "list" && (
          <Button
            variant="quiet"
            onClick={() => {
              setMode("list");
              void load();
            }}
          >
            ← All conversation plans & tabs
          </Button>
        )}
        {mode === "list" && (
          <div className="conversation-feature-list">
            <div className="feature-actions">
              <Button variant="primary" onClick={() => setMode("event-new")}>
                <Plus size={16} />
                Make a plan
              </Button>
              <Button onClick={() => setMode("tab-new")}>
                <Receipt size={16} />
                Open a tab
              </Button>
              <Button onClick={() => void chooseShare()}>
                Share a calendar plan
              </Button>
            </div>
            <p className="supporting-copy">
              Plans can be added to your calendar. Spending tabs stay in this
              conversation.
            </p>
            {loading && <p role="status">Loading activities…</p>}
            {error && <p role="alert">{error}</p>}
            <section>
              <h3>Conversation plans</h3>
              {!loading && !events.length && (
                <p className="supporting-copy">Nothing planned yet.</p>
              )}
              {events.map((e) => (
                <button
                  key={e.id}
                  className="feature-list-row"
                  type="button"
                  onClick={() => show("event", e.id)}
                >
                  <CalendarDays size={20} />
                  <span>
                    <strong>{e.title}</strong>
                    <small>
                      {new Date(e.startsAt).toLocaleString()} ·{" "}
                      {e.cancelled
                        ? "Cancelled"
                        : `${e.participants.filter((p) => p.response === "GOING").length} going`}
                    </small>
                  </span>
                </button>
              ))}
            </section>
            <section>
              <h3>Spending tabs</h3>
              {!loading && !tabs.length && (
                <p className="supporting-copy">
                  Open a tab for your next meal, drinks or shared stop.
                </p>
              )}
              {tabs.map((t) => (
                <button
                  key={t.id}
                  className="feature-list-row"
                  type="button"
                  onClick={() => show("tab", t.id)}
                >
                  <Receipt size={20} />
                  <span>
                    <strong>{t.title}</strong>
                    <small>
                      {t.closedAt ? "Closed · saved summary" : "Open session"} ·{" "}
                      {t.currency}
                    </small>
                  </span>
                </button>
              ))}
            </section>
          </div>
        )}
        {mode === "event-share" && (
          <section>
            <h2>Share a calendar plan</h2>
            <p className="supporting-copy">
              Choose one of your personal plans or a plan already in this
              conversation.
            </p>
            {loading && <p role="status">Loading plans…</p>}
            {error && <p role="alert">{error}</p>}
            {!loading && !shareEvents.length && (
              <p>No eligible plans yet. Make a plan first.</p>
            )}
            {shareEvents.map((e) => (
              <button
                key={e.id}
                type="button"
                className="feature-list-row"
                disabled={sharing}
                onClick={() => void share(e.id)}
              >
                <CalendarDays size={18} />
                <span>
                  <strong>{e.title}</strong>
                  <small>{new Date(e.startsAt).toLocaleString()}</small>
                </span>
              </button>
            ))}
          </section>
        )}
        {mode === "event-new" && (
          <EventForm
            scope={scope}
            onSaved={(e) => show("event", e.id)}
            onCancel={() => setMode("list")}
          />
        )}
        {mode === "tab-new" && (
          <TabCreate
            scope={scope}
            onSaved={(t) => show("tab", t.id)}
            onCancel={() => setMode("list")}
          />
        )}
        {mode === "event" && <EventDetail eventId={selected} userId={userId} />}{" "}
        {mode === "tab" && <TabDetail tabId={selected} userId={userId} />}
      </dialog>
    </>
  );
}
export function FeatureCard({
  reference,
  userId,
}: {
  reference: FeatureReference;
  userId: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    [event, setEvent] = useState<CalendarEventView | null>(null),
    [tab, setTab] = useState<TabView | null>(null),
    [error, setError] = useState("");
  const { kind, id } = reference;
  const load = useCallback(async () => {
    try {
      if (kind === "EVENT") {
        const r = await directRequest<{ event: CalendarEventView }>(
          "calendar/detail",
          { id },
        );
        setEvent(r.event);
      } else {
        const r = await directRequest<{ tab: TabView }>("tabs/detail", { id });
        setTab(r.tab);
      }
      setError("");
    } catch (error) {
      setError(directError(error));
      setEvent(null);
      setTab(null);
    }
  }, [kind, id]);
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
  return (
    <>
      <button
        type="button"
        className="chat-feature-card"
        onClick={() => {
          if (error) {
            void load();
            return;
          }
          dialog.current?.showModal();
        }}
      >
        <span className="feature-card-kind">
          {kind === "EVENT" ? (
            <CalendarDays size={18} />
          ) : (
            <Receipt size={18} />
          )}{" "}
          {kind === "EVENT" ? "A PLAN TOGETHER" : "THE TAB"}
        </span>
        <strong>
          {event?.title ??
            tab?.title ??
            (error ? "Activity unavailable" : "Loading activity…")}
        </strong>
        {event && (
          <>
            <span>{new Date(event.startsAt).toLocaleString()}</span>
            {event.location && <small>{event.location}</small>}
            <span>
              {event.cancelled
                ? "Cancelled"
                : `${event.participants.filter((p) => p.response === "GOING").length} going · View plan`}
            </span>
          </>
        )}
        {tab && (
          <>
            <span>
              {tab.state.participants.length} people ·{" "}
              {money(tab.summary.total, tab.currency)}
            </span>
            <span>
              {tab.closedAt
                ? "Closed · View saved summary"
                : "Open · Add an order"}
            </span>
          </>
        )}
        {error && <small>{error} Tap to retry.</small>}
      </button>
      <dialog
        ref={dialog}
        className="feature-dialog"
        aria-label={kind === "EVENT" ? "Plan details" : "Tab details"}
      >
        <div className="direct-dialog-heading">
          <strong>{kind === "EVENT" ? "Plan details" : "Spending tab"}</strong>
          <IconButton
            icon={X}
            label="Close activity"
            onClick={() => dialog.current?.close()}
          />
        </div>
        {kind === "EVENT" ? (
          <EventDetail eventId={id} userId={userId} />
        ) : (
          <TabDetail tabId={id} userId={userId} />
        )}
      </dialog>
    </>
  );
}
