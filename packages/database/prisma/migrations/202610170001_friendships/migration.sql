-- User-approved added scope: real mutual friendships, never inferred from a DM.
CREATE TYPE "FriendshipStatus" AS ENUM ('PENDING', 'ACCEPTED');
CREATE TABLE "Friendship" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "firstUserId" UUID NOT NULL,
  "secondUserId" UUID NOT NULL,
  "requestedById" UUID NOT NULL,
  "status" "FriendshipStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acceptedAt" TIMESTAMPTZ(3),
  CONSTRAINT "Friendship_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Friendship_pair_check" CHECK ("firstUserId" < "secondUserId" AND "requestedById" IN ("firstUserId", "secondUserId")),
  CONSTRAINT "Friendship_status_check" CHECK (("status" = 'PENDING' AND "acceptedAt" IS NULL) OR ("status" = 'ACCEPTED' AND "acceptedAt" IS NOT NULL)),
  CONSTRAINT "Friendship_firstUserId_fkey" FOREIGN KEY ("firstUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT "Friendship_secondUserId_fkey" FOREIGN KEY ("secondUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT "Friendship_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "Friendship_firstUserId_secondUserId_key" ON "Friendship"("firstUserId", "secondUserId");
CREATE INDEX "Friendship_firstUserId_status_createdAt_id_idx" ON "Friendship"("firstUserId", "status", "createdAt" DESC, "id" DESC);
CREATE INDEX "Friendship_secondUserId_status_createdAt_id_idx" ON "Friendship"("secondUserId", "status", "createdAt" DESC, "id" DESC);
CREATE INDEX "Friendship_requestedById_status_idx" ON "Friendship"("requestedById", "status");
ALTER TABLE "MessagingRateLimit" ADD COLUMN "friendCount" INTEGER NOT NULL DEFAULT 0 CHECK ("friendCount" BETWEEN 0 AND 10);

CREATE FUNCTION merkat_private.friend_identity_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW."firstUserId" <> OLD."firstUserId" OR NEW."secondUserId" <> OLD."secondUserId" OR NEW."requestedById" <> OLD."requestedById" OR (OLD.status = 'ACCEPTED' AND NEW.status <> 'ACCEPTED') THEN
    RAISE EXCEPTION 'Friendship identity is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION merkat_private.friend_identity_immutable() FROM PUBLIC;
CREATE TRIGGER friend_identity_immutable BEFORE UPDATE ON "Friendship"
FOR EACH ROW EXECUTE FUNCTION merkat_private.friend_identity_immutable();
ALTER TABLE "Friendship" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "Friendship" FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON public."Friendship" FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON public."Friendship" FROM authenticated; END IF;
END $$;
