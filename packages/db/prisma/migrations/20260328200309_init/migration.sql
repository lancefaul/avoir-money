-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('CHECKING', 'SAVINGS', 'CREDIT_CARD', 'INVESTMENT', 'CRYPTO');

-- CreateEnum
CREATE TYPE "CategoryGroup" AS ENUM ('INCOME', 'HOUSING', 'TRANSPORTATION', 'INSURANCE', 'UTILITIES', 'HEALTHCARE', 'INVESTMENTS', 'DEBT', 'DISCRETIONARY', 'GIVING', 'TAXES', 'CUSTOM');

-- CreateEnum
CREATE TYPE "Frequency" AS ENUM ('ONE_TIME', 'WEEKLY', 'BIWEEKLY', 'SEMI_MONTHLY', 'MONTHLY', 'QUARTERLY', 'ANNUAL');

-- CreateEnum
CREATE TYPE "PayScheduleType" AS ENUM ('WEEKLY', 'BIWEEKLY', 'SEMI_MONTHLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "UtilityType" AS ENUM ('ELECTRIC', 'GAS', 'WATER', 'SEWAGE', 'GARBAGE', 'INTERNET', 'PHONE', 'PEST_CONTROL');

-- CreateEnum
CREATE TYPE "InvestmentType" AS ENUM ('STOCK', 'CRYPTO', 'ETF', 'MUTUAL_FUND', 'OTHER');

-- CreateEnum
CREATE TYPE "GoalType" AS ENUM ('SAVINGS', 'DEBT_PAYOFF', 'INVESTMENT', 'SPENDING_LIMIT', 'CUSTOM');

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "balance" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "group" "CategoryGroup" NOT NULL,
    "color" TEXT,
    "icon" TEXT,
    "isCustom" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Income" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "frequency" "Frequency" NOT NULL,
    "categoryId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Income_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "frequency" "Frequency" NOT NULL,
    "categoryId" TEXT NOT NULL,
    "accountId" TEXT,
    "isAutomatic" BOOLEAN NOT NULL DEFAULT false,
    "dueDay" INTEGER,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "payPeriodId" TEXT,
    "expenseId" TEXT,
    "incomeId" TEXT,
    "accountId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaySchedule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Primary',
    "type" "PayScheduleType" NOT NULL DEFAULT 'BIWEEKLY',
    "anchorDate" TIMESTAMP(3) NOT NULL,
    "firstPayDay" INTEGER,
    "secondPayDay" INTEGER,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaySchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayPeriod" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "payDate" TIMESTAMP(3) NOT NULL,
    "year" INTEGER NOT NULL,
    "periodNum" INTEGER NOT NULL,

    CONSTRAINT "PayPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BalanceSnapshot" (
    "id" TEXT NOT NULL,
    "payPeriodId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "openingBalance" DECIMAL(65,30) NOT NULL,
    "closingBalance" DECIMAL(65,30) NOT NULL,
    "totalIncome" DECIMAL(65,30) NOT NULL,
    "totalExpenses" DECIMAL(65,30) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BalanceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UtilityReading" (
    "id" TEXT NOT NULL,
    "type" "UtilityType" NOT NULL,
    "billDate" TIMESTAMP(3) NOT NULL,
    "usage" DECIMAL(65,30),
    "cost" DECIMAL(65,30) NOT NULL,
    "unitCost" DECIMAL(65,30),
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UtilityReading_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HealthcareYear" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "employer" TEXT NOT NULL,
    "medicalPremium" DECIMAL(65,30) NOT NULL,
    "medicalDeductible" DECIMAL(65,30) NOT NULL,
    "medicalOOPM" DECIMAL(65,30) NOT NULL,
    "dentalPremium" DECIMAL(65,30) NOT NULL,
    "visionPremium" DECIMAL(65,30) NOT NULL,
    "deductibleMetDate" TIMESTAMP(3),
    "oopmMetDate" TIMESTAMP(3),
    "paidOutOfPocket" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HealthcareYear_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvestmentHolding" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ticker" TEXT,
    "type" "InvestmentType" NOT NULL,
    "quantity" DECIMAL(65,30) NOT NULL,
    "costBasis" DECIMAL(65,30),
    "accountName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvestmentHolding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvestmentSnapshot" (
    "id" TEXT NOT NULL,
    "holdingId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "quantity" DECIMAL(65,30) NOT NULL,
    "value" DECIMAL(65,30),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvestmentSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetGoal" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "GoalType" NOT NULL,
    "targetAmount" DECIMAL(65,30) NOT NULL,
    "currentAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "categoryId" TEXT,
    "deadline" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BudgetGoal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PayPeriod_scheduleId_year_periodNum_key" ON "PayPeriod"("scheduleId", "year", "periodNum");

-- CreateIndex
CREATE UNIQUE INDEX "HealthcareYear_year_key" ON "HealthcareYear"("year");

-- AddForeignKey
ALTER TABLE "Income" ADD CONSTRAINT "Income_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_payPeriodId_fkey" FOREIGN KEY ("payPeriodId") REFERENCES "PayPeriod"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_incomeId_fkey" FOREIGN KEY ("incomeId") REFERENCES "Income"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayPeriod" ADD CONSTRAINT "PayPeriod_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "PaySchedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BalanceSnapshot" ADD CONSTRAINT "BalanceSnapshot_payPeriodId_fkey" FOREIGN KEY ("payPeriodId") REFERENCES "PayPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestmentSnapshot" ADD CONSTRAINT "InvestmentSnapshot_holdingId_fkey" FOREIGN KEY ("holdingId") REFERENCES "InvestmentHolding"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetGoal" ADD CONSTRAINT "BudgetGoal_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
