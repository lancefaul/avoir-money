-- CreateEnum
CREATE TYPE "ScheduleStatus" AS ENUM ('PENDING', 'PAID', 'PARTIAL', 'SKIPPED', 'SNOOZED');

-- CreateEnum
CREATE TYPE "ScheduleSourceType" AS ENUM ('EXPENSE', 'INCOME');

-- CreateTable
CREATE TABLE "ScheduledTransaction" (
    "id" TEXT NOT NULL,
    "sourceType" "ScheduleSourceType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "expectedAmount" DECIMAL(65,30) NOT NULL,
    "actualAmount" DECIMAL(65,30),
    "status" "ScheduleStatus" NOT NULL DEFAULT 'PENDING',
    "transactionId" TEXT,
    "snoozedUntil" TIMESTAMP(3),
    "note" TEXT,
    "expenseId" TEXT,
    "incomeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledTransaction_transactionId_key" ON "ScheduledTransaction"("transactionId");

-- CreateIndex
CREATE INDEX "ScheduledTransaction_sourceType_sourceId_status_idx" ON "ScheduledTransaction"("sourceType", "sourceId", "status");

-- CreateIndex
CREATE INDEX "ScheduledTransaction_dueDate_idx" ON "ScheduledTransaction"("dueDate");

-- CreateIndex
CREATE INDEX "ScheduledTransaction_status_idx" ON "ScheduledTransaction"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledTransaction_sourceType_sourceId_dueDate_key" ON "ScheduledTransaction"("sourceType", "sourceId", "dueDate");

-- AddForeignKey
ALTER TABLE "ScheduledTransaction" ADD CONSTRAINT "ScheduledTransaction_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledTransaction" ADD CONSTRAINT "ScheduledTransaction_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledTransaction" ADD CONSTRAINT "ScheduledTransaction_incomeId_fkey" FOREIGN KEY ("incomeId") REFERENCES "Income"("id") ON DELETE SET NULL ON UPDATE CASCADE;
