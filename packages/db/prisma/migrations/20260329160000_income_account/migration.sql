-- Add accountId to Income
ALTER TABLE "Income" ADD COLUMN "accountId" TEXT;
ALTER TABLE "Income" ADD CONSTRAINT "Income_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
