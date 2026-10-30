-- CreateEnum
CREATE TYPE "PlanResponse" AS ENUM ('INVITED', 'GOING', 'MAYBE', 'DECLINED');

-- CreateTable
CREATE TABLE "Plan" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ownerId" UUID NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "description" VARCHAR(2000) NOT NULL DEFAULT '',
    "location" VARCHAR(200) NOT NULL DEFAULT '',
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "conversationId" VARCHAR(512),
    "cancelled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanParticipant" (
    "planId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "response" "PlanResponse" NOT NULL DEFAULT 'INVITED',

    CONSTRAINT "PlanParticipant_pkey" PRIMARY KEY ("planId","userId")
);

-- CreateIndex
CREATE INDEX "Plan_ownerId_startsAt_idx" ON "Plan"("ownerId", "startsAt");

-- CreateIndex
CREATE INDEX "PlanParticipant_userId_planId_idx" ON "PlanParticipant"("userId", "planId");

-- AddForeignKey
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "PlanParticipant" ADD CONSTRAINT "PlanParticipant_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "PlanParticipant" ADD CONSTRAINT "PlanParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

ALTER TABLE "Plan" ADD CONSTRAINT "Plan_valid_time" CHECK ("endsAt" > "startsAt");
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_nonempty_title" CHECK (length(trim("title")) > 0);
-- API-only tables. No Data API access policy: Merkat sessions own authorization.
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Profile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ExternalIdentity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Session" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Plan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PlanParticipant" ENABLE ROW LEVEL SECURITY;
