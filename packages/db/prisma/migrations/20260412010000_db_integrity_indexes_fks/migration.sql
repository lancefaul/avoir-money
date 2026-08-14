-- DropForeignKey
ALTER TABLE "BalanceSnapshot" DROP CONSTRAINT "BalanceSnapshot_payPeriodId_fkey";

-- DropForeignKey
ALTER TABLE "InvestmentSnapshot" DROP CONSTRAINT "InvestmentSnapshot_holdingId_fkey";

-- DropForeignKey
ALTER TABLE "PayPeriod" DROP CONSTRAINT "PayPeriod_scheduleId_fkey";

-- DropForeignKey
ALTER TABLE "ScheduledTransaction" DROP CONSTRAINT "ScheduledTransaction_expenseId_fkey";

-- DropForeignKey
ALTER TABLE "ScheduledTransaction" DROP CONSTRAINT "ScheduledTransaction_incomeId_fkey";

-- DropForeignKey
ALTER TABLE "Transaction" DROP CONSTRAINT "Transaction_accountId_fkey";

-- DropForeignKey
ALTER TABLE "Transaction" DROP CONSTRAINT "Transaction_parentId_fkey";

-- DropForeignKey
ALTER TABLE "UtilityLink" DROP CONSTRAINT "UtilityLink_expenseId_fkey";

-- CreateIndex
CREATE INDEX "Account_archived_idx" ON "Account"("archived");

-- CreateIndex
CREATE INDEX "PayPeriod_startDate_idx" ON "PayPeriod"("startDate");

-- CreateIndex
CREATE INDEX "PayPeriod_endDate_idx" ON "PayPeriod"("endDate");

-- CreateIndex
CREATE INDEX "Transaction_date_idx" ON "Transaction"("date");

-- CreateIndex
CREATE INDEX "Transaction_payPeriodId_idx" ON "Transaction"("payPeriodId");

-- CreateIndex
CREATE INDEX "Transaction_expenseId_idx" ON "Transaction"("expenseId");

-- CreateIndex
CREATE INDEX "Transaction_incomeId_idx" ON "Transaction"("incomeId");

-- CreateIndex
CREATE INDEX "Transaction_budgetId_idx" ON "Transaction"("budgetId");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayPeriod" ADD CONSTRAINT "PayPeriod_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "PaySchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BalanceSnapshot" ADD CONSTRAINT "BalanceSnapshot_payPeriodId_fkey" FOREIGN KEY ("payPeriodId") REFERENCES "PayPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UtilityLink" ADD CONSTRAINT "UtilityLink_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestmentSnapshot" ADD CONSTRAINT "InvestmentSnapshot_holdingId_fkey" FOREIGN KEY ("holdingId") REFERENCES "InvestmentHolding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestmentTransfer" ADD CONSTRAINT "InvestmentTransfer_fromHoldingId_fkey" FOREIGN KEY ("fromHoldingId") REFERENCES "InvestmentHolding"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestmentTransfer" ADD CONSTRAINT "InvestmentTransfer_toHoldingId_fkey" FOREIGN KEY ("toHoldingId") REFERENCES "InvestmentHolding"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledTransaction" ADD CONSTRAINT "ScheduledTransaction_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledTransaction" ADD CONSTRAINT "ScheduledTransaction_incomeId_fkey" FOREIGN KEY ("incomeId") REFERENCES "Income"("id") ON DELETE CASCADE ON UPDATE CASCADE;
