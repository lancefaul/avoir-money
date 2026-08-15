-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "toBalanceAfter" DECIMAL(65,30),
ADD COLUMN     "toBalanceBefore" DECIMAL(65,30);
