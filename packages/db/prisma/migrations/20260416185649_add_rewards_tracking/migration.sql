-- CreateEnum
CREATE TYPE "RewardsLedgerEntryType" AS ENUM ('EARNED', 'SPENT');

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "netAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
ADD COLUMN     "rewardsApplied" DECIMAL(65,30) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "RewardsLedgerEntry" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "type" "RewardsLedgerEntryType" NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "transactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RewardsLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RewardsLedgerEntry_accountId_idx" ON "RewardsLedgerEntry"("accountId");

-- CreateIndex
CREATE INDEX "RewardsLedgerEntry_transactionId_idx" ON "RewardsLedgerEntry"("transactionId");

-- AddForeignKey
ALTER TABLE "RewardsLedgerEntry" ADD CONSTRAINT "RewardsLedgerEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardsLedgerEntry" ADD CONSTRAINT "RewardsLedgerEntry_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill existing transactions: set rewardsApplied = 0 and netAmount = amount
UPDATE "Transaction" SET "rewardsApplied" = 0, "netAmount" = "amount" WHERE "rewardsApplied" = 0;
