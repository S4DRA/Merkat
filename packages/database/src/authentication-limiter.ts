import type { AuthenticationLimiter } from "@merkat/backend";
import type { PrismaClient } from "./generated/client.js";

/** Bounded persistent counters. Atomic per-slot UPSERT, expiry uses database time. */
export function createAuthenticationLimiter(
  db: PrismaClient,
): AuthenticationLimiter {
  return {
    consume(buckets) {
      return db.$transaction(async (tx) => {
        for (const bucket of buckets) {
          const rows = await tx.$queryRaw<
            { attempts: number; retryAfter: number }[]
          >`
            INSERT INTO "AuthRateLimit" (scope, slot, attempts, "expiresAt")
            VALUES (${bucket.scope}, ${bucket.slot}, 1, statement_timestamp() + ${bucket.seconds}::int * interval '1 second')
            ON CONFLICT (scope, slot) DO UPDATE SET
              attempts = CASE WHEN "AuthRateLimit"."expiresAt" <= statement_timestamp() THEN 1
                ELSE LEAST("AuthRateLimit".attempts + 1, ${bucket.limit + 1}) END,
              "expiresAt" = CASE WHEN "AuthRateLimit"."expiresAt" <= statement_timestamp()
                THEN statement_timestamp() + ${bucket.seconds}::int * interval '1 second'
                ELSE "AuthRateLimit"."expiresAt" END
            RETURNING attempts, GREATEST(1, CEIL(EXTRACT(EPOCH FROM ("expiresAt" - statement_timestamp()))))::int AS "retryAfter"`;
          const row = rows[0];
          if (!row) throw new Error("Authentication limiter unavailable.");
          // Commit denial counters as well. Never roll back a rejected attempt.
          if (row.attempts > bucket.limit) return row.retryAfter;
        }
        return 0;
      });
    },
  };
}
