CREATE TABLE "RecoveryCode" (
 "codeHash" char(64) PRIMARY KEY, "userId" uuid NOT NULL REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE RESTRICT,
 "createdAt" timestamptz(3) NOT NULL DEFAULT now(), "usedAt" timestamptz(3)
);
CREATE INDEX "RecoveryCode_userId_usedAt_idx" ON "RecoveryCode"("userId","usedAt");
ALTER TABLE "RecoveryCode" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "RecoveryCode" FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='merkat_runtime') THEN
 GRANT SELECT,INSERT,UPDATE,DELETE ON "RecoveryCode" TO merkat_runtime;
 CREATE POLICY merkat_runtime ON "RecoveryCode" TO merkat_runtime USING(true) WITH CHECK(true);
END IF; END $$;
