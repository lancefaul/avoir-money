-- Add name to Transaction, backfill from linked expense/income
ALTER TABLE "Transaction" ADD COLUMN "name" TEXT;

-- Backfill from expense name
UPDATE "Transaction" SET "name" = e."name"
FROM "Expense" e WHERE "Transaction"."expenseId" = e."id" AND "Transaction"."name" IS NULL;

-- Backfill from income name
UPDATE "Transaction" SET "name" = i."name"
FROM "Income" i WHERE "Transaction"."incomeId" = i."id" AND "Transaction"."name" IS NULL;

-- Backfill transfers
UPDATE "Transaction" SET "name" = 'Transfer' WHERE "Transaction"."type" = 'TRANSFER' AND "Transaction"."name" IS NULL;

-- Default any remaining
UPDATE "Transaction" SET "name" = COALESCE("note", 'Transaction') WHERE "name" IS NULL;

ALTER TABLE "Transaction" ALTER COLUMN "name" SET NOT NULL;
