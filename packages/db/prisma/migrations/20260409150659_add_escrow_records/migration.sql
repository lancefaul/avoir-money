-- AlterTable
ALTER TABLE "Debt" ADD COLUMN     "escrowEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "EscrowRecord" (
    "id" TEXT NOT NULL,
    "debtId" TEXT NOT NULL,
    "monthlyAmount" DECIMAL(65,30) NOT NULL,
    "periodStartDate" TIMESTAMP(3) NOT NULL,
    "periodEndDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EscrowRecord_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "EscrowRecord" ADD CONSTRAINT "EscrowRecord_debtId_fkey" FOREIGN KEY ("debtId") REFERENCES "Debt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
