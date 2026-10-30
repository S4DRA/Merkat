ALTER TABLE "Plan" ADD COLUMN "submissionHash" char(64) CHECK("submissionHash" IS NULL OR "submissionHash" ~ '^[a-f0-9]{64}$');
