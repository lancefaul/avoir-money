-- AlterTable
ALTER TABLE "BudgetVersion" ADD COLUMN     "manualOverride" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "CategoryBudget" ADD COLUMN     "highWaterMark" DECIMAL(65,30) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "BudgetExpenseLink" (
    "id" TEXT NOT NULL,
    "categoryBudgetId" TEXT NOT NULL,
    "expenseId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BudgetExpenseLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BudgetExpenseLink_expenseId_key" ON "BudgetExpenseLink"("expenseId");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetExpenseLink_categoryBudgetId_expenseId_key" ON "BudgetExpenseLink"("categoryBudgetId", "expenseId");

-- AddForeignKey
ALTER TABLE "BudgetExpenseLink" ADD CONSTRAINT "BudgetExpenseLink_categoryBudgetId_fkey" FOREIGN KEY ("categoryBudgetId") REFERENCES "CategoryBudget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetExpenseLink" ADD CONSTRAINT "BudgetExpenseLink_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE CASCADE ON UPDATE CASCADE;
