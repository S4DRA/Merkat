import { PrismaPg } from "@prisma/adapter-pg";
import { parseIntoClientConfig } from "pg-connection-string";
import { PrismaClient } from "./generated/client.js";
import { readDatabaseEnvironment } from "./environment.js";
export function createDatabase(input: Record<string, string | undefined>) {
  const { DATABASE_URL, DATABASE_CA_CERT } = readDatabaseEnvironment(input);
  // Pass parsed fields so pg cannot reparse connectionString and overwrite the
  // explicit CA. Certificate and hostname verification remain enabled.
  const connection = parseIntoClientConfig(DATABASE_URL);
  if (DATABASE_CA_CERT)
    connection.ssl = { ca: DATABASE_CA_CERT, rejectUnauthorized: true };
  return new PrismaClient({
    adapter: new PrismaPg({
      ...connection,
      max: 5,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
    }),
    // A cold connection can take up to the driver's 5s deadline. Prisma's 2s
    // default otherwise aborts a healthy transaction before connect completes.
    // This changes acquisition only; repository transaction durations stay fixed.
    transactionOptions: { maxWait: 6000 },
    log: [],
  });
}
