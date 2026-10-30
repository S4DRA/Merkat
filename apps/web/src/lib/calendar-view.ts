import type { CalendarEventView } from "@merkat/contracts";
export const dateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
export function weekStartsOn(locale: string) {
  const value = new Intl.Locale(locale) as Intl.Locale & {
    getWeekInfo?: () => { firstDay: number };
    weekInfo?: { firstDay: number };
  };
  return (value.getWeekInfo?.().firstDay ?? value.weekInfo?.firstDay ?? 1) % 7;
}
export function monthDays(anchor: Date, firstDay: number) {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const offset = (first.getDay() - firstDay + 7) % 7;
  return Array.from(
    { length: 42 },
    (_, index) =>
      new Date(anchor.getFullYear(), anchor.getMonth(), 1 - offset + index),
  );
}
export function eventsForDay(events: CalendarEventView[], day: Date) {
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const end = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
  return events.filter(
    (event) =>
      !event.cancelled &&
      new Date(event.startsAt) < end &&
      new Date(event.endsAt) > start,
  );
}
export function calendarRange(
  year: number,
  month: number,
  selected: string,
  mode: "month" | "week" | "day" | "agenda",
  firstDay: number,
) {
  const day = new Date(`${selected}T00:00:00`);
  if (mode === "day")
    return {
      start: day.toISOString(),
      end: new Date(
        day.getFullYear(),
        day.getMonth(),
        day.getDate() + 1,
      ).toISOString(),
    };
  if (mode === "week") {
    const start = new Date(
      day.getFullYear(),
      day.getMonth(),
      day.getDate() - ((day.getDay() - firstDay + 7) % 7),
    );
    return {
      start: start.toISOString(),
      end: new Date(
        start.getFullYear(),
        start.getMonth(),
        start.getDate() + 7,
      ).toISOString(),
    };
  }
  if (mode === "agenda")
    return {
      start: new Date(year, month, 1).toISOString(),
      end: new Date(year, month + 3, 1).toISOString(),
    };
  const days = monthDays(new Date(year, month, 1), firstDay),
    last = days[41]!;
  return {
    start: days[0]!.toISOString(),
    end: new Date(
      last.getFullYear(),
      last.getMonth(),
      last.getDate() + 1,
    ).toISOString(),
  };
}
