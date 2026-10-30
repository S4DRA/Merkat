ALTER TABLE "Plan" ADD CONSTRAINT "Plan_directId_fkey" FOREIGN KEY("directId") REFERENCES "DirectConversation"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 ADD CONSTRAINT "Plan_groupId_fkey" FOREIGN KEY("groupId") REFERENCES "ChatGroup"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 ADD CONSTRAINT "Plan_groupId_channelId_fkey" FOREIGN KEY("groupId","channelId") REFERENCES "GroupChannel"("groupId",id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "TabSession" ADD CONSTRAINT "TabSession_directId_fkey" FOREIGN KEY("directId") REFERENCES "DirectConversation"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 ADD CONSTRAINT "TabSession_groupId_fkey" FOREIGN KEY("groupId") REFERENCES "ChatGroup"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 ADD CONSTRAINT "TabSession_groupId_channelId_fkey" FOREIGN KEY("groupId","channelId") REFERENCES "GroupChannel"("groupId",id) ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE FUNCTION validate_feature_reference() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE d uuid;g uuid;c uuid;BEGIN
 IF TG_OP='UPDATE' AND (NEW."planId" IS DISTINCT FROM OLD."planId" OR NEW."tabId" IS DISTINCT FROM OLD."tabId") THEN RAISE EXCEPTION 'Activity references are immutable';END IF;
 IF NEW."planId" IS NOT NULL THEN SELECT "directId","groupId","channelId" INTO d,g,c FROM "Plan" WHERE id=NEW."planId";
 ELSIF NEW."tabId" IS NOT NULL THEN SELECT "directId","groupId","channelId" INTO d,g,c FROM "TabSession" WHERE id=NEW."tabId";
 ELSE RETURN NEW;END IF;
 IF TG_TABLE_NAME='DirectMessage' THEN IF d IS NULL OR d<>NEW."conversationId" THEN RAISE EXCEPTION 'Cross-conversation activity';END IF;
 ELSE IF g IS NULL OR g<>NEW."groupId" OR c<>NEW."channelId" THEN RAISE EXCEPTION 'Cross-channel activity';END IF;END IF;
 RETURN NEW;END $$;
CREATE TRIGGER validate_feature_reference BEFORE INSERT OR UPDATE ON "DirectMessage" FOR EACH ROW EXECUTE FUNCTION validate_feature_reference();
CREATE TRIGGER validate_feature_reference BEFORE INSERT OR UPDATE ON "GroupMessage" FOR EACH ROW EXECUTE FUNCTION validate_feature_reference();
CREATE FUNCTION validate_push_identity() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM "Session" s WHERE s.id=NEW."sessionId" AND s."userId"=NEW."userId") THEN RAISE EXCEPTION 'Invalid push identity';END IF;RETURN NEW;END $$;
CREATE TRIGGER validate_push_identity BEFORE INSERT OR UPDATE ON "PushSubscription" FOR EACH ROW EXECUTE FUNCTION validate_push_identity();
