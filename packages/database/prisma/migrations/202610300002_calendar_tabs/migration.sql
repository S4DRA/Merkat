ALTER TABLE "Plan" ADD COLUMN "directId" uuid, ADD COLUMN "groupId" uuid, ADD COLUMN "channelId" uuid,
  ADD COLUMN "clientId" uuid, ADD COLUMN timezone varchar(80) NOT NULL DEFAULT 'Europe/Istanbul', ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0),
  ADD CONSTRAINT plan_scope CHECK (("directId" IS NULL OR "groupId" IS NULL) AND (("groupId" IS NULL AND "channelId" IS NULL) OR ("groupId" IS NOT NULL AND "channelId" IS NOT NULL)));
CREATE UNIQUE INDEX "Plan_ownerId_clientId_key" ON "Plan"("ownerId","clientId");
CREATE INDEX "Plan_directId_startsAt_idx" ON "Plan"("directId","startsAt");
CREATE INDEX "Plan_groupId_startsAt_idx" ON "Plan"("groupId","startsAt");
ALTER TABLE "PlanParticipant" ADD COLUMN subscribed boolean NOT NULL DEFAULT false;
UPDATE "PlanParticipant" SET subscribed=true WHERE response='GOING';
CREATE TABLE "TabSession" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "createdBy" uuid NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  "clientId" uuid NOT NULL, "directId" uuid, "groupId" uuid, "channelId" uuid,
  title varchar(100) NOT NULL CHECK(length(trim(title))>0), currency char(3) NOT NULL DEFAULT 'TRY' CHECK(currency IN ('TRY','EUR','USD','GBP')),
  state jsonb NOT NULL CHECK(jsonb_typeof(state)='object'), version integer NOT NULL DEFAULT 1 CHECK(version>0),
  "createdAt" timestamptz(3) NOT NULL DEFAULT now(), "closedAt" timestamptz(3),
  CONSTRAINT tab_scope CHECK (("directId" IS NOT NULL AND "groupId" IS NULL AND "channelId" IS NULL) OR ("directId" IS NULL AND "groupId" IS NOT NULL AND "channelId" IS NOT NULL)),
  UNIQUE("createdBy","clientId")
);
CREATE INDEX "TabSession_directId_createdAt_idx" ON "TabSession"("directId","createdAt");
CREATE INDEX "TabSession_groupId_createdAt_idx" ON "TabSession"("groupId","createdAt");
CREATE UNIQUE INDEX tab_one_active_dm ON "TabSession"("directId") WHERE "closedAt" IS NULL AND "directId" IS NOT NULL;
CREATE UNIQUE INDEX tab_one_active_group ON "TabSession"("groupId") WHERE "closedAt" IS NULL AND "groupId" IS NOT NULL;
CREATE TABLE "PlanReminder" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "planId" uuid NOT NULL REFERENCES "Plan"(id) ON DELETE CASCADE ON UPDATE RESTRICT,
  "userId" uuid NOT NULL REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE RESTRICT,
  version integer NOT NULL, "hoursBefore" integer NOT NULL CHECK("hoursBefore" IN(24,5)), "dueAt" timestamptz(3) NOT NULL,
  state varchar(12) NOT NULL DEFAULT 'PENDING' CHECK(state IN('PENDING','DELIVERED','CANCELLED')), UNIQUE("planId","userId",version,"hoursBefore")
);
CREATE INDEX "PlanReminder_state_dueAt_idx" ON "PlanReminder"(state,"dueAt");
CREATE TABLE "Notification" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "userId" uuid NOT NULL REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE RESTRICT,
  "planId" uuid REFERENCES "Plan"(id) ON DELETE CASCADE ON UPDATE RESTRICT, "dedupeKey" varchar(200) UNIQUE NOT NULL,
  title varchar(160) NOT NULL, body varchar(400) NOT NULL, href varchar(300) NOT NULL CHECK(href LIKE '/plans?event=%'),
  "createdAt" timestamptz(3) NOT NULL DEFAULT now(), "readAt" timestamptz(3)
);
CREATE INDEX "Notification_userId_createdAt_id_idx" ON "Notification"("userId","createdAt" DESC,id DESC);
ALTER TABLE "DirectMessage" ADD COLUMN "planId" uuid REFERENCES "Plan"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD COLUMN "tabId" uuid REFERENCES "TabSession"(id) ON DELETE RESTRICT ON UPDATE RESTRICT, ADD CHECK("planId" IS NULL OR "tabId" IS NULL);
ALTER TABLE "GroupMessage" ADD COLUMN "planId" uuid REFERENCES "Plan"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD COLUMN "tabId" uuid REFERENCES "TabSession"(id) ON DELETE RESTRICT ON UPDATE RESTRICT, ADD CHECK("planId" IS NULL OR "tabId" IS NULL);
CREATE FUNCTION enforce_closed_tab() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$ BEGIN
  IF NEW.version<>OLD.version+1 OR NEW."createdBy"<>OLD."createdBy" OR NEW."clientId"<>OLD."clientId" OR NEW."directId" IS DISTINCT FROM OLD."directId" OR NEW."groupId" IS DISTINCT FROM OLD."groupId" OR NEW."channelId" IS DISTINCT FROM OLD."channelId" OR NEW.currency<>OLD.currency THEN RAISE EXCEPTION 'Invalid tab mutation'; END IF;
  IF OLD."closedAt" IS NOT NULL AND (NEW."closedAt" IS DISTINCT FROM OLD."closedAt" OR NEW.state->'orders' IS DISTINCT FROM OLD.state->'orders' OR NEW.state->'payments' IS DISTINCT FROM OLD.state->'payments' OR NEW.state->'snapshot' IS DISTINCT FROM OLD.state->'snapshot' OR NEW.state->'participants' IS DISTINCT FROM OLD.state->'participants') THEN RAISE EXCEPTION 'Closed expenses are immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER enforce_closed_tab BEFORE UPDATE ON "TabSession" FOR EACH ROW EXECUTE FUNCTION enforce_closed_tab();
ALTER TABLE "TabSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PlanReminder" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "TabSession", "PlanReminder", "Notification" FROM PUBLIC;
DO $$ DECLARE t text; BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='merkat_runtime') THEN
    FOREACH t IN ARRAY ARRAY['TabSession','PlanReminder','Notification'] LOOP
      EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO merkat_runtime',t);
      EXECUTE format('CREATE POLICY merkat_runtime ON %I TO merkat_runtime USING(true) WITH CHECK(true)',t);
    END LOOP;
  END IF;
END $$;
