/*
  Warnings:

  - You are about to drop the column `accountName` on the `InvestmentHolding` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "InvestmentHolding" DROP COLUMN "accountName",
ADD COLUMN     "custodianId" TEXT,
ADD COLUMN     "walletId" TEXT;

-- AddForeignKey
ALTER TABLE "InvestmentHolding" ADD CONSTRAINT "InvestmentHolding_custodianId_fkey" FOREIGN KEY ("custodianId") REFERENCES "Custodian"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestmentHolding" ADD CONSTRAINT "InvestmentHolding_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
