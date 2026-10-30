import { defineConfig } from "prisma/config";

// Generation and schema validation do not require a live connection.
// Migration commands fail if neither URL is provided; no fallback credentials.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: process.env.DIRECT_URL || process.env.DATABASE_URL || "" },
});
