-- Review/apply ONLY to a known dedicated Supabase staging project AFTER Prisma migrations.
-- This intentionally restricts the project's anon/authenticated Broadcast access to Merkat.
-- Disable Realtime "Allow public access" in the Dashboard BEFORE configuring the app.
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'realtime.messages'::regclass AND relrowsecurity) THEN
    RAISE EXCEPTION 'Realtime RLS must already be enabled';
  END IF;
END $$;

-- Private lookup: does not grant SELECT on sessions, users or conversations to browser roles.
CREATE OR REPLACE FUNCTION merkat_private.realtime_allowed(requested_topic text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE claims jsonb := current_setting('request.jwt.claims', true)::jsonb;
DECLARE uid uuid;
DECLARE sid uuid;
BEGIN
  IF claims->>'role' IS DISTINCT FROM 'authenticated' OR claims->>'merkat_purpose' IS DISTINCT FROM 'realtime' THEN RETURN false; END IF;
  IF claims->>'sub' IS NULL OR claims->>'merkat_session_id' IS NULL THEN RETURN false; END IF;
  uid := (claims->>'sub')::uuid;
  sid := (claims->>'merkat_session_id')::uuid;
  IF requested_topic IS DISTINCT FROM 'merkat:user:' || uid::text THEN RETURN false; END IF;
  RETURN EXISTS (
    SELECT 1 FROM public."Session" s JOIN public."User" u ON u.id = s."userId"
    WHERE s.id = sid AND s."userId" = uid AND s."revokedAt" IS NULL
      AND s."expiresAt" > statement_timestamp() AND u.status = 'ACTIVE'
      AND u."onboardingCompletedAt" IS NOT NULL
  );
EXCEPTION WHEN invalid_text_representation THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION merkat_private.realtime_allowed(text) FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA merkat_private TO authenticated;
GRANT EXECUTE ON FUNCTION merkat_private.realtime_allowed(text) TO authenticated;

DROP POLICY IF EXISTS merkat_receive ON realtime.messages;
DROP POLICY IF EXISTS merkat_guard ON realtime.messages;
CREATE POLICY merkat_receive ON realtime.messages FOR SELECT TO authenticated
USING (extension = 'broadcast' AND (SELECT merkat_private.realtime_allowed((SELECT realtime.topic()))));
-- Restrictive AND prevents a pre-existing permissive policy from widening reads or publishing.
CREATE POLICY merkat_guard ON realtime.messages AS RESTRICTIVE FOR ALL TO anon, authenticated
USING (extension = 'broadcast' AND (SELECT merkat_private.realtime_allowed((SELECT realtime.topic()))))
WITH CHECK (false);

-- Browser identities have no application-table access, even on projects with default grants.
REVOKE ALL ON public."User", public."Profile", public."Session", public."ExternalIdentity",
  public."PasswordCredential", public."AuthRateLimit", public."DirectConversation",
  public."DirectParticipant", public."DirectMessage", public."MessagingRateLimit", public."Friendship" FROM anon, authenticated;

CREATE OR REPLACE FUNCTION merkat_private.direct_notify() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE a uuid;
DECLARE b uuid;
BEGIN
  IF TG_TABLE_NAME = 'DirectConversation' THEN
    IF TG_OP = 'UPDATE' AND NEW."lastSequence" = OLD."lastSequence" AND NEW."activityAt" = OLD."activityAt" THEN RETURN NEW; END IF;
    a := NEW."firstUserId"; b := NEW."secondUserId";
  ELSE
    IF NEW."readSequence" = OLD."readSequence" AND NEW."deliveredSequence" = OLD."deliveredSequence" THEN RETURN NEW; END IF;
    SELECT "firstUserId", "secondUserId" INTO a, b FROM public."DirectConversation" WHERE id = NEW."conversationId";
  END IF;
  -- Empty invalidation only. Message content is always fetched via an authorized Merkat API.
  PERFORM realtime.send('{}'::jsonb, 'changed', 'merkat:user:' || a::text, true);
  PERFORM realtime.send('{}'::jsonb, 'changed', 'merkat:user:' || b::text, true);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION merkat_private.direct_notify() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS direct_notify_conversation ON public."DirectConversation";
CREATE TRIGGER direct_notify_conversation AFTER INSERT OR UPDATE ON public."DirectConversation"
FOR EACH ROW EXECUTE FUNCTION merkat_private.direct_notify();
DROP TRIGGER IF EXISTS direct_notify_receipt ON public."DirectParticipant";
CREATE TRIGGER direct_notify_receipt AFTER UPDATE ON public."DirectParticipant"
FOR EACH ROW EXECUTE FUNCTION merkat_private.direct_notify();

CREATE OR REPLACE FUNCTION merkat_private.friend_notify() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE a uuid;
DECLARE b uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN a := OLD."firstUserId"; b := OLD."secondUserId";
  ELSE a := NEW."firstUserId"; b := NEW."secondUserId"; END IF;
  PERFORM realtime.send('{}'::jsonb, 'changed', 'merkat:user:' || a::text, true);
  PERFORM realtime.send('{}'::jsonb, 'changed', 'merkat:user:' || b::text, true);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION merkat_private.friend_notify() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS friend_notify ON public."Friendship";
CREATE TRIGGER friend_notify AFTER INSERT OR UPDATE OR DELETE ON public."Friendship"
FOR EACH ROW EXECUTE FUNCTION merkat_private.friend_notify();
COMMIT;
