/** Convert a wall-clock input to one unambiguous instant; never silently shift DST gaps. */
export function zonedDateTimeToIso(value: string, timeZone: string) {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value))
    throw new Error("Choose a date and time.");
  const [date, time] = value.split("T"),
    [year, month, day] = date!.split("-").map(Number),
    [hour, minute] = time!.split(":").map(Number);
  const naive = Date.UTC(year!, month! - 1, day!, hour!, minute!);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const wall = (instant: number) => {
    const p = Object.fromEntries(
      formatter.formatToParts(instant).map((a) => [a.type, a.value]),
    );
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
  };
  const offsets = new Set<number>();
  for (let h = -48; h <= 48; h += 6) {
    const at = naive + h * 3600000,
      p = Object.fromEntries(
        formatter.formatToParts(at).map((a) => [a.type, a.value]),
      );
    offsets.add(
      Date.UTC(
        Number(p.year),
        Number(p.month) - 1,
        Number(p.day),
        Number(p.hour),
        Number(p.minute),
      ) - at,
    );
  }
  const candidates = [...offsets]
    .map((offset) => naive - offset)
    .filter((at) => wall(at) === value);
  if (candidates.length !== 1)
    throw new Error(
      candidates.length
        ? "That time occurs twice when clocks change. Choose a time outside that hour."
        : "That time does not exist in this timezone. Choose another time.",
    );
  return new Date(candidates[0]!).toISOString();
}
export function localDateTimeInput(iso: string, timeZone: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(iso))
      .map((a) => [a.type, a.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
