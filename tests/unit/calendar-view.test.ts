import assert from "node:assert/strict";
import { test } from "node:test";
import type { CalendarEventView } from "@merkat/contracts";
import {
  dateKey,
  monthDays,
  eventsForDay,
  weekStartsOn,
} from "../../apps/web/src/lib/calendar-view.js";
test("month grids honor locale, leap days and year boundaries", () => {
  assert.equal(weekStartsOn("en-US"), 0);
  assert.equal(weekStartsOn("en-GB"), 1);
  const leap = monthDays(new Date(2028, 1, 15), 1);
  assert.equal(leap.length, 42);
  assert.ok(leap.some((day) => dateKey(day) === "2028-02-29"));
  assert.equal(leap[0]!.getDay(), 1);
  const january = monthDays(new Date(2027, 0, 1), 0);
  assert.equal(january[0]!.getFullYear(), 2026);
  const december = monthDays(new Date(2026, 11, 1), 1);
  assert.equal(december.at(-1)!.getFullYear(), 2027);
});
test("date indicators include every overlapping local day and exclude canceled/end-boundary events", () => {
  const day = new Date(2026, 9, 30),
    next = new Date(2026, 9, 31);
  const event = (start: Date, end: Date, cancelled = false) =>
    ({
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      cancelled,
    }) as CalendarEventView;
  const spanning = event(new Date(2026, 9, 29, 23), new Date(2026, 9, 31, 1));
  const ended = event(new Date(2026, 9, 29, 20), day);
  const beginsTomorrow = event(next, new Date(2026, 9, 31, 2));
  const canceled = event(day, next, true);
  assert.deepEqual(
    eventsForDay([spanning, ended, beginsTomorrow, canceled], day),
    [spanning],
  );
  assert.equal(eventsForDay([spanning], next).length, 1);
});
