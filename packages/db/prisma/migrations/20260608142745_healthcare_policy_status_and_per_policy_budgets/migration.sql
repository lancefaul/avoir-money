-- CreateEnum
CREATE TYPE "PolicyStatus" AS ENUM ('ACTIVE', 'ENDED', 'CLOSED');

-- Add new columns first (keep old columns temporarily for data migration)
ALTER TABLE "InsurancePolicy"
ADD COLUMN "budgetId" TEXT,
ADD COLUMN "closedOn" TIMESTAMP(3),
ADD COLUMN "endedOn" TIMESTAMP(3),
ADD COLUMN "status" "PolicyStatus" NOT NULL DEFAULT 'ACTIVE';

-- Data migration: convert frozen → ENDED status
UPDATE "InsurancePolicy"
SET "status" = 'ENDED', "endedOn" = "frozenAt"
WHERE "frozen" = true;

-- Drop old columns
ALTER TABLE "InsurancePolicy" DROP COLUMN "frozen",
DROP COLUMN "frozenAt";

-- AddForeignKey
ALTER TABLE "InsurancePolicy" ADD CONSTRAINT "InsurancePolicy_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE SET NULL ON UPDATE CASCADE;
