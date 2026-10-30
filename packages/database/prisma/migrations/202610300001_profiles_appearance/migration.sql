CREATE TABLE "ProfileAvatar" (
  "userId" uuid PRIMARY KEY REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE RESTRICT,
  bytes bytea NOT NULL CHECK (octet_length(bytes) BETWEEN 1 AND 524288),
  version char(64) NOT NULL,
  "updatedAt" timestamptz(3) NOT NULL
);
CREATE TABLE "UserSettings" (
  "userId" uuid PRIMARY KEY REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE RESTRICT,
  theme varchar(8) NOT NULL DEFAULT 'SYSTEM' CHECK (theme IN ('SYSTEM','LIGHT','DARK')),
  "reduceMotion" boolean NOT NULL DEFAULT false,
  "largeText" boolean NOT NULL DEFAULT false,
  "remindersEnabled" boolean NOT NULL DEFAULT true,
  "pushEnabled" boolean NOT NULL DEFAULT false,
  timezone varchar(80) NOT NULL DEFAULT 'Europe/Istanbul'
);
ALTER TABLE "ProfileAvatar" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserSettings" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "ProfileAvatar", "UserSettings" FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='merkat_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "ProfileAvatar", "UserSettings" TO merkat_runtime;
    CREATE POLICY merkat_runtime ON "ProfileAvatar" TO merkat_runtime USING (true) WITH CHECK (true);
    CREATE POLICY merkat_runtime ON "UserSettings" TO merkat_runtime USING (true) WITH CHECK (true);
  END IF;
END $$;
