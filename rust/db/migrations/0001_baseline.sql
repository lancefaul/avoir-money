-- SQLite baseline schema for avoir-finance.
-- GENERATED from the Postgres catalog by rust/schema-gen. Generated once,
-- then maintained by hand as the first sqlx migration — do not regenerate
-- over local edits.
--
-- Money and percentages are INTEGER scaled by 100 (ADR-033). Quantities and
-- unit prices are TEXT exact decimals and must never be SUM/MIN/MAX/ORDER BY
-- in SQL — SQLite coerces TEXT to float on aggregation and compares it
-- lexicographically.

PRAGMA foreign_keys = ON;

CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "balance" INTEGER NOT NULL,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "archived" INTEGER NOT NULL CHECK ("archived" IN (0, 1)),
    "hasRewards" INTEGER NOT NULL CHECK ("hasRewards" IN (0, 1)),
    "earnsInterest" INTEGER NOT NULL CHECK ("earnsInterest" IN (0, 1)),
    "interestRate" INTEGER NOT NULL,
    "interestRateType" TEXT NOT NULL,
    "openingBalance" INTEGER NOT NULL,
    "parentAccountId" TEXT,
    PRIMARY KEY ("id"),
    FOREIGN KEY ("parentAccountId") REFERENCES "Account"("id") ON DELETE CASCADE
);

CREATE TABLE "Backup" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "filepath" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "status" TEXT NOT NULL CHECK ("status" IN ('COMPLETED', 'FAILED', 'RESTORING')),
    "error" TEXT,
    "completedAt" TEXT,
    "createdAt" TEXT NOT NULL,
    "source" TEXT NOT NULL CHECK ("source" IN ('MANUAL', 'PRE_RESTORE', 'IMPORTED')),
    PRIMARY KEY ("id")
);

CREATE TABLE "BackupConfig" (
    "id" TEXT NOT NULL,
    "enabled" INTEGER NOT NULL CHECK ("enabled" IN (0, 1)),
    "path" TEXT NOT NULL,
    "frequency" TEXT NOT NULL CHECK ("frequency" IN ('DAILY', 'WEEKLY')),
    "retentionCount" INTEGER NOT NULL,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,
    PRIMARY KEY ("id")
);

CREATE TABLE "BudgetGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    PRIMARY KEY ("id")
);

CREATE TABLE "ConnectedService" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "secretCipher" TEXT NOT NULL,
    "secretIv" TEXT NOT NULL,
    "secretTag" TEXT NOT NULL,
    "hint" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,
    PRIMARY KEY ("id")
);

CREATE TABLE "Custodian" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,
    "managementUrl" TEXT,
    PRIMARY KEY ("id")
);

CREATE TABLE "HealthcareYear" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "employer" TEXT NOT NULL,
    "medicalPremium" INTEGER NOT NULL,
    "medicalDeductible" INTEGER NOT NULL,
    "medicalOOPM" INTEGER NOT NULL,
    "dentalPremium" INTEGER NOT NULL,
    "visionPremium" INTEGER NOT NULL,
    "deductibleMetDate" TEXT,
    "oopmMetDate" TEXT,
    "paidOutOfPocket" INTEGER NOT NULL,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,
    PRIMARY KEY ("id")
);

CREATE TABLE "PaySchedule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL CHECK ("type" IN ('WEEKLY', 'BIWEEKLY', 'SEMI_MONTHLY', 'MONTHLY')),
    "anchorDate" TEXT NOT NULL,
    "firstPayDay" INTEGER,
    "secondPayDay" INTEGER,
    "isDefault" INTEGER NOT NULL CHECK ("isDefault" IN (0, 1)),
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,
    PRIMARY KEY ("id")
);

CREATE TABLE "TransactionDescription" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    PRIMARY KEY ("id")
);

CREATE TABLE "UtilityProvider" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,
    PRIMARY KEY ("id")
);

CREATE TABLE "Wallet" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,
    "custodyType" TEXT NOT NULL CHECK ("custodyType" IN ('CUSTODIAL', 'NON_CUSTODIAL')),
    "storageType" TEXT CHECK ("storageType" IN ('HOT', 'COLD')),
    "managementUrl" TEXT,
    PRIMARY KEY ("id")
);

CREATE TABLE "YearPlan" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "status" TEXT NOT NULL CHECK ("status" IN ('DRAFT', 'ACTIVE', 'ARCHIVED')),
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,
    PRIMARY KEY ("id")
);

CREATE TABLE "Budget" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "isCustom" INTEGER NOT NULL CHECK ("isCustom" IN (0, 1)),
    "createdAt" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "deletedAt" TEXT,
    "isSystem" INTEGER NOT NULL CHECK ("isSystem" IN (0, 1)),
    PRIMARY KEY ("id"),
    FOREIGN KEY ("groupId") REFERENCES "BudgetGroup"("id") ON DELETE RESTRICT
);

CREATE TABLE "InvestmentHolding" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ticker" TEXT,
    "type" TEXT NOT NULL CHECK ("type" IN ('STOCK', 'BITCOIN')),
    "quantity" TEXT NOT NULL,
    "costBasis" INTEGER,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,
    "custodianId" TEXT,
    "walletId" TEXT,
    PRIMARY KEY ("id"),
    FOREIGN KEY ("custodianId") REFERENCES "Custodian"("id") ON DELETE SET NULL,
    FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE SET NULL
);

CREATE TABLE "PayPeriod" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "payDate" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "periodNum" INTEGER NOT NULL,
    PRIMARY KEY ("id"),
    FOREIGN KEY ("scheduleId") REFERENCES "PaySchedule"("id") ON DELETE CASCADE
);

CREATE TABLE "BalanceSnapshot" (
    "id" TEXT NOT NULL,
    "payPeriodId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "openingBalance" INTEGER NOT NULL,
    "closingBalance" INTEGER NOT NULL,
    "totalIncome" INTEGER NOT NULL,
    "totalExpenses" INTEGER NOT NULL,
    "createdAt" TEXT NOT NULL,
    PRIMARY KEY ("id"),
    FOREIGN KEY ("payPeriodId") REFERENCES "PayPeriod"("id") ON DELETE CASCADE
);

CREATE TABLE "BudgetGoal" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL CHECK ("type" IN ('SAVINGS', 'DEBT_PAYOFF', 'INVESTMENT', 'SPENDING_LIMIT', 'CUSTOM')),
    "targetAmount" INTEGER NOT NULL,
    "currentAmount" INTEGER NOT NULL,
    "budgetId" TEXT,
    "deadline" TEXT,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,
    PRIMARY KEY ("id"),
    FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE SET NULL
);

CREATE TABLE "CategoryBudget" (
    "id" TEXT NOT NULL,
    "yearPlanId" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "removedAt" TEXT,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,
    "highWaterMark" INTEGER NOT NULL,
    "doneForYear" INTEGER NOT NULL CHECK ("doneForYear" IN (0, 1)),
    PRIMARY KEY ("id"),
    FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE RESTRICT,
    FOREIGN KEY ("yearPlanId") REFERENCES "YearPlan"("id") ON DELETE CASCADE
);

CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "frequency" TEXT NOT NULL CHECK ("frequency" IN ('ONE_TIME', 'WEEKLY', 'BIWEEKLY', 'SEMI_MONTHLY', 'MONTHLY', 'QUARTERLY', 'ANNUAL', 'BIANNUAL')),
    "budgetId" TEXT NOT NULL,
    "accountId" TEXT,
    "isAutomatic" INTEGER NOT NULL CHECK ("isAutomatic" IN (0, 1)),
    "dueDay" INTEGER,
    "startDate" TEXT,
    "endDate" TEXT,
    "note" TEXT,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,
    "dueWeekday" INTEGER,
    "dueOrdinal" INTEGER,
    "amountSchedule" TEXT,
    "pausedUntil" TEXT,
    "archivedAt" TEXT,
    "skipWeekend" INTEGER NOT NULL CHECK ("skipWeekend" IN (0, 1)),
    "managementUrl" TEXT,
    PRIMARY KEY ("id"),
    FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL,
    FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE RESTRICT
);

CREATE TABLE "Income" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "frequency" TEXT NOT NULL CHECK ("frequency" IN ('ONE_TIME', 'WEEKLY', 'BIWEEKLY', 'SEMI_MONTHLY', 'MONTHLY', 'QUARTERLY', 'ANNUAL', 'BIANNUAL')),
    "budgetId" TEXT NOT NULL,
    "startDate" TEXT,
    "endDate" TEXT,
    "note" TEXT,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,
    "accountId" TEXT,
    "amountSchedule" TEXT,
    "pausedUntil" TEXT,
    "archivedAt" TEXT,
    "managementUrl" TEXT,
    PRIMARY KEY ("id"),
    FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL,
    FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE RESTRICT
);

CREATE TABLE "InsurancePolicy" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "employer" TEXT NOT NULL,
    "deductibleLimit" INTEGER,
    "oopmLimit" INTEGER,
    "deductibleOverride" INTEGER NOT NULL CHECK ("deductibleOverride" IN (0, 1)),
    "oopmOverride" INTEGER NOT NULL CHECK ("oopmOverride" IN (0, 1)),
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,
    "premium" INTEGER NOT NULL,
    "type" TEXT NOT NULL CHECK ("type" IN ('MEDICAL', 'DENTAL', 'VISION')),
    "metadata" TEXT NOT NULL,
    "budgetId" TEXT,
    "closedOn" TEXT,
    "endedOn" TEXT,
    "status" TEXT NOT NULL CHECK ("status" IN ('ACTIVE', 'ENDED', 'CLOSED')),
    PRIMARY KEY ("id"),
    FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE SET NULL
);

CREATE TABLE "InvestmentSnapshot" (
    "id" TEXT NOT NULL,
    "holdingId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "quantity" TEXT NOT NULL,
    "value" INTEGER,
    "createdAt" TEXT NOT NULL,
    PRIMARY KEY ("id"),
    FOREIGN KEY ("holdingId") REFERENCES "InvestmentHolding"("id") ON DELETE CASCADE
);

CREATE TABLE "InvestmentTransfer" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fromHoldingId" TEXT NOT NULL,
    "toHoldingId" TEXT NOT NULL,
    "quantity" TEXT NOT NULL,
    "bitcoinPrice" TEXT,
    "feeAmount" INTEGER,
    "feeUnit" TEXT,
    "feeBtc" TEXT,
    "ticker" TEXT,
    "feeTransactionId" TEXT,
    "createdAt" TEXT NOT NULL,
    PRIMARY KEY ("id"),
    FOREIGN KEY ("fromHoldingId") REFERENCES "InvestmentHolding"("id") ON DELETE RESTRICT,
    FOREIGN KEY ("toHoldingId") REFERENCES "InvestmentHolding"("id") ON DELETE RESTRICT
);

CREATE TABLE "BudgetExpenseLink" (
    "id" TEXT NOT NULL,
    "categoryBudgetId" TEXT NOT NULL,
    "expenseId" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    PRIMARY KEY ("id"),
    FOREIGN KEY ("categoryBudgetId") REFERENCES "CategoryBudget"("id") ON DELETE CASCADE,
    FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE CASCADE
);

CREATE TABLE "BudgetVersion" (
    "id" TEXT NOT NULL,
    "categoryBudgetId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "frequency" TEXT NOT NULL CHECK ("frequency" IN ('WEEKLY', 'BIWEEKLY', 'MONTHLY', 'YEARLY', 'SEMI_MONTHLY', 'QUARTERLY', 'BIANNUAL', 'ANNUAL')),
    "monthlyEquivalent" INTEGER NOT NULL,
    "activeMonths" TEXT,
    "effectiveDate" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    "manualOverride" INTEGER NOT NULL CHECK ("manualOverride" IN (0, 1)),
    PRIMARY KEY ("id"),
    FOREIGN KEY ("categoryBudgetId") REFERENCES "CategoryBudget"("id") ON DELETE CASCADE
);

CREATE TABLE "Debt" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "originalBalance" INTEGER NOT NULL,
    "currentBalance" INTEGER NOT NULL,
    "apr" INTEGER NOT NULL,
    "minimumPayment" INTEGER NOT NULL,
    "frequency" TEXT NOT NULL CHECK ("frequency" IN ('ONE_TIME', 'WEEKLY', 'BIWEEKLY', 'SEMI_MONTHLY', 'MONTHLY', 'QUARTERLY', 'ANNUAL', 'BIANNUAL')),
    "startDate" TEXT NOT NULL,
    "linkedExpenseId" TEXT,
    "linkedAccountId" TEXT,
    "paidOff" INTEGER NOT NULL CHECK ("paidOff" IN (0, 1)),
    "note" TEXT,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,
    "maturityDate" TEXT,
    "termMonths" INTEGER,
    "managementUrl" TEXT,
    "escrowEnabled" INTEGER NOT NULL CHECK ("escrowEnabled" IN (0, 1)),
    PRIMARY KEY ("id"),
    FOREIGN KEY ("linkedAccountId") REFERENCES "Account"("id") ON DELETE SET NULL,
    FOREIGN KEY ("linkedExpenseId") REFERENCES "Expense"("id") ON DELETE SET NULL
);

CREATE TABLE "PolicyBudgetLink" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    PRIMARY KEY ("id"),
    FOREIGN KEY ("policyId") REFERENCES "InsurancePolicy"("id") ON DELETE CASCADE
);

CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "date" TEXT NOT NULL,
    "payPeriodId" TEXT,
    "expenseId" TEXT,
    "incomeId" TEXT,
    "accountId" TEXT,
    "note" TEXT,
    "createdAt" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "toAccountId" TEXT,
    "budgetId" TEXT,
    "name" TEXT NOT NULL,
    "imported" INTEGER NOT NULL CHECK ("imported" IN (0, 1)),
    "occurrenceDate" TEXT,
    "parentId" TEXT,
    "preTaxAmount" INTEGER,
    "taxAmount" INTEGER,
    "taxRate" INTEGER,
    "netAmount" INTEGER NOT NULL,
    "descriptionId" TEXT,
    "costBasisAllocated" INTEGER,
    "balanceAfter" INTEGER,
    "balanceBefore" INTEGER,
    "toBalanceAfter" INTEGER,
    "toBalanceBefore" INTEGER,
    "reconciledAt" TEXT,
    "purchaseGroupId" TEXT,
    "isCashBack" INTEGER NOT NULL CHECK ("isCashBack" IN (0, 1)),
    PRIMARY KEY ("id"),
    FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT,
    FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE SET NULL,
    FOREIGN KEY ("descriptionId") REFERENCES "TransactionDescription"("id") ON DELETE SET NULL,
    FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE SET NULL,
    FOREIGN KEY ("incomeId") REFERENCES "Income"("id") ON DELETE SET NULL,
    FOREIGN KEY ("parentId") REFERENCES "Transaction"("id") ON DELETE CASCADE,
    FOREIGN KEY ("payPeriodId") REFERENCES "PayPeriod"("id") ON DELETE SET NULL,
    FOREIGN KEY ("toAccountId") REFERENCES "Account"("id") ON DELETE SET NULL
);

CREATE TABLE "UtilityService" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "serviceType" TEXT NOT NULL CHECK ("serviceType" IN ('ELECTRIC', 'GAS', 'WATER', 'GARBAGE', 'SEWAGE', 'INTERNET', 'CELLULAR')),
    "metering" TEXT NOT NULL CHECK ("metering" IN ('METERED', 'UNMETERED')),
    "expenseId" TEXT,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,
    PRIMARY KEY ("id"),
    FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE SET NULL,
    FOREIGN KEY ("providerId") REFERENCES "UtilityProvider"("id") ON DELETE RESTRICT
);

CREATE TABLE "BitcoinPaymentDetail" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "quantity" TEXT NOT NULL,
    "unitPrice" TEXT NOT NULL,
    "bitcoinUnit" TEXT NOT NULL,
    "incomeType" TEXT,
    PRIMARY KEY ("id"),
    FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE,
    FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT
);

CREATE TABLE "DebtPayment" (
    "id" TEXT NOT NULL,
    "debtId" TEXT NOT NULL,
    "transactionId" TEXT,
    "principalAmount" INTEGER NOT NULL,
    "interestAmount" INTEGER NOT NULL,
    "date" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    PRIMARY KEY ("id"),
    FOREIGN KEY ("debtId") REFERENCES "Debt"("id") ON DELETE CASCADE,
    FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL
);

CREATE TABLE "EscrowRecord" (
    "id" TEXT NOT NULL,
    "debtId" TEXT NOT NULL,
    "monthlyAmount" INTEGER NOT NULL,
    "periodStartDate" TEXT NOT NULL,
    "periodEndDate" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,
    PRIMARY KEY ("id"),
    FOREIGN KEY ("debtId") REFERENCES "Debt"("id") ON DELETE CASCADE
);

CREATE TABLE "ReconciliationSession" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "periodStart" TEXT NOT NULL,
    "periodEnd" TEXT NOT NULL,
    "statementEndingBalance" INTEGER NOT NULL,
    "status" TEXT NOT NULL CHECK ("status" IN ('DRAFT', 'RECONCILED')),
    "residualAtClose" INTEGER NOT NULL,
    "reconciledAt" TEXT,
    "adjustmentTransactionId" TEXT,
    "adjustmentReason" TEXT,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,
    PRIMARY KEY ("id"),
    FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE,
    FOREIGN KEY ("adjustmentTransactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL
);

CREATE TABLE "ScheduledTransaction" (
    "id" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL CHECK ("sourceType" IN ('EXPENSE', 'INCOME')),
    "sourceId" TEXT NOT NULL,
    "dueDate" TEXT NOT NULL,
    "expectedAmount" INTEGER NOT NULL,
    "actualAmount" INTEGER,
    "status" TEXT NOT NULL CHECK ("status" IN ('PENDING', 'PAID', 'PARTIAL', 'SKIPPED', 'SNOOZED')),
    "transactionId" TEXT,
    "snoozedUntil" TEXT,
    "note" TEXT,
    "expenseId" TEXT,
    "incomeId" TEXT,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,
    PRIMARY KEY ("id"),
    FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE CASCADE,
    FOREIGN KEY ("incomeId") REFERENCES "Income"("id") ON DELETE CASCADE,
    FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL
);

CREATE TABLE "TradeDetail" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "assetType" TEXT NOT NULL,
    "ticker" TEXT,
    "quantity" TEXT NOT NULL,
    "unitPrice" TEXT NOT NULL,
    "bitcoinUnit" TEXT,
    "custodianId" TEXT,
    "walletId" TEXT,
    PRIMARY KEY ("id"),
    FOREIGN KEY ("custodianId") REFERENCES "Custodian"("id") ON DELETE RESTRICT,
    FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE,
    FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT
);

CREATE TABLE "UtilityReading" (
    "id" TEXT NOT NULL,
    "billDate" TEXT NOT NULL,
    "usage" TEXT,
    "cost" INTEGER NOT NULL,
    "unitCost" TEXT,
    "details" TEXT,
    "createdAt" TEXT NOT NULL,
    "convenienceFee" INTEGER,
    "convenienceFeeType" TEXT,
    "otherFees" INTEGER,
    "dueDate" TEXT,
    "serviceId" TEXT NOT NULL,
    PRIMARY KEY ("id"),
    FOREIGN KEY ("serviceId") REFERENCES "UtilityService"("id") ON DELETE RESTRICT
);

CREATE TABLE "StatementRow" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "postedDate" TEXT NOT NULL,
    "transactionDate" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "rawLine" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    PRIMARY KEY ("id"),
    FOREIGN KEY ("sessionId") REFERENCES "ReconciliationSession"("id") ON DELETE CASCADE
);

CREATE TABLE "ReconciliationMatch" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "statementRowId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "matchType" TEXT NOT NULL CHECK ("matchType" IN ('EXACT', 'SUM', 'FUZZY', 'MANUAL')),
    "createdAt" TEXT NOT NULL,
    PRIMARY KEY ("id"),
    FOREIGN KEY ("sessionId") REFERENCES "ReconciliationSession"("id") ON DELETE CASCADE,
    FOREIGN KEY ("statementRowId") REFERENCES "StatementRow"("id") ON DELETE CASCADE,
    FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE
);

CREATE INDEX "Account_archived_idx" ON "Account" (archived);
CREATE UNIQUE INDEX "Account_parentAccountId_key" ON "Account" ("parentAccountId");

CREATE INDEX "Backup_createdAt_idx" ON "Backup" ("createdAt");

CREATE UNIQUE INDEX "BudgetGroup_name_key" ON "BudgetGroup" (name);

CREATE UNIQUE INDEX "ConnectedService_provider_key" ON "ConnectedService" (provider);

CREATE UNIQUE INDEX "Custodian_name_key" ON "Custodian" (name);

CREATE UNIQUE INDEX "HealthcareYear_year_key" ON "HealthcareYear" (year);

CREATE UNIQUE INDEX "TransactionDescription_name_key" ON "TransactionDescription" (name);

CREATE UNIQUE INDEX "UtilityProvider_name_key" ON "UtilityProvider" (name);

CREATE UNIQUE INDEX "Wallet_name_key" ON "Wallet" (name);

CREATE UNIQUE INDEX "YearPlan_year_key" ON "YearPlan" (year);

CREATE INDEX "PayPeriod_endDate_idx" ON "PayPeriod" ("endDate");
CREATE UNIQUE INDEX "PayPeriod_scheduleId_year_periodNum_key" ON "PayPeriod" ("scheduleId", year, "periodNum");
CREATE INDEX "PayPeriod_startDate_idx" ON "PayPeriod" ("startDate");

CREATE UNIQUE INDEX "CategoryBudget_yearPlanId_budgetId_key" ON "CategoryBudget" ("yearPlanId", "budgetId");

CREATE UNIQUE INDEX "BudgetExpenseLink_categoryBudgetId_expenseId_key" ON "BudgetExpenseLink" ("categoryBudgetId", "expenseId");
CREATE UNIQUE INDEX "BudgetExpenseLink_expenseId_key" ON "BudgetExpenseLink" ("expenseId");

CREATE UNIQUE INDEX "BudgetVersion_categoryBudgetId_effectiveDate_key" ON "BudgetVersion" ("categoryBudgetId", "effectiveDate");

CREATE UNIQUE INDEX "PolicyBudgetLink_policyId_budgetId_key" ON "PolicyBudgetLink" ("policyId", "budgetId");

CREATE INDEX "Transaction_budgetId_idx" ON "Transaction" ("budgetId");
CREATE INDEX "Transaction_date_idx" ON "Transaction" (date);
CREATE INDEX "Transaction_descriptionId_idx" ON "Transaction" ("descriptionId");
CREATE INDEX "Transaction_expenseId_idx" ON "Transaction" ("expenseId");
CREATE INDEX "Transaction_incomeId_idx" ON "Transaction" ("incomeId");
CREATE INDEX "Transaction_payPeriodId_idx" ON "Transaction" ("payPeriodId");
CREATE INDEX "Transaction_purchaseGroupId_idx" ON "Transaction" ("purchaseGroupId");
CREATE INDEX "Transaction_reconciledAt_idx" ON "Transaction" ("reconciledAt");

CREATE INDEX "UtilityService_providerId_idx" ON "UtilityService" ("providerId");
CREATE UNIQUE INDEX "UtilityService_providerId_serviceType_key" ON "UtilityService" ("providerId", "serviceType");

CREATE UNIQUE INDEX "BitcoinPaymentDetail_transactionId_key" ON "BitcoinPaymentDetail" ("transactionId");
CREATE INDEX "BitcoinPaymentDetail_walletId_idx" ON "BitcoinPaymentDetail" ("walletId");

CREATE UNIQUE INDEX "EscrowRecord_debtId_periodStartDate_key" ON "EscrowRecord" ("debtId", "periodStartDate");

CREATE INDEX "ReconciliationSession_accountId_periodEnd_idx" ON "ReconciliationSession" ("accountId", "periodEnd");
CREATE INDEX "ReconciliationSession_accountId_status_idx" ON "ReconciliationSession" ("accountId", status);
CREATE UNIQUE INDEX "ReconciliationSession_adjustmentTransactionId_key" ON "ReconciliationSession" ("adjustmentTransactionId");
CREATE UNIQUE INDEX "ReconciliationSession_one_draft_per_account" ON "ReconciliationSession" ("accountId") WHERE (status = 'DRAFT');

CREATE INDEX "ScheduledTransaction_dueDate_idx" ON "ScheduledTransaction" ("dueDate");
CREATE UNIQUE INDEX "ScheduledTransaction_sourceType_sourceId_dueDate_key" ON "ScheduledTransaction" ("sourceType", "sourceId", "dueDate");
CREATE INDEX "ScheduledTransaction_sourceType_sourceId_status_idx" ON "ScheduledTransaction" ("sourceType", "sourceId", status);
CREATE INDEX "ScheduledTransaction_status_idx" ON "ScheduledTransaction" (status);
CREATE UNIQUE INDEX "ScheduledTransaction_transactionId_key" ON "ScheduledTransaction" ("transactionId");

CREATE INDEX "TradeDetail_custodianId_idx" ON "TradeDetail" ("custodianId");
CREATE UNIQUE INDEX "TradeDetail_transactionId_key" ON "TradeDetail" ("transactionId");
CREATE INDEX "TradeDetail_walletId_idx" ON "TradeDetail" ("walletId");

CREATE INDEX "UtilityReading_billDate_idx" ON "UtilityReading" ("billDate");
CREATE INDEX "UtilityReading_serviceId_idx" ON "UtilityReading" ("serviceId");

CREATE INDEX "StatementRow_sessionId_idx" ON "StatementRow" ("sessionId");

CREATE INDEX "ReconciliationMatch_sessionId_idx" ON "ReconciliationMatch" ("sessionId");
CREATE UNIQUE INDEX "ReconciliationMatch_statementRowId_transactionId_key" ON "ReconciliationMatch" ("statementRowId", "transactionId");
CREATE INDEX "ReconciliationMatch_transactionId_idx" ON "ReconciliationMatch" ("transactionId");

