-- Add type column, default existing rows based on their links
ALTER TABLE "Transaction" ADD COLUMN "type" TEXT;
UPDATE "Transaction" SET "type" = CASE
  WHEN "incomeId" IS NOT NULL THEN 'INCOME'
  ELSE 'EXPENSE'
END;
ALTER TABLE "Transaction" ALTER COLUMN "type" SET NOT NULL;

-- Add toAccountId for transfers
ALTER TABLE "Transaction" ADD COLUMN "toAccountId" TEXT;
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_toAccountId_fkey"
    FOREIGN KEY ("toAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Make accountId required: first fill any nulls with a default account
UPDATE "Transaction" SET "accountId" = (SELECT "id" FROM "Account" LIMIT 1) WHERE "accountId" IS NULL;
ALTER TABLE "Transaction" ALTER COLUMN "accountId" SET NOT NULL;

-- Drop old unnamed relation constraint and add named one
ALTER TABLE "Transaction" DROP CONSTRAINT IF EXISTS "Transaction_accountId_fkey";
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
