-- Add categoryId to Transaction
ALTER TABLE "Transaction" ADD COLUMN "categoryId" TEXT;
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: copy categoryId from linked expense where available
UPDATE "Transaction" SET "categoryId" = e."categoryId"
FROM "Expense" e WHERE "Transaction"."expenseId" = e."id";
