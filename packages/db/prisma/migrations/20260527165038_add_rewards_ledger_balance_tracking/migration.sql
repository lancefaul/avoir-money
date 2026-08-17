-- AlterTable
ALTER TABLE "RewardsLedgerEntry" ADD COLUMN     "balanceAfter" DECIMAL(65,30),
ADD COLUMN     "balanceBefore" DECIMAL(65,30);
