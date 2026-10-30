-- Dedicated Merkat project only, after Prisma migrations and realtime.sql.
-- Create merkat_runtime separately with a generated server-only password.
-- This role represents the trusted Next.js backend, never a browser JWT role.
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'merkat_runtime'
      AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolbypassrls
  ) THEN RAISE EXCEPTION 'Expected an unprivileged merkat_runtime role'; END IF;
END $$;

GRANT USAGE ON SCHEMA public, merkat_private, realtime TO merkat_runtime;
REVOKE CREATE ON SCHEMA public FROM merkat_runtime;
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'User', 'Profile', 'ExternalIdentity', 'Session', 'PasswordCredential',
    'AuthRateLimit', 'Plan', 'PlanParticipant', 'DirectConversation',
    'DirectParticipant', 'DirectMessage', 'MessagingRateLimit', 'Friendship'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = table_name AND c.relrowsecurity
        AND pg_get_userbyid(c.relowner) <> 'merkat_runtime'
    ) THEN RAISE EXCEPTION 'Expected RLS and separate ownership on %', table_name; END IF;
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', table_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO merkat_runtime', table_name);
    EXECUTE format('DROP POLICY IF EXISTS merkat_server ON public.%I', table_name);
    EXECUTE format('CREATE POLICY merkat_server ON public.%I FOR ALL TO merkat_runtime USING (true) WITH CHECK (true)', table_name);
  END LOOP;
END $$;
-- Migration metadata is never an application/browser API.
ALTER TABLE public._prisma_migrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public._prisma_migrations FROM PUBLIC, anon, authenticated, merkat_runtime;
-- Some new projects include this platform event-trigger helper in public.
-- Keep the event trigger while removing unnecessary browser RPC execution.
DO $$ BEGIN
  IF to_regprocedure('public.rls_auto_enable()') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
  END IF;
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA merkat_private TO merkat_runtime;
GRANT EXECUTE ON FUNCTION realtime.send(jsonb, text, text, boolean) TO merkat_runtime;
GRANT INSERT ON realtime.messages TO merkat_runtime;
DROP POLICY IF EXISTS merkat_server_broadcast ON realtime.messages;
CREATE POLICY merkat_server_broadcast ON realtime.messages FOR INSERT TO merkat_runtime
WITH CHECK (
  private AND extension = 'broadcast' AND event = 'changed'
  AND payload - 'id' = '{}'::jsonb
  AND topic ~ '^merkat:user:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
);
-- Additive application features, including when the runtime role is created
-- after their migrations. Never grant report reads or browser privileges.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['ProfileAvatar','UserSettings','TabSession','PlanReminder','Notification','RecoveryCode','PushSubscription','PushDelivery','GroupAvatar'] LOOP
  IF to_regclass(format('public.%I',t)) IS NOT NULL THEN
   EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO merkat_runtime',t);
   IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname='merkat_runtime') THEN
    EXECUTE format('CREATE POLICY merkat_runtime ON public.%I TO merkat_runtime USING(true) WITH CHECK(true)',t);
   END IF;
  END IF;
 END LOOP;
END $$;
COMMIT;
