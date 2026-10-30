"use client";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";
import { useSearchParams } from "next/navigation";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Download,
  MapPin,
  Plus,
  Search,
  X,
} from "lucide-react";
import {
  calendarFieldsSchema,
  localDateTimeInput,
  zonedDateTimeToIso,
  type CalendarEventView,
  type ChatScope,
} from "@merkat/contracts";
import { Button, IconButton } from "../ui/primitives";
import { directRequest, directError } from "../../lib/direct-client";
export const featureChanged = () =>
  window.dispatchEvent(new Event("merkat:feature-change"));
const dateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const eventDate = (event: CalendarEventView) =>
  new Date(event.startsAt).toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
function exportCalendar(event: CalendarEventView) {
  const escape = (v: string) =>
    v
      .replace(/\\/g, "\\\\")
      .replace(/\r?\n/g, "\\n")
      .replace(/,/g, "\\,")
      .replace(/;/g, "\\;");
  const stamp = (v: string) =>
    new Date(v)
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}/, "");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Merkat//Calendar//EN",
    "BEGIN:VEVENT",
    `UID:${event.id}@merkat`,
    `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${stamp(event.startsAt)}`,
    `DTEND:${stamp(event.endsAt)}`,
    `SUMMARY:${escape(event.title)}`,
    `DESCRIPTION:${escape(event.description)}`,
    `LOCATION:${escape(event.location)}`,
    `STATUS:${event.cancelled ? "CANCELLED" : "CONFIRMED"}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  const url = URL.createObjectURL(
    new Blob([lines.join("\r\n") + "\r\n"], {
      type: "text/calendar;charset=utf-8",
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "merkat-event.ics";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function EventForm({
  scope,
  event,
  onSaved,
  onCancel,
}: {
  scope?: ChatScope | undefined;
  event?: CalendarEventView | undefined;
  onSaved: (event: CalendarEventView) => void;
  onCancel: () => void;
}) {
  const clientId = useRef(crypto.randomUUID()),
    busy = useRef(false);
  const [error, setError] = useState(""),
    [pending, setPending] = useState(false);
  const zone =
    event?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [timezone, setTimezone] = useState(zone);
  const [initial] = useState(() => {
    const date = new Date(Date.now() + 3600000);
    date.setMinutes(0, 0, 0);
    return date;
  });
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy.current) return;
    const form = new FormData(e.currentTarget);
    setError("");
    try {
      const usernames = [
        ...new Set(
          String(form.get("invitees") ?? "")
            .split(/[\s,]+/)
            .map((name) => name.trim().replace(/^@/, "").toLowerCase())
            .filter(Boolean),
        ),
      ];
      if (
        usernames.length > 30 ||
        usernames.some((name) => !/^[a-z][a-z0-9_]{2,29}$/.test(name))
      )
        throw new Error("Enter up to 30 valid usernames, separated by commas.");
      const value = calendarFieldsSchema.parse({
        title: form.get("title"),
        description: form.get("description"),
        location: form.get("location"),
        timezone,
        startsAt: zonedDateTimeToIso(String(form.get("start")), timezone),
        endsAt: zonedDateTimeToIso(String(form.get("end")), timezone),
      });
      busy.current = true;
      setPending(true);
      const result = await directRequest<{ event: CalendarEventView }>(
        event ? "calendar/edit" : "calendar/create",
        event
          ? { id: event.id, version: event.version, event: value }
          : {
              clientId: clientId.current,
              event: value,
              ...(!scope ? { usernames } : {}),
              ...(scope ? { scope } : {}),
            },
      );
      featureChanged();
      onSaved(result.event);
    } catch (error) {
      setError(
        error instanceof Error && !("code" in error)
          ? error.message
          : directError(error),
      );
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <form className="social-form event-form" onSubmit={(e) => void submit(e)}>
      <h2>{event ? "Edit plan" : "Make a plan"}</h2>
      <p className="supporting-copy">
        {scope
          ? "Shared in this conversation. Each person chooses whether to add it to their calendar."
          : "Your calendar, your time. Share a plan in chat when you’re ready."}
      </p>
      <label>
        What’s the plan?
        <input
          name="title"
          placeholder="Saturday night out"
          maxLength={120}
          required
          autoFocus
          defaultValue={event?.title ?? ""}
        />
      </label>
      <div className="form-columns">
        <label>
          Starts
          <input
            name="start"
            type="datetime-local"
            required
            defaultValue={localDateTimeInput(
              event?.startsAt ?? initial.toISOString(),
              zone,
            )}
          />
        </label>
        <label>
          Ends
          <input
            name="end"
            type="datetime-local"
            required
            defaultValue={localDateTimeInput(
              event?.endsAt ??
                new Date(initial.getTime() + 3600000).toISOString(),
              zone,
            )}
          />
        </label>
      </div>
      <label>
        Timezone
        <select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
          {[
            ...new Set([
              timezone,
              "Europe/Istanbul",
              "Europe/London",
              "Europe/Berlin",
              "Asia/Tehran",
              "America/New_York",
              "America/Los_Angeles",
              "Asia/Dubai",
              "UTC",
            ]),
          ].map((z) => (
            <option key={z}>{z}</option>
          ))}
        </select>
      </label>
      <label>
        Where? <span className="supporting-copy">Optional</span>
        <input
          name="location"
          placeholder="A place, address or meeting link"
          maxLength={200}
          defaultValue={event?.location ?? ""}
        />
      </label>
      <label>
        A little detail <span className="supporting-copy">Optional</span>
        <textarea
          name="description"
          maxLength={2000}
          rows={3}
          defaultValue={event?.description ?? ""}
        />
      </label>
      {!event && !scope && (
        <label>
          Invite people (optional)
          <input
            name="invitees"
            maxLength={960}
            placeholder="username, another_username"
            autoCapitalize="none"
            autoCorrect="off"
            aria-describedby="event-invite-help"
          />
          <small id="event-invite-help" className="supporting-copy">
            Enter usernames separated by commas. Each person chooses whether to
            join and add the plan to their calendar.
          </small>
        </label>
      )}
      {error && (
        <p role="alert" className="account-error">
          {error}
        </p>
      )}
      <div className="feature-actions">
        <Button type="submit" variant="primary" loading={pending}>
          {event ? "Save changes" : "Create plan"}
        </Button>
        <Button onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
export function EventDetail({
  eventId,
  userId,
  onChanged,
}: {
  eventId: string;
  userId: string;
  onChanged?: ((event: CalendarEventView) => void) | undefined;
}) {
  const [event, setEvent] = useState<CalendarEventView | null>(null),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false),
    [editing, setEditing] = useState(false),
    [confirmCancel, setConfirmCancel] = useState(false);
  const load = useCallback(async () => {
    try {
      const r = await directRequest<{ event: CalendarEventView }>(
        "calendar/detail",
        { id: eventId },
      );
      setEvent(r.event);
      setError("");
    } catch (error) {
      setError(directError(error));
    }
  }, [eventId]);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void load();
    });
    const listener = () => void load();
    window.addEventListener("merkat:reconcile", listener);
    return () => {
      active = false;
      window.removeEventListener("merkat:reconcile", listener);
    };
  }, [load]);
  const change = (fresh: CalendarEventView) => {
    setEvent(fresh);
    onChanged?.(fresh);
    featureChanged();
  };
  async function act(endpoint: string, body: unknown) {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const r = await directRequest<{ event: CalendarEventView }>(
        endpoint,
        body,
      );
      change(r.event);
    } catch (error) {
      setError(directError(error));
    } finally {
      setPending(false);
    }
  }
  if (!event)
    return (
      <div>
        <p role={error ? "alert" : "status"}>{error || "Loading plan…"}</p>
        {error && <Button onClick={() => void load()}>Try again</Button>}
      </div>
    );
  if (editing)
    return (
      <EventForm
        event={event}
        onSaved={(fresh) => {
          change(fresh);
          setEditing(false);
        }}
        onCancel={() => setEditing(false)}
      />
    );
  const own = event.participants.find((p) => p.userId === userId),
    going = event.participants.filter((p) => p.response === "GOING");
  return (
    <article className="event-detail">
      <p className="eyebrow">
        {event.scope
          ? "GOOD COMPANY, ON THE CALENDAR"
          : "A LITTLE TIME FOR YOU"}
      </p>
      <h2>{event.title}</h2>
      {event.cancelled && <p className="feature-status">Cancelled</p>}
      <div className="event-facts">
        <p>
          <CalendarDays size={18} />
          <span>
            {eventDate(event)}
            <small>
              to {new Date(event.endsAt).toLocaleString()} · {event.timezone}
            </small>
          </span>
        </p>
        {event.location && (
          <p>
            <MapPin size={18} />
            <span>{event.location}</span>
          </p>
        )}
      </div>
      {event.description && <p className="profile-bio">{event.description}</p>}
      {!event.cancelled && (
        <>
          <div className="rsvp-options" aria-label="Your attendance">
            {(["GOING", "MAYBE", "DECLINED"] as const).map((response) => (
              <Button
                key={response}
                disabled={pending}
                aria-pressed={own?.response === response}
                variant={own?.response === response ? "primary" : "secondary"}
                onClick={() =>
                  void act("calendar/respond", { id: event.id, response })
                }
              >
                {response === "GOING"
                  ? "Going"
                  : response === "MAYBE"
                    ? "Maybe"
                    : "Not going"}
              </Button>
            ))}
          </div>
          <Button
            disabled={pending}
            onClick={() =>
              void act("calendar/respond", {
                id: event.id,
                subscribed: !own?.subscribed,
              })
            }
          >
            {own?.subscribed ? "Remove from my calendar" : "Add to my calendar"}
          </Button>
          <p className="supporting-copy">
            {own?.subscribed
              ? "Reminders are scheduled 24 hours and 5 hours before, when those times are still ahead."
              : "Only people who add this plan receive reminders. Going adds it automatically."}
          </p>
        </>
      )}
      <section>
        <h3>
          {going.length} going · {event.participants.length} invited
        </h3>
        <ul className="event-people">
          {event.participants.map((person) => (
            <li key={person.userId}>
              <span>
                {person.userId === userId
                  ? "You"
                  : (person.displayName ?? person.username)}
              </span>
              <span>
                {person.response.toLowerCase().replace("declined", "not going")}
              </span>
            </li>
          ))}
        </ul>
      </section>
      <div className="feature-actions">
        <Button onClick={() => exportCalendar(event)}>
          <Download size={16} />
          Export .ics
        </Button>
        {event.scope && (
          <Link
            className="button"
            href={
              event.scope.kind === "DM"
                ? `/chats?conversation=${event.scope.id}`
                : `/chats?group=${event.scope.id}&channel=${event.scope.channelId}`
            }
          >
            Open conversation
          </Link>
        )}
        {event.ownerId === userId && !event.cancelled && (
          <>
            <Button disabled={pending} onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button disabled={pending} onClick={() => setConfirmCancel(true)}>
              Cancel plan
            </Button>
          </>
        )}
      </div>
      {confirmCancel && (
        <div className="confirmation-panel">
          <p>Cancel this plan for everyone? Pending reminders will stop.</p>
          <Button
            disabled={pending}
            onClick={() => {
              setConfirmCancel(false);
              void act("calendar/cancel", {
                id: event.id,
                version: event.version,
              });
            }}
          >
            Yes, cancel plan
          </Button>
          <Button onClick={() => setConfirmCancel(false)}>Keep plan</Button>
        </div>
      )}
      {error && (
        <p role="alert" className="account-error">
          {error}
        </p>
      )}
    </article>
  );
}
const subscribeHydration = () => () => {};
export function CalendarWorkspace({ userId }: { userId: string }) {
  const hydrated = useSyncExternalStore(
    subscribeHydration,
    () => true,
    () => false,
  );
  return hydrated ? (
    <CalendarContent userId={userId} />
  ) : (
    <p className="feature-empty" role="status">
      Opening your calendar…
    </p>
  );
}
function CalendarContent({ userId }: { userId: string }) {
  const params = useSearchParams(),
    dialog = useRef<HTMLDialogElement>(null);
  const [anchor, setAnchor] = useState(() => new Date()),
    [selected, setSelected] = useState(() => dateKey(new Date())),
    [mode, setMode] = useState<"month" | "week" | "day" | "agenda">("month"),
    [filter, setFilter] = useState("all"),
    [search, setSearch] = useState("");
  const [events, setEvents] = useState<CalendarEventView[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [truncated, setTruncated] = useState(false),
    [opened, setOpened] = useState<string | null>(null),
    [creating, setCreating] = useState(false);
  const year = anchor.getFullYear(),
    month = anchor.getMonth();
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await directRequest<{
        events: CalendarEventView[];
        truncated: boolean;
      }>("calendar/list", {
        start: new Date(year, month - 1, 1).toISOString(),
        end: new Date(year, month + 2, 1).toISOString(),
      });
      setEvents(result.events);
      setTruncated(result.truncated);
      setError("");
    } catch (error) {
      setError(directError(error));
    } finally {
      setLoading(false);
    }
  }, [year, month]);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void load();
    });
    const change = () => void load();
    window.addEventListener("merkat:feature-change", change);
    window.addEventListener("focus", change);
    return () => {
      active = false;
      window.removeEventListener("merkat:feature-change", change);
      window.removeEventListener("focus", change);
    };
  }, [load]);
  useEffect(() => {
    const id = params.get("event");
    if (id) {
      queueMicrotask(() => setOpened(id));
      dialog.current?.showModal();
    }
  }, [params]);
  function open(id: string) {
    setOpened(id);
    setCreating(false);
    dialog.current?.showModal();
  }
  const visible = events.filter(
    (e) =>
      !e.cancelled &&
      (filter === "all" || (filter === "shared" ? !!e.scope : !e.scope)) &&
      `${e.title} ${e.location} ${e.description}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const first = new Date(year, month, 1),
    offset = (first.getDay() + 6) % 7,
    days = Array.from(
      { length: 42 },
      (_, i) => new Date(year, month, 1 - offset + i),
    );
  const selectedDate = new Date(`${selected}T12:00:00`),
    weekStart = new Date(selectedDate);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  function navigate(direction: number) {
    if (mode === "week" || mode === "day") {
      const next = new Date(selectedDate);
      next.setDate(next.getDate() + direction * (mode === "week" ? 7 : 1));
      setSelected(dateKey(next));
      setAnchor(next);
    } else setAnchor(new Date(year, month + direction, 1));
  }
  const agenda = visible.filter((e) =>
    mode === "agenda"
      ? new Date(e.endsAt) >= new Date()
      : mode === "week"
        ? new Date(e.startsAt) >= weekStart &&
          new Date(e.startsAt) <
            new Date(
              weekStart.getFullYear(),
              weekStart.getMonth(),
              weekStart.getDate() + 7,
            )
        : dateKey(new Date(e.startsAt)) === selected,
  );
  return (
    <div className="calendar-workspace">
      <header className="feature-page-heading">
        <div>
          <p className="eyebrow">MAKE TIME FOR GOOD COMPANY</p>
          <h1>Calendar</h1>
          <p className="supporting-copy">Your plans, all in one place.</p>
        </div>
        <div className="feature-actions">
          <Button
            variant="primary"
            onClick={() => {
              setCreating(true);
              setOpened(null);
              dialog.current?.showModal();
            }}
          >
            <Plus size={18} />
            New plan
          </Button>
        </div>
      </header>
      <div className="calendar-toolbar">
        <div className="feature-actions">
          <IconButton
            icon={ChevronLeft}
            label="Previous month"
            onClick={() => navigate(-1)}
          />
          <h2>
            {anchor.toLocaleDateString([], { month: "long", year: "numeric" })}
          </h2>
          <IconButton
            icon={ChevronRight}
            label="Next month"
            onClick={() => navigate(1)}
          />
          <Button
            onClick={() => {
              setAnchor(new Date());
              setSelected(dateKey(new Date()));
            }}
          >
            Today
          </Button>
        </div>
        <div className="segmented" aria-label="Calendar view">
          {(["month", "week", "day", "agenda"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              onClick={() => setMode(value)}
            >
              {value[0]!.toUpperCase() + value.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <div className="calendar-filters">
        <label className="search-field">
          <Search size={18} />
          <input
            aria-label="Search calendar"
            placeholder="Find a plan…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <select
          aria-label="Filter plans"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">All plans</option>
          <option value="shared">Shared plans</option>
          <option value="personal">Personal plans</option>
        </select>
      </div>
      {loading && (
        <p role="status" className="supporting-copy">
          Updating calendar…
        </p>
      )}
      {error && (
        <div role="alert">
          <p>{error}</p>
          <Button onClick={() => void load()}>Try again</Button>
        </div>
      )}
      {truncated && (
        <p role="status">
          Showing the first 200 plans. Narrow the date range or search.
        </p>
      )}
      {mode === "month" && (
        <div className="calendar-grid" aria-label="Month calendar">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
            <div className="calendar-weekday" key={day}>
              {day}
            </div>
          ))}
          {days.map((date) => {
            const key = dateKey(date),
              matches = visible.filter(
                (e) => dateKey(new Date(e.startsAt)) === key,
              );
            return (
              <button
                key={key}
                type="button"
                className="calendar-day"
                data-outside={date.getMonth() !== month}
                data-selected={key === selected}
                aria-current={key === dateKey(new Date()) ? "date" : undefined}
                aria-label={`${date.toLocaleDateString([], { dateStyle: "full" })}, ${matches.length} plans`}
                onClick={() => setSelected(key)}
              >
                <span>{date.getDate()}</span>
                <span className="calendar-day-events">
                  {matches.slice(0, 2).map((e) => (
                    <span key={e.id}>{e.title}</span>
                  ))}
                  {matches.length > 2 && (
                    <small>+{matches.length - 2} more</small>
                  )}
                </span>
                {matches.length > 0 && <span className="calendar-dot" />}
              </button>
            );
          })}
        </div>
      )}
      <section className="calendar-agenda">
        <h2>
          {mode === "month" || mode === "day"
            ? selectedDate.toLocaleDateString([], {
                weekday: "long",
                month: "long",
                day: "numeric",
              })
            : mode === "week"
              ? "This week’s plans"
              : "Coming up"}
        </h2>
        {!loading && !agenda.length && (
          <div className="feature-empty">
            <CalendarDays size={32} />
            <h3>A little room for something good.</h3>
            <p>Create a plan, or add one from a conversation.</p>
          </div>
        )}
        {agenda.map((event) => (
          <button
            key={event.id}
            className="agenda-event"
            type="button"
            onClick={() => open(event.id)}
          >
            <span className="agenda-date">
              <strong>{new Date(event.startsAt).getDate()}</strong>
              <small>
                {new Date(event.startsAt).toLocaleDateString([], {
                  month: "short",
                })}
              </small>
            </span>
            <span>
              <strong>{event.title}</strong>
              <small>
                {eventDate(event)}
                {event.location ? ` · ${event.location}` : ""}
              </small>
            </span>
            <span className="feature-status">
              {event.scope ? "Shared" : "Personal"}
            </span>
          </button>
        ))}
      </section>
      <dialog
        ref={dialog}
        className="feature-dialog"
        aria-label={creating ? "Create a plan" : "Plan details"}
      >
        <div className="direct-dialog-heading">
          <span>MERKAT CALENDAR</span>
          <IconButton
            icon={X}
            label="Close calendar details"
            onClick={() => dialog.current?.close()}
          />
        </div>
        {creating ? (
          <EventForm
            onSaved={(e) => {
              setOpened(e.id);
              setCreating(false);
              void load();
            }}
            onCancel={() => dialog.current?.close()}
          />
        ) : opened ? (
          <EventDetail
            eventId={opened}
            userId={userId}
            onChanged={() => void load()}
          />
        ) : null}
      </dialog>
    </div>
  );
}
