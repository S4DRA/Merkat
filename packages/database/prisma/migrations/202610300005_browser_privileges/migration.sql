-- Supabase default privileges can grant new tables directly to browser roles.
-- RLS is kept, and privileges not subject to RLS (for example TRUNCATE) are revoked too.
DO $$ DECLARE r text; t text; BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
   FOREACH t IN ARRAY ARRAY['ProfileAvatar','UserSettings','TabSession','PlanReminder','Notification','RecoveryCode','PushSubscription','PushDelivery'] LOOP
    EXECUTE format('REVOKE ALL ON %I FROM %I',t,r);
   END LOOP;
  END IF;
 END LOOP;
END $$;
