-- Phase 6, known isolated staging ONLY. Never apply to the current production
-- project without a separate release approval. Requires the seventh Prisma
-- migration, realtime.sql and server-role.sql. Repeatable, no signing-key changes.
BEGIN;
DO $$ DECLARE t text; BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='merkat_runtime' AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole AND NOT rolcreatedb) THEN RAISE EXCEPTION 'Expected restricted Merkat backend'; END IF;
  FOREACH t IN ARRAY ARRAY['ChatGroup','GroupMember','GroupChannel','GroupMessage','GroupReadState','GroupInvitation','UserPrivacy','UserBlock'] LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=t AND c.relrowsecurity AND pg_get_userbyid(c.relowner)<>'merkat_runtime') THEN RAISE EXCEPTION 'Expected RLS and separate owner on %',t; END IF;
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
    EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO merkat_runtime',t);
    EXECUTE format('DROP POLICY IF EXISTS merkat_server ON public.%I',t);
    EXECUTE format('CREATE POLICY merkat_server ON public.%I FOR ALL TO merkat_runtime USING(true) WITH CHECK(true)',t);
  END LOOP;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='merkat_moderator') THEN
    CREATE ROLE merkat_moderator NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  ELSIF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='merkat_moderator' AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls)) THEN RAISE EXCEPTION 'Unexpected moderation role privileges'; END IF;
END $$;
-- The application has no report-reading capability. Operator access is opt-in
-- through explicit membership of this NOLOGIN role; no member is granted here.
REVOKE ALL ON public."SafetyReport" FROM PUBLIC,anon,authenticated,merkat_runtime,merkat_moderator;
GRANT INSERT ON public."SafetyReport" TO merkat_runtime;
GRANT USAGE ON SCHEMA public TO merkat_moderator;
GRANT SELECT ON public."SafetyReport" TO merkat_moderator;
DROP POLICY IF EXISTS merkat_report_insert ON public."SafetyReport";
CREATE POLICY merkat_report_insert ON public."SafetyReport" FOR INSERT TO merkat_runtime WITH CHECK(true);
DROP POLICY IF EXISTS merkat_report_review ON public."SafetyReport";
CREATE POLICY merkat_report_review ON public."SafetyReport" FOR SELECT TO merkat_moderator USING(true);
GRANT EXECUTE ON FUNCTION merkat_private.group_integrity(),merkat_private.group_member_guard(),merkat_private.group_message_guard(),merkat_private.group_read_guard() TO merkat_runtime;

CREATE OR REPLACE FUNCTION merkat_private.group_notify() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE data jsonb := CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
DECLARE gid uuid;
DECLARE extra uuid;
DECLARE peer uuid;
DECLARE recipient uuid;
BEGIN
  IF TG_TABLE_NAME='UserBlock' THEN
    extra:=(data->>'blockerId')::uuid;peer:=(data->>'blockedId')::uuid;
  ELSIF TG_TABLE_NAME='UserPrivacy' THEN extra:=(data->>'userId')::uuid;
  ELSIF TG_TABLE_NAME='GroupReadState' THEN
    IF TG_OP='UPDATE' AND NEW."readSequence"=OLD."readSequence" AND NEW."deliveredSequence"=OLD."deliveredSequence" THEN RETURN NULL; END IF;
    extra:=(data->>'userId')::uuid;
  ELSIF TG_TABLE_NAME='ChatGroup' THEN gid:=(data->>'id')::uuid;extra:=(data->>'ownerId')::uuid;
  ELSE
    gid:=(data->>'groupId')::uuid;
    IF TG_TABLE_NAME IN ('GroupMember','GroupInvitation') THEN extra:=(data->>'userId')::uuid; END IF;
  END IF;
  FOR recipient IN
    SELECT "userId" FROM public."GroupMember" WHERE "groupId"=gid AND "leftAt" IS NULL
      AND (TG_TABLE_NAME<>'GroupInvitation' OR role IN ('OWNER','ADMIN'))
    UNION SELECT extra WHERE extra IS NOT NULL
    UNION SELECT peer WHERE peer IS NOT NULL
  LOOP
    -- No content, member IDs, group IDs, report IDs or preferences in the payload.
    PERFORM realtime.send('{}'::jsonb,'changed','merkat:user:'||recipient::text,true);
  END LOOP;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION merkat_private.group_notify() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION merkat_private.group_notify() TO merkat_runtime;
DROP TRIGGER IF EXISTS group_notify ON public."ChatGroup";
CREATE TRIGGER group_notify AFTER INSERT OR UPDATE OF name,description,"ownerId","archivedAt" ON public."ChatGroup" FOR EACH ROW EXECUTE FUNCTION merkat_private.group_notify();
DROP TRIGGER IF EXISTS group_channel_notify ON public."GroupChannel";
CREATE TRIGGER group_channel_notify AFTER INSERT OR UPDATE OF name,"deletedAt" ON public."GroupChannel" FOR EACH ROW EXECUTE FUNCTION merkat_private.group_notify();
DROP TRIGGER IF EXISTS group_message_notify ON public."GroupMessage";
CREATE TRIGGER group_message_notify AFTER INSERT ON public."GroupMessage" FOR EACH ROW EXECUTE FUNCTION merkat_private.group_notify();
DROP TRIGGER IF EXISTS group_member_notify ON public."GroupMember";
CREATE TRIGGER group_member_notify AFTER INSERT OR UPDATE OR DELETE ON public."GroupMember" FOR EACH ROW EXECUTE FUNCTION merkat_private.group_notify();
DROP TRIGGER IF EXISTS group_invitation_notify ON public."GroupInvitation";
CREATE TRIGGER group_invitation_notify AFTER INSERT OR UPDATE OR DELETE ON public."GroupInvitation" FOR EACH ROW EXECUTE FUNCTION merkat_private.group_notify();
DROP TRIGGER IF EXISTS group_read_notify ON public."GroupReadState";
CREATE TRIGGER group_read_notify AFTER INSERT OR UPDATE ON public."GroupReadState" FOR EACH ROW EXECUTE FUNCTION merkat_private.group_notify();
DROP TRIGGER IF EXISTS privacy_notify ON public."UserPrivacy";
CREATE TRIGGER privacy_notify AFTER INSERT OR UPDATE ON public."UserPrivacy" FOR EACH ROW EXECUTE FUNCTION merkat_private.group_notify();
DROP TRIGGER IF EXISTS block_notify ON public."UserBlock";
CREATE TRIGGER block_notify AFTER INSERT OR DELETE ON public."UserBlock" FOR EACH ROW EXECUTE FUNCTION merkat_private.group_notify();
COMMIT;
