-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('DRAFT', 'RECONCILED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "MatchType" AS ENUM ('EXACT', 'SUM', 'FUZZY', 'MANUAL');

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "reconciledAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ReconciliationSession" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "statementEndingBalance" DECIMAL(65,30) NOT NULL,
    "status" "ReconciliationStatus" NOT NULL DEFAULT 'DRAFT',
    "residualAtClose" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "reconciledAt" TIMESTAMP(3),
    "adjustmentTransactionId" TEXT,
    "adjustmentReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReconciliationSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatementRow" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "postedDate" TIMESTAMP(3) NOT NULL,
    "transactionDate" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "rawLine" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StatementRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationMatch" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "statementRowId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "matchType" "MatchType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReconciliationMatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReconciliationSession_adjustmentTransactionId_key" ON "ReconciliationSession"("adjustmentTransactionId");

-- CreateIndex
CREATE INDEX "ReconciliationSession_accountId_periodEnd_idx" ON "ReconciliationSession"("accountId", "periodEnd");

-- CreateIndex
CREATE INDEX "ReconciliationSession_accountId_status_idx" ON "ReconciliationSession"("accountId", "status");

-- CreateIndex
CREATE INDEX "StatementRow_sessionId_idx" ON "StatementRow"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "StatementRow_sessionId_rawLine_key" ON "StatementRow"("sessionId", "rawLine");

-- CreateIndex
CREATE INDEX "ReconciliationMatch_sessionId_idx" ON "ReconciliationMatch"("sessionId");

-- CreateIndex
CREATE INDEX "ReconciliationMatch_transactionId_idx" ON "ReconciliationMatch"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "ReconciliationMatch_statementRowId_transactionId_key" ON "ReconciliationMatch"("statementRowId", "transactionId");

-- CreateIndex
CREATE INDEX "Transaction_reconciledAt_idx" ON "Transaction"("reconciledAt");

-- AddForeignKey
ALTER TABLE "ReconciliationSession" ADD CONSTRAINT "ReconciliationSession_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationSession" ADD CONSTRAINT "ReconciliationSession_adjustmentTransactionId_fkey" FOREIGN KEY ("adjustmentTransactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatementRow" ADD CONSTRAINT "StatementRow_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ReconciliationSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationMatch" ADD CONSTRAINT "ReconciliationMatch_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ReconciliationSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationMatch" ADD CONSTRAINT "ReconciliationMatch_statementRowId_fkey" FOREIGN KEY ("statementRowId") REFERENCES "StatementRow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationMatch" ADD CONSTRAINT "ReconciliationMatch_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
