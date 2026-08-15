ALTER TABLE "UtilityReading" ADD COLUMN "expenseId" TEXT;
ALTER TABLE "UtilityReading" ADD CONSTRAINT "UtilityReading_expenseId_fkey"
    FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE SET NULL ON UPDATE CASCADE;
