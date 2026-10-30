import { checkRuntimeDatabase, createDatabase } from "@merkat/database";

// Deliberately do not load an arbitrary .env or switch to DIRECT_URL. The caller
// supplies the reviewed target and the same restricted credentials as the app.
let database: ReturnType<typeof createDatabase> | undefined;
try {
  database = createDatabase(process.env);
  const result = await checkRuntimeDatabase(database);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ready ? 0 : 1;
} catch {
  // Exception messages can contain connection URLs, SQL or private parameters.
  console.error(
    "Runtime database check failed. Check connectivity, verified TLS and the application environment.",
  );
  process.exitCode = 1;
} finally {
  await database?.$disconnect();
}
