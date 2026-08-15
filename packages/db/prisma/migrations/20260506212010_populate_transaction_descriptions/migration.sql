-- Data migration: Populate TransactionDescription from existing Transaction.name values
-- and link each transaction to its description via descriptionId.

-- Step 1: Insert unique transaction names into TransactionDescription
-- Uses gen_random_uuid() for IDs since cuid() is not available in SQL.
INSERT INTO "TransactionDescription" ("id", "name", "createdAt")
SELECT
  gen_random_uuid()::text,
  DISTINCT_NAMES."name",
  NOW()
FROM (
  SELECT DISTINCT "name"
  FROM "Transaction"
  WHERE "name" IS NOT NULL
    AND "name" != ''
    AND "descriptionId" IS NULL
) AS DISTINCT_NAMES
ON CONFLICT ("name") DO NOTHING;

-- Step 2: Link each transaction to its matching TransactionDescription
UPDATE "Transaction" t
SET "descriptionId" = td."id"
FROM "TransactionDescription" td
WHERE t."name" = td."name"
  AND t."descriptionId" IS NULL;
