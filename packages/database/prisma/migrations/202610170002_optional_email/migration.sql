-- User-requested optional email, kept private and unverified. Username remains the login identity.
ALTER TABLE "User" ADD COLUMN "email" VARCHAR(254);
ALTER TABLE "User" ADD CONSTRAINT "User_optional_email_check"
CHECK ("email" IS NULL OR (length("email") > 0 AND "email" = lower(btrim("email")) AND position('@' IN "email") > 1));
COMMENT ON COLUMN "User"."email" IS 'Optional unverified contact email. Not a login, recovery or trusted identity claim.';
-- Preserve historical usernames; reserve the new route name for future registrations/renames.
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_friends_reserved_check" CHECK ("username" IS DISTINCT FROM 'friends') NOT VALID;
