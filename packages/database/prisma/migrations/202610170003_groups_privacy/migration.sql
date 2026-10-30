-- CreateEnum
CREATE TYPE "GroupRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "InvitationPolicy" AS ENUM ('FRIENDS', 'EVERYONE', 'NOBODY');

-- AlterTable
ALTER TABLE "MessagingRateLimit" ADD COLUMN     "discoveryCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "managedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reportCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ChatGroup" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ownerId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "description" VARCHAR(1000) NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activityAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMPTZ(3),

    CONSTRAINT "ChatGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupMember" (
    "groupId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "GroupRole" NOT NULL DEFAULT 'MEMBER',
    "joinedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMPTZ(3),

    CONSTRAINT "GroupMember_pkey" PRIMARY KEY ("groupId","userId")
);

-- CreateTable
CREATE TABLE "GroupChannel" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "groupId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "position" INTEGER NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "lastSequence" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activityAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "GroupChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupMessage" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "groupId" UUID NOT NULL,
    "channelId" UUID NOT NULL,
    "senderId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "text" VARCHAR(4000) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    "replyToId" UUID,

    CONSTRAINT "GroupMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupReadState" (
    "channelId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "deliveredSequence" INTEGER NOT NULL DEFAULT 0,
    "readSequence" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "GroupReadState_pkey" PRIMARY KEY ("channelId","userId")
);

-- CreateTable
CREATE TABLE "GroupInvitation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "groupId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "invitedBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPrivacy" (
    "userId" UUID NOT NULL,
    "allowNonFriendDms" BOOLEAN NOT NULL DEFAULT true,
    "groupInvitesFrom" "InvitationPolicy" NOT NULL DEFAULT 'FRIENDS',

    CONSTRAINT "UserPrivacy_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "UserBlock" (
    "blockerId" UUID NOT NULL,
    "blockedId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserBlock_pkey" PRIMARY KEY ("blockerId","blockedId")
);

-- CreateTable
CREATE TABLE "SafetyReport" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reporterId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "targetUserId" UUID,
    "targetGroupId" UUID,
    "category" VARCHAR(24) NOT NULL,
    "reason" VARCHAR(1000) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SafetyReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChatGroup_ownerId_idx" ON "ChatGroup"("ownerId");

-- CreateIndex
CREATE INDEX "ChatGroup_activityAt_id_idx" ON "ChatGroup"("activityAt" DESC, "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ChatGroup_createdById_clientId_key" ON "ChatGroup"("createdById", "clientId");

-- CreateIndex
CREATE INDEX "GroupMember_userId_leftAt_groupId_idx" ON "GroupMember"("userId", "leftAt", "groupId");

-- CreateIndex
CREATE INDEX "GroupChannel_groupId_deletedAt_position_idx" ON "GroupChannel"("groupId", "deletedAt", "position");

-- CreateIndex
CREATE UNIQUE INDEX "GroupChannel_groupId_id_key" ON "GroupChannel"("groupId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "GroupChannel_groupId_clientId_key" ON "GroupChannel"("groupId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupChannel_groupId_position_key" ON "GroupChannel"("groupId", "position");

-- CreateIndex
CREATE INDEX "GroupMessage_groupId_senderId_idx" ON "GroupMessage"("groupId", "senderId");

-- CreateIndex
CREATE INDEX "GroupMessage_replyToId_idx" ON "GroupMessage"("replyToId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupMessage_channelId_sequence_key" ON "GroupMessage"("channelId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "GroupMessage_channelId_senderId_clientId_key" ON "GroupMessage"("channelId", "senderId", "clientId");

-- CreateIndex
CREATE INDEX "GroupReadState_userId_channelId_idx" ON "GroupReadState"("userId", "channelId");

-- CreateIndex
CREATE INDEX "GroupInvitation_userId_createdAt_id_idx" ON "GroupInvitation"("userId", "createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "GroupInvitation_invitedBy_idx" ON "GroupInvitation"("invitedBy");

-- CreateIndex
CREATE UNIQUE INDEX "GroupInvitation_groupId_userId_key" ON "GroupInvitation"("groupId", "userId");

-- CreateIndex
CREATE INDEX "UserBlock_blockedId_blockerId_idx" ON "UserBlock"("blockedId", "blockerId");

-- CreateIndex
CREATE INDEX "SafetyReport_targetUserId_idx" ON "SafetyReport"("targetUserId");

-- CreateIndex
CREATE INDEX "SafetyReport_targetGroupId_idx" ON "SafetyReport"("targetGroupId");

-- CreateIndex
CREATE INDEX "SafetyReport_createdAt_id_idx" ON "SafetyReport"("createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SafetyReport_reporterId_clientId_key" ON "SafetyReport"("reporterId", "clientId");

-- AddForeignKey
ALTER TABLE "ChatGroup" ADD CONSTRAINT "ChatGroup_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ChatGroup" ADD CONSTRAINT "ChatGroup_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ChatGroup"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "GroupChannel" ADD CONSTRAINT "GroupChannel_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ChatGroup"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "GroupMessage" ADD CONSTRAINT "GroupMessage_groupId_channelId_fkey" FOREIGN KEY ("groupId", "channelId") REFERENCES "GroupChannel"("groupId", "id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "GroupMessage" ADD CONSTRAINT "GroupMessage_groupId_senderId_fkey" FOREIGN KEY ("groupId", "senderId") REFERENCES "GroupMember"("groupId", "userId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "GroupMessage" ADD CONSTRAINT "GroupMessage_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "GroupMessage"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "GroupReadState" ADD CONSTRAINT "GroupReadState_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "GroupChannel"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "GroupReadState" ADD CONSTRAINT "GroupReadState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "GroupInvitation" ADD CONSTRAINT "GroupInvitation_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ChatGroup"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "GroupInvitation" ADD CONSTRAINT "GroupInvitation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "GroupInvitation" ADD CONSTRAINT "GroupInvitation_invitedBy_fkey" FOREIGN KEY ("invitedBy") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "UserPrivacy" ADD CONSTRAINT "UserPrivacy_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "UserBlock" ADD CONSTRAINT "UserBlock_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "UserBlock" ADD CONSTRAINT "UserBlock_blockedId_fkey" FOREIGN KEY ("blockedId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "SafetyReport" ADD CONSTRAINT "SafetyReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "SafetyReport" ADD CONSTRAINT "SafetyReport_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "SafetyReport" ADD CONSTRAINT "SafetyReport_targetGroupId_fkey" FOREIGN KEY ("targetGroupId") REFERENCES "ChatGroup"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Additional database invariants; append to the generated additive migration.
ALTER TABLE public."MessagingRateLimit" ADD CONSTRAINT "MessagingRateLimit_social_counts_check" CHECK ("discoveryCount" BETWEEN 0 AND 30 AND "managedCount" BETWEEN 0 AND 30 AND "reportCount" BETWEEN 0 AND 5);
ALTER TABLE public."ChatGroup" ADD CONSTRAINT "ChatGroup_name_check" CHECK (length(btrim(name)) BETWEEN 1 AND 80);
ALTER TABLE public."GroupChannel" ADD CONSTRAINT "GroupChannel_state_check" CHECK (length(btrim(name)) BETWEEN 1 AND 60 AND position >= 0 AND "lastSequence" >= 0 AND (NOT "isDefault" OR "deletedAt" IS NULL));
CREATE UNIQUE INDEX "GroupChannel_default_key" ON public."GroupChannel" ("groupId") WHERE "isDefault";
CREATE UNIQUE INDEX "GroupChannel_active_name_key" ON public."GroupChannel" ("groupId", lower(name)) WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "GroupMember_owner_key" ON public."GroupMember" ("groupId") WHERE role = 'OWNER' AND "leftAt" IS NULL;
ALTER TABLE public."GroupMessage" ADD CONSTRAINT "GroupMessage_content_check" CHECK (length(btrim(text, E' \n\r\t')) > 0 AND octet_length(text) <= 16000 AND sequence > 0 AND "replyToId" IS DISTINCT FROM id);
ALTER TABLE public."GroupReadState" ADD CONSTRAINT "GroupReadState_bounds_check" CHECK ("readSequence" >= 0 AND "deliveredSequence" >= "readSequence");
ALTER TABLE public."UserBlock" ADD CONSTRAINT "UserBlock_not_self_check" CHECK ("blockerId" <> "blockedId");
ALTER TABLE public."SafetyReport" ADD CONSTRAINT "SafetyReport_target_check" CHECK (("targetUserId" IS NULL) <> ("targetGroupId" IS NULL));
ALTER TABLE public."SafetyReport" ADD CONSTRAINT "SafetyReport_content_check" CHECK (category IN ('SPAM', 'HARASSMENT', 'OTHER') AND length(btrim(reason)) > 0 AND octet_length(reason) <= 4000);

CREATE FUNCTION merkat_private.group_integrity() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE gid uuid;
DECLARE g public."ChatGroup";
BEGIN
  IF TG_TABLE_NAME = 'ChatGroup' THEN gid := COALESCE(NEW.id, OLD.id);
  ELSE gid := COALESCE(NEW."groupId", OLD."groupId"); END IF;
  SELECT * INTO g FROM public."ChatGroup" WHERE id = gid;
  IF g.id IS NOT NULL AND g."archivedAt" IS NULL THEN
    IF (SELECT count(*) FROM public."GroupMember" WHERE "groupId"=gid AND role='OWNER' AND "leftAt" IS NULL) <> 1
      OR NOT EXISTS (SELECT 1 FROM public."GroupMember" WHERE "groupId"=gid AND "userId"=g."ownerId" AND role='OWNER' AND "leftAt" IS NULL)
      OR (SELECT count(*) FROM public."GroupMember" WHERE "groupId"=gid AND "leftAt" IS NULL) > 100
      OR (SELECT count(*) FROM public."GroupChannel" WHERE "groupId"=gid AND "deletedAt" IS NULL) > 20
      OR (SELECT count(*) FROM public."GroupChannel" WHERE "groupId"=gid AND "isDefault" AND "deletedAt" IS NULL) <> 1 THEN
      RAISE EXCEPTION 'Invalid group membership or channels' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER group_integrity AFTER INSERT OR UPDATE ON public."ChatGroup" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION merkat_private.group_integrity();
CREATE CONSTRAINT TRIGGER group_member_integrity AFTER INSERT OR UPDATE OR DELETE ON public."GroupMember" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION merkat_private.group_integrity();
CREATE CONSTRAINT TRIGGER group_channel_integrity AFTER INSERT OR UPDATE OR DELETE ON public."GroupChannel" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION merkat_private.group_integrity();

CREATE FUNCTION merkat_private.group_member_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  PERFORM 1 FROM public."ChatGroup" WHERE id=COALESCE(NEW."groupId", OLD."groupId") FOR UPDATE;
  IF TG_OP='UPDATE' AND (NEW."groupId",NEW."userId") IS DISTINCT FROM (OLD."groupId",OLD."userId") THEN RAISE EXCEPTION 'Immutable membership identity' USING ERRCODE='23514'; END IF;
  RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER group_member_guard BEFORE INSERT OR UPDATE OR DELETE ON public."GroupMember" FOR EACH ROW EXECUTE FUNCTION merkat_private.group_member_guard();

CREATE FUNCTION merkat_private.group_message_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE tail integer;
BEGIN
  IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'Messages are immutable' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM public."ChatGroup" WHERE id=NEW."groupId" AND "archivedAt" IS NULL FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public."GroupMember" WHERE "groupId"=NEW."groupId" AND "userId"=NEW."senderId" AND "leftAt" IS NULL) THEN RAISE EXCEPTION 'Inactive group sender' USING ERRCODE='23514'; END IF;
  SELECT "lastSequence" INTO tail FROM public."GroupChannel" WHERE id=NEW."channelId" AND "groupId"=NEW."groupId" AND "deletedAt" IS NULL;
  IF tail IS NULL OR NEW.sequence<>tail OR (NEW."replyToId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public."GroupMessage" WHERE id=NEW."replyToId" AND "channelId"=NEW."channelId")) THEN RAISE EXCEPTION 'Invalid message sequence or reply' USING ERRCODE='23514'; END IF;
  NEW."createdAt" := clock_timestamp();
  RETURN NEW;
END $$;
CREATE TRIGGER group_message_guard BEFORE INSERT OR UPDATE ON public."GroupMessage" FOR EACH ROW EXECUTE FUNCTION merkat_private.group_message_guard();

CREATE FUNCTION merkat_private.group_read_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE gid uuid;
DECLARE tail integer;
BEGIN
  SELECT "groupId", "lastSequence" INTO gid,tail FROM public."GroupChannel" WHERE id=NEW."channelId";
  PERFORM 1 FROM public."ChatGroup" WHERE id=gid FOR UPDATE;
  IF tail IS NULL OR NEW."deliveredSequence">tail OR NOT EXISTS (SELECT 1 FROM public."GroupMember" WHERE "groupId"=gid AND "userId"=NEW."userId" AND "leftAt" IS NULL) THEN RAISE EXCEPTION 'Invalid group receipt' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND ((NEW."channelId",NEW."userId") IS DISTINCT FROM (OLD."channelId",OLD."userId") OR NEW."readSequence"<OLD."readSequence" OR NEW."deliveredSequence"<OLD."deliveredSequence") THEN RAISE EXCEPTION 'Invalid group receipt update' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER group_read_guard BEFORE INSERT OR UPDATE ON public."GroupReadState" FOR EACH ROW EXECUTE FUNCTION merkat_private.group_read_guard();

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['ChatGroup','GroupMember','GroupChannel','GroupMessage','GroupReadState','GroupInvitation','UserPrivacy','UserBlock','SafetyReport'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC',t);
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON public.%I FROM anon',t); END IF;
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE format('REVOKE ALL ON public.%I FROM authenticated',t); END IF;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION merkat_private.group_integrity(), merkat_private.group_member_guard(), merkat_private.group_message_guard(), merkat_private.group_read_guard() FROM PUBLIC;
