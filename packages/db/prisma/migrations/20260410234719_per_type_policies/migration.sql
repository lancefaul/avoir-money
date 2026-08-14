/*
  Warnings:

  - You are about to drop the column `dentalPremium` on the `InsurancePolicy` table. All the data in the column will be lost.
  - You are about to drop the column `medicalPremium` on the `InsurancePolicy` table. All the data in the column will be lost.
  - You are about to drop the column `visionPremium` on the `InsurancePolicy` table. All the data in the column will be lost.
  - Added the required column `type` to the `InsurancePolicy` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "PolicyType" AS ENUM ('MEDICAL', 'DENTAL', 'VISION');

-- AlterTable
ALTER TABLE "InsurancePolicy" DROP COLUMN "dentalPremium",
DROP COLUMN "medicalPremium",
DROP COLUMN "visionPremium",
ADD COLUMN     "premium" DECIMAL(65,30) NOT NULL DEFAULT 0,
ADD COLUMN     "type" "PolicyType" NOT NULL,
ALTER COLUMN "deductibleLimit" DROP NOT NULL,
ALTER COLUMN "oopmLimit" DROP NOT NULL;

-- Drop old partial unique index (if exists)
DROP INDEX IF EXISTS "one_active_policy_per_year";

-- Add new partial unique index: one active policy per year per type
CREATE UNIQUE INDEX "one_active_policy_per_year" ON "InsurancePolicy" ("year", "type") WHERE frozen = false;
