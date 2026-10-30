-- Additive Phase 4 migration. Existing users/identities/sessions are not changed.
CREATE TABLE "PasswordCredential" (
    "userId" UUID NOT NULL,
    "passwordHash" VARCHAR(255) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PasswordCredential_pkey" PRIMARY KEY ("userId"),
    CONSTRAINT "PasswordCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE RESTRICT,
    CONSTRAINT "PasswordCredential_argon2id" CHECK (
      split_part("passwordHash", '$', 2) = 'argon2id' AND
      split_part("passwordHash", '$', 3) = 'v=19' AND
      split_part("passwordHash", '$', 4) IN ('m=19456,t=2,p=1', 'm=19456,p=1,t=2')
    )
);

-- Existing lowercase-format CHECK + unique index remain. Make the insensitive
-- uniqueness requirement explicit without rewriting or renaming legacy profiles.
CREATE UNIQUE INDEX "Profile_username_case_insensitive_key" ON "Profile" (lower("username")) WHERE "username" IS NOT NULL;
-- NOT VALID preserves any existing reserved legacy names. New/updated values
-- are checked immediately; no user data is silently rewritten.
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_username_reserved" CHECK (
  "username" IS NULL OR "username" NOT IN (
    'admin', 'administrator', 'root', 'system', 'support', 'security', 'merkat',
    'api', 'auth', 'login', 'logout', 'register', 'signup', 'onboarding',
    'settings', 'profile', 'search', 'chats', 'calls', 'plans', 'groups'
  )
) NOT VALID;

CREATE TABLE "AuthRateLimit" (
    "scope" VARCHAR(24) NOT NULL,
    "slot" INTEGER NOT NULL,
    "attempts" INTEGER NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "AuthRateLimit_pkey" PRIMARY KEY ("scope", "slot"),
    CONSTRAINT "AuthRateLimit_scope" CHECK ("scope" IN ('login-account', 'login-source', 'login-global', 'register-account', 'register-source', 'register-global')),
    CONSTRAINT "AuthRateLimit_slot" CHECK ("slot" BETWEEN 0 AND 65535 AND ("scope" NOT IN ('login-global', 'register-global') OR "slot" = 0)),
    CONSTRAINT "AuthRateLimit_attempts" CHECK ("attempts" BETWEEN 1 AND 121)
);

-- API-only tables. No anonymous/Supabase-Auth access policy is introduced.
ALTER TABLE "PasswordCredential" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuthRateLimit" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "PasswordCredential", "AuthRateLimit" FROM PUBLIC;
