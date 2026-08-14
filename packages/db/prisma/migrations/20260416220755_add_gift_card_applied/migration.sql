-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "giftCardAccountId" TEXT,
ADD COLUMN     "giftCardApplied" DECIMAL(65,30) NOT NULL DEFAULT 0;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_giftCardAccountId_fkey" FOREIGN KEY ("giftCardAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
