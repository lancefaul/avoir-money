-- Give the "Starting Balance" a durable home.
--
-- The account create form has always captured a Starting Balance, but wrote it
-- straight into `balance`, where transactions then mutated it beyond recovery.
-- `recalculateAccountBalance` compounds this by summing from zero, which erases
-- the starting balance outright whenever it runs.
--
-- Splitting it out makes the ledger invariant checkable:
--
--     openingBalance + SUM(transactions) == balance
--
-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "openingBalance" DECIMAL(65,30) NOT NULL DEFAULT 0;

-- Backfill: openingBalance = balance - SUM(transactions).
--
-- This PRESERVES every current balance exactly — nothing visibly changes — and
-- makes the invariant true from this moment on. It does NOT make the openings
-- *correct*: an account whose balance had already drifted keeps that drift, now
-- parked in openingBalance where it is visible and editable instead of silently
-- absorbing every future error.
--
-- The summation mirrors `recalculateAccountBalance` in
-- apps/api/src/lib/account-balance.ts exactly:
--   - source rows  (accountId = account, parentId IS NULL): all types
--   - inbound rows (toAccountId = account, parentId IS NULL): TRANSFER only
--   - INCOME/REFUND add, EXPENSE/TRANSFER-out subtract, TRANSFER-in adds
--   - TRADE BUY subtracts, SELL adds, a TRADE with no detail row contributes 0
-- Any divergence here would bake a wrong opening into every account, so it must
-- track that function; the ledger-integrity check asserts they agree.
UPDATE "Account" a
SET "openingBalance" = ROUND(a.balance - COALESCE((
  SELECT SUM(
    CASE
      WHEN t.type IN ('INCOME', 'REFUND') THEN t."netAmount"
      WHEN t.type = 'EXPENSE' THEN -t."netAmount"
      WHEN t.type = 'TRANSFER' AND t."toAccountId" = a.id THEN t."netAmount"
      WHEN t.type = 'TRANSFER' THEN -t."netAmount"
      WHEN t.type = 'TRADE' AND td.direction = 'BUY' THEN -t."netAmount"
      WHEN t.type = 'TRADE' AND td.direction = 'SELL' THEN t."netAmount"
      ELSE 0
    END
  )
  FROM "Transaction" t
  LEFT JOIN "TradeDetail" td ON td."transactionId" = t.id
  WHERE t."parentId" IS NULL
    AND (
      t."accountId" = a.id
      OR (t."toAccountId" = a.id AND t.type = 'TRANSFER')
    )
), 0), 2);
