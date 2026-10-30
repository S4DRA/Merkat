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
import { PeoplePicker } from "../people-picker";
import { GroupDestinationPicker } from "./group-destination-picker";
import {
  dateKey,
  monthDays,
  calendarRange,
  eventsForDay,
  weekStartsOn,
} from "../../lib/calendar-view";
export const featureChanged = () =>
  window.dispatchEvent(new Event("merkat:feature-change"));
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
  initialDate,
  onDirtyChange,
  onSaved,
  onCancel,
}: {
  scope?: ChatScope | undefined;
  event?: CalendarEventView | undefined;
  initialDate?: string | undefined;
  onDirtyChange?: ((dirty: boolean) => void) | undefined;
  onSaved: (event: CalendarEventView) => void;
  onCancel: () => void;
}) {
  const clientId = useRef(crypto.randomUUID()),
    busy = useRef(false);
  const [error, setError] = useState(""),
    [pending, setPending] = useState(false);
  const [sharing, setSharing] = useState("personal");
  const [invitees, setInvitees] = useState<string[]>([]);
  const [groupScope, setGroupScope] = useState<ChatScope | undefined>();
  const [dirty, setDirty] = useState(false);
  const destination = scope ?? (sharing === "group" ? groupScope : undefined);
  useEffect(() => {
    if (!dirty) return;
    const leaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", leaving);
    return () => window.removeEventListener("beforeunload", leaving);
  }, [dirty]);
  const zone =
    event?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [timezone, setTimezone] = useState(zone);
  const [initial] = useState(() => {
    const date =
      initialDate && initialDate !== dateKey(new Date())
        ? new Date(`${initialDate}T10:00:00`)
        : new Date(Date.now() + 3600000);
    date.setMinutes(0, 0, 0);
    if (initialDate && dateKey(date) !== initialDate) {
      const chosen = new Date(`${initialDate}T10:00:00`);
      chosen.setHours(Math.min(new Date().getHours() + 1, 23), 0, 0, 0);
      return chosen;
    }
    return date;
  });
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy.current) return;
    const form = new FormData(e.currentTarget);
    setError("");
    try {
      if (!scope && sharing === "group" && !groupScope)
        throw new Error("Choose a group to share with.");
      const usernames = [
        ...new Set([
          ...invitees,
          ...String(form.get("invitees") ?? "")
            .split(/[\s,]+/)
            .map((name) => name.trim().replace(/^@/, "").toLowerCase())
            .filter(Boolean),
        ]),
      ];
      if (
        usernames.length > 30 ||
        usernames.some((name) => !/^[a-z][a-z0-9_]{2,29}$/.test(name))
      )
        throw new Error("Enter up to 30 valid usernames, separated by commas.");
      const start = zonedDateTimeToIso(String(form.get("start")), timezone);
      const value = calendarFieldsSchema.parse({
        title: form.get("title"),
        description: form.get("description"),
        location: form.get("location"),
        timezone,
        startsAt: start,
        endsAt: form.get("end")
          ? zonedDateTimeToIso(String(form.get("end")), timezone)
          : new Date(Date.parse(start) + 3600000).toISOString(),
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
              ...(!destination
                ? { usernames: sharing === "people" ? usernames : [] }
                : {}),
              ...(destination ? { scope: destination } : {}),
            },
      );
      featureChanged();
      setDirty(false);
      onDirtyChange?.(false);
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
    <form
      className="social-form event-form"
      data-dirty={dirty}
      onChange={() => {
        setDirty(true);
        onDirtyChange?.(true);
      }}
      onSubmit={(e) => void submit(e)}
    >
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
          Ends (optional; defaults to one hour)
          <input
            name="end"
            type="datetime-local"
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
        <>
          <label>
            Activity visibility
            <select
              value={sharing}
              onChange={(e) => {
                setSharing(e.target.value);
                setGroupScope(undefined);
              }}
            >
              <option value="personal">Personal activity</option>
              <option value="people">Invite people</option>
              <option value="group">Share with a group</option>
            </select>
          </label>
          {sharing === "people" && (
            <>
              <PeoplePicker
                value={invitees}
                onChange={setInvitees}
                disabled={pending}
              />
              <details>
                <summary>Enter usernames directly</summary>
                <label>
                  Invite people (optional)
                  <input
                    name="invitees"
                    maxLength={960}
                    placeholder="username, another_username"
                    autoCapitalize="none"
                    autoCorrect="off"
                  />
                </label>
              </details>
            </>
          )}
          {sharing === "group" && (
            <GroupDestinationPicker onChange={setGroupScope} />
          )}
        </>
      )}
      <small>
        Going adds the activity to your calendar. Reminders use your settings:
        24 hours and 5 hours before.
      </small>
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
    [opened, setOpened] = useState<string | null>(null),
    [creating, setCreating] = useState(false);
  const [today, setToday] = useState(() => dateKey(new Date()));
  const [creationDate, setCreationDate] = useState(selected);
  const [firstDay] = useState(() => weekStartsOn(navigator.language));
  const request = useRef<AbortController | null>(null);
  const dirty = useRef(false);
  const markDirty = useCallback((value: boolean) => {
    dirty.current = value;
  }, []);
  const selectedDate = new Date(`${selected}T12:00:00`);
  const weekStart = new Date(selectedDate);
  weekStart.setDate(
    weekStart.getDate() - ((weekStart.getDay() - firstDay + 7) % 7),
  );
  const days = monthDays(anchor, firstDay);
  const year = anchor.getFullYear(),
    month = anchor.getMonth();
  const load = useCallback(async () => {
    const { start, end: rangeEnd } = calendarRange(
      year,
      month,
      selected,
      mode,
      firstDay,
    );
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    try {
      const all = new Map<string, CalendarEventView>();
      let after: { startsAt: string; id: string } | null = null;
      do {
        const previous = after;
        const result: {
          events: CalendarEventView[];
          nextCursor?: { startsAt: string; id: string } | null;
        } = await directRequest(
          "calendar/list",
          { start, end: rangeEnd, ...(after ? { after } : {}) },
          controller.signal,
        );
        result.events.forEach((event) => all.set(event.id, event));
        after = result.nextCursor ?? null;
        if (
          after &&
          previous &&
          after.id === previous.id &&
          after.startsAt === previous.startsAt
        )
          throw new Error("Calendar pagination did not advance");
      } while (after);
      if (controller.signal.aborted) return;
      setEvents([...all.values()]);
      setError("");
    } catch (error) {
      if (!controller.signal.aborted) setError(directError(error));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [year, month, selected, mode, firstDay]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const update = () => {
      const now = new Date();
      setToday(dateKey(now));
      clearTimeout(timer);
      timer = setTimeout(
        update,
        new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate() + 1,
        ).getTime() -
          now.getTime() +
          25,
      );
    };
    timer = setTimeout(update, 0);
    window.addEventListener("focus", update);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", update);
    };
  }, []);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void load();
    });
    const change = () => void load();
    window.addEventListener("merkat:feature-change", change);
    window.addEventListener("focus", change);
    window.addEventListener("online", change);
    window.addEventListener("merkat:reconcile", change);
    return () => {
      active = false;
      request.current?.abort();
      window.removeEventListener("merkat:feature-change", change);
      window.removeEventListener("focus", change);
      window.removeEventListener("online", change);
      window.removeEventListener("merkat:reconcile", change);
    };
  }, [load]);
  useEffect(() => {
    const id = params.get("event");
    if (id) {
      queueMicrotask(() => {
        setOpened(id);
        setCreating(false);
      });
      dialog.current?.showModal();
    }
  }, [params]);
  function open(id: string) {
    if (
      dirty.current &&
      !window.confirm("Discard the unfinished activity form?")
    )
      return;
    dirty.current = false;
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
  function navigate(direction: number) {
    if (mode === "week" || mode === "day") {
      const next = new Date(selectedDate);
      next.setDate(next.getDate() + direction * (mode === "week" ? 7 : 1));
      setSelected(dateKey(next));
      setAnchor(next);
    } else {
      const next = new Date(year, month + direction, 1);
      setAnchor(next);
      setSelected(dateKey(next));
    }
  }
  const agenda = visible.filter((e) =>
    mode === "agenda"
      ? new Date(e.endsAt) >= new Date()
      : mode === "week"
        ? new Date(e.endsAt) > weekStart &&
          new Date(e.startsAt) <
            new Date(
              weekStart.getFullYear(),
              weekStart.getMonth(),
              weekStart.getDate() + 7,
            )
        : eventsForDay([e], selectedDate).length > 0,
  );
  return (
    <div className="calendar-workspace">
      <header className="feature-page-heading">
        <div>
          <p className="eyebrow">MAKE TIME FOR GOOD COMPANY</p>
          <h1 className="sr-only">Calendar</h1>
          <p className="supporting-copy">Your plans, all in one place.</p>
        </div>
        <div className="feature-actions">
          <Button
            variant="primary"
            onClick={() => {
              if (!dirty.current) setCreationDate(selected);
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
      {mode === "month" && (
        <div className="calendar-grid" aria-label="Month calendar">
          {days.slice(0, 7).map((day) => (
            <div className="calendar-weekday" key={dateKey(day)}>
              {day.toLocaleDateString([], { weekday: "short" })}
            </div>
          ))}
          {days.map((date) => {
            const key = dateKey(date),
              matches = eventsForDay(events, date);
            return (
              <button
                key={key}
                type="button"
                className="calendar-day"
                data-outside={date.getMonth() !== month}
                data-selected={key === selected}
                aria-current={key === today ? "date" : undefined}
                aria-pressed={key === selected}
                aria-label={`${date.toLocaleDateString([], { dateStyle: "full" })}, ${matches.length} plans`}
                onClick={() => {
                  if (
                    dirty.current &&
                    !window.confirm("Discard the unfinished activity form?")
                  )
                    return;
                  dirty.current = false;
                  setSelected(key);
                  setCreating(false);
                  setOpened(null);
                  dialog.current?.showModal();
                }}
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
        {!loading && !error && !agenda.length && (
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
        aria-label={
          creating
            ? "Create a plan"
            : opened
              ? "Plan details"
              : "Day activities"
        }
        onClick={(event) => {
          if (event.target === event.currentTarget) dialog.current?.close();
        }}
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
            key={creationDate}
            initialDate={creationDate}
            onDirtyChange={markDirty}
            onSaved={(e) => {
              dirty.current = false;
              setOpened(e.id);
              setCreating(false);
              void load();
            }}
            onCancel={() => dialog.current?.close()}
          />
        ) : opened ? (
          <EventDetail
            key={opened}
            eventId={opened}
            userId={userId}
            onChanged={() => void load()}
          />
        ) : (
          <section className="day-activities">
            <h2>
              {selectedDate.toLocaleDateString([], { dateStyle: "full" })}
            </h2>
            {selected === today && <p className="feature-status">Today</p>}
            {loading && <p role="status">Loading activities…</p>}
            {error && <p role="alert">{error}</p>}
            {!loading &&
              !error &&
              eventsForDay(events, selectedDate).length === 0 && (
                <p>No activities for this day.</p>
              )}
            {eventsForDay(events, selectedDate).map((event) => (
              <button
                type="button"
                className="agenda-event"
                key={event.id}
                onClick={() => open(event.id)}
              >
                <span>
                  <strong>{event.title}</strong>
                  <small>{eventDate(event)}</small>
                  <small>
                    {event.participants.length} participants ·{" "}
                    {event.participants
                      .find((person) => person.userId === userId)
                      ?.response.toLowerCase()}
                  </small>
                </span>
                <span>View details</span>
              </button>
            ))}
            <Button
              variant="primary"
              onClick={() => {
                setCreationDate(selected);
                setCreating(true);
                setOpened(null);
              }}
            >
              Create Activity
            </Button>
          </section>
        )}
      </dialog>
    </div>
  );
}
