-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "BudgetFrequency" AS ENUM ('WEEKLY', 'BIWEEKLY', 'MONTHLY', 'YEARLY');

-- CreateTable
CREATE TABLE "YearPlan" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "status" "PlanStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "YearPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CategoryBudget" (
    "id" TEXT NOT NULL,
    "yearPlanId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "removedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CategoryBudget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetVersion" (
    "id" TEXT NOT NULL,
    "categoryBudgetId" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "frequency" "BudgetFrequency" NOT NULL,
    "monthlyEquivalent" DECIMAL(65,30) NOT NULL,
    "activeMonths" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BudgetVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "YearPlan_year_key" ON "YearPlan"("year");

-- CreateIndex
CREATE UNIQUE INDEX "CategoryBudget_yearPlanId_categoryId_key" ON "CategoryBudget"("yearPlanId", "categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetVersion_categoryBudgetId_effectiveDate_key" ON "BudgetVersion"("categoryBudgetId", "effectiveDate");

-- AddForeignKey
ALTER TABLE "CategoryBudget" ADD CONSTRAINT "CategoryBudget_yearPlanId_fkey" FOREIGN KEY ("yearPlanId") REFERENCES "YearPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryBudget" ADD CONSTRAINT "CategoryBudget_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetVersion" ADD CONSTRAINT "BudgetVersion_categoryBudgetId_fkey" FOREIGN KEY ("categoryBudgetId") REFERENCES "CategoryBudget"("id") ON DELETE CASCADE ON UPDATE CASCADE;
