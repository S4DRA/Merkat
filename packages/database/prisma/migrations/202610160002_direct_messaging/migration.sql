-- Additive Phase 5 foundation. Application data stays server-only.
CREATE TABLE "DirectConversation" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "firstUserId" UUID NOT NULL,
  "secondUserId" UUID NOT NULL,
  "lastSequence" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "activityAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DirectConversation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DirectConversation_pair_check" CHECK ("firstUserId" < "secondUserId"),
  CONSTRAINT "DirectConversation_sequence_check" CHECK ("lastSequence" >= 0),
  CONSTRAINT "DirectConversation_firstUserId_fkey" FOREIGN KEY ("firstUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT "DirectConversation_secondUserId_fkey" FOREIGN KEY ("secondUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "DirectConversation_firstUserId_secondUserId_key" ON "DirectConversation"("firstUserId", "secondUserId");
CREATE INDEX "DirectConversation_secondUserId_idx" ON "DirectConversation"("secondUserId");
CREATE INDEX "DirectConversation_activityAt_id_idx" ON "DirectConversation"("activityAt" DESC, "id" DESC);

CREATE TABLE "DirectParticipant" (
  "conversationId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "deliveredSequence" INTEGER NOT NULL DEFAULT 0,
  "readSequence" INTEGER NOT NULL DEFAULT 0,
  "unreadCount" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "DirectParticipant_pkey" PRIMARY KEY ("conversationId", "userId"),
  CONSTRAINT "DirectParticipant_cursors_check" CHECK ("readSequence" >= 0 AND "deliveredSequence" >= "readSequence" AND "unreadCount" >= 0),
  CONSTRAINT "DirectParticipant_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "DirectConversation"("id") ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT "DirectParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE RESTRICT
);
CREATE INDEX "DirectParticipant_userId_conversationId_idx" ON "DirectParticipant"("userId", "conversationId");

CREATE TABLE "DirectMessage" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "conversationId" UUID NOT NULL,
  "senderId" UUID NOT NULL,
  "clientId" UUID NOT NULL,
  "sequence" INTEGER NOT NULL,
  "text" VARCHAR(4000) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "DirectMessage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DirectMessage_content_check" CHECK (length(btrim("text", E' \n\r\t')) > 0 AND octet_length("text") <= 16000 AND "sequence" > 0),
  CONSTRAINT "DirectMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "DirectConversation"("id") ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT "DirectMessage_conversationId_senderId_fkey" FOREIGN KEY ("conversationId", "senderId") REFERENCES "DirectParticipant"("conversationId", "userId") ON DELETE CASCADE ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "DirectMessage_conversationId_sequence_key" ON "DirectMessage"("conversationId", "sequence");
CREATE UNIQUE INDEX "DirectMessage_conversationId_senderId_clientId_key" ON "DirectMessage"("conversationId", "senderId", "clientId");

CREATE TABLE "MessagingRateLimit" (
  "userId" UUID NOT NULL,
  "windowStartedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentCount" INTEGER NOT NULL DEFAULT 0,
  "startedCount" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "MessagingRateLimit_pkey" PRIMARY KEY ("userId"),
  CONSTRAINT "MessagingRateLimit_counts_check" CHECK ("sentCount" BETWEEN 0 AND 60 AND "startedCount" BETWEEN 0 AND 10),
  CONSTRAINT "MessagingRateLimit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE RESTRICT
);

CREATE SCHEMA IF NOT EXISTS merkat_private;
REVOKE ALL ON SCHEMA merkat_private FROM PUBLIC;

CREATE FUNCTION merkat_private.direct_pair_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW."firstUserId" <> OLD."firstUserId" OR NEW."secondUserId" <> OLD."secondUserId" THEN
    RAISE EXCEPTION 'Direct conversation identities are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER direct_pair_immutable BEFORE UPDATE ON "DirectConversation"
FOR EACH ROW EXECUTE FUNCTION merkat_private.direct_pair_immutable();

CREATE FUNCTION merkat_private.direct_members_create() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  INSERT INTO public."DirectParticipant" ("conversationId", "userId") VALUES (NEW.id, NEW."firstUserId"), (NEW.id, NEW."secondUserId");
  RETURN NEW;
END $$;
CREATE TRIGGER direct_members_create AFTER INSERT ON "DirectConversation"
FOR EACH ROW EXECUTE FUNCTION merkat_private.direct_members_create();

CREATE FUNCTION merkat_private.direct_member_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE c public."DirectConversation";
BEGIN
  SELECT * INTO c FROM public."DirectConversation" WHERE id = COALESCE(NEW."conversationId", OLD."conversationId") FOR UPDATE;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF c.id IS NULL OR NEW."userId" NOT IN (c."firstUserId", c."secondUserId") THEN
    RAISE EXCEPTION 'Invalid direct participant' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW."conversationId" <> OLD."conversationId" OR NEW."userId" <> OLD."userId" OR NEW."readSequence" < OLD."readSequence" OR NEW."deliveredSequence" < OLD."deliveredSequence") THEN
    RAISE EXCEPTION 'Invalid participant update' USING ERRCODE = '23514';
  END IF;
  IF NEW."deliveredSequence" > c."lastSequence" THEN
    RAISE EXCEPTION 'Receipt exceeds history' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER direct_member_guard BEFORE INSERT OR UPDATE OR DELETE ON "DirectParticipant"
FOR EACH ROW EXECUTE FUNCTION merkat_private.direct_member_guard();

CREATE FUNCTION merkat_private.direct_members_exact() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE cid uuid := COALESCE(NEW."conversationId", OLD."conversationId");
BEGIN
  IF EXISTS (SELECT 1 FROM public."DirectConversation" WHERE id = cid)
    AND (SELECT count(*) FROM public."DirectParticipant" WHERE "conversationId" = cid) <> 2 THEN
    RAISE EXCEPTION 'Direct conversations require two participants' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER direct_members_exact AFTER INSERT OR UPDATE OR DELETE ON "DirectParticipant"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION merkat_private.direct_members_exact();

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA merkat_private FROM PUBLIC;
ALTER TABLE "DirectConversation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DirectParticipant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DirectMessage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MessagingRateLimit" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "DirectConversation", "DirectParticipant", "DirectMessage", "MessagingRateLimit" FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public."DirectConversation", public."DirectParticipant", public."DirectMessage", public."MessagingRateLimit" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public."DirectConversation", public."DirectParticipant", public."DirectMessage", public."MessagingRateLimit" FROM authenticated;
  END IF;
END $$;
