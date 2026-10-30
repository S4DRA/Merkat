CREATE TABLE "GroupAvatar" (
 "groupId" uuid PRIMARY KEY REFERENCES "ChatGroup"(id) ON DELETE CASCADE ON UPDATE RESTRICT,
 bytes bytea NOT NULL CHECK(octet_length(bytes) BETWEEN 1 AND 524288),
 version char(64) NOT NULL,
 "updatedAt" timestamptz(3) NOT NULL
);
ALTER TABLE "GroupAvatar" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "GroupAvatar" FROM PUBLIC;
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
   EXECUTE format('REVOKE ALL ON "GroupAvatar" FROM %I',r);
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='merkat_runtime') THEN
  GRANT SELECT,INSERT,UPDATE,DELETE ON "GroupAvatar" TO merkat_runtime;
  CREATE POLICY merkat_runtime ON "GroupAvatar" TO merkat_runtime USING(true) WITH CHECK(true);
 END IF;
END $$;
