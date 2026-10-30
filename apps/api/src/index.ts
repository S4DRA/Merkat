import { createApp } from "./app.js";
import { readApiEnvironment } from "./environment.js";
import { createDatabase, createAccountRepository, createPlanRepository } from "@merkat/database";
import { AccountService } from "@merkat/backend";
import { createSupabaseIdentity } from "./supabase-identity.js";
import { createMatrixAdapter } from "./matrix-adapter.js";

const env = readApiEnvironment(process.env);
const database = createDatabase(process.env);
const app = createApp(env.LOG_LEVEL, {
  accounts: new AccountService(createAccountRepository(database)),
  plans: createPlanRepository(database),
  messaging: process.env.MATRIX_INTERNAL_URL && process.env.MATRIX_SERVER_NAME && process.env.MATRIX_ADMIN_TOKEN && process.env.MATRIX_PASSWORD_SECRET
    ? createMatrixAdapter({ url: process.env.MATRIX_INTERNAL_URL, serverName: process.env.MATRIX_SERVER_NAME, adminToken: process.env.MATRIX_ADMIN_TOKEN, passwordSecret: process.env.MATRIX_PASSWORD_SECRET }) : undefined,
  appOrigin: env.APP_ORIGIN,
  production: env.NODE_ENV === "production",
  phoneIdentity: process.env.SUPABASE_URL && process.env.SUPABASE_PUBLISHABLE_KEY
    ? createSupabaseIdentity(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY)
    : undefined,
});
app.addHook("onClose", async () => {
  await database.$disconnect();
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void app.close().catch(() => {
      app.log.error("API shutdown failed.");
      process.exitCode = 1;
    });
  });
}
try {
  await database.$connect();
  await app.listen({ host: env.API_HOST, port: env.API_PORT });
} catch {
  app.log.error(
    "API startup failed. Check database connectivity and runtime configuration.",
  );
  await database.$disconnect();
  process.exitCode = 1;
}
