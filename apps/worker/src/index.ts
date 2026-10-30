import { setTimeout } from "node:timers/promises";
import {
  createDatabase,
  createCalendarRepository,
  createPushRepository,
} from "@merkat/database";
const database = createDatabase(process.env),
  calendar = createCalendarRepository(database),
  push = createPushRepository(database);
const controller = new AbortController();
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => controller.abort());
try {
  do {
    try {
      let more = true;
      while (more && !controller.signal.aborted) {
        const result = await calendar.deliverDue();
        console.info(JSON.stringify({ job: "calendar-reminders", ...result }));
        more = result.processed === 100;
      }
      const result = await push.deliver();
      console.info(JSON.stringify({ job: "push-delivery", ...result }));
    } catch {
      console.error(
        "Merkat reminder worker could not complete this cycle. Pending work remains in PostgreSQL.",
      );
      if (process.argv.includes("--once")) process.exitCode = 1;
    }
    if (process.argv.includes("--once") || controller.signal.aborted) break;
    await setTimeout(60000, undefined, { signal: controller.signal }).catch(
      () => {},
    );
  } while (!controller.signal.aborted);
} finally {
  await database.$disconnect();
}
