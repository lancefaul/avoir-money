-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "purchaseGroupId" TEXT;

-- CreateIndex
CREATE INDEX "Transaction_purchaseGroupId_idx" ON "Transaction"("purchaseGroupId");
