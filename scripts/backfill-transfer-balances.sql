-- Backfill toBalanceBefore/toBalanceAfter for TRANSFER transactions
-- For each destination account, walk its incoming transfers in chronological order.
-- toBalanceAfter = account.balance - sum(transfers_after_this_one)
-- toBalanceBefore = toBalanceAfter - this_transfer_amount

WITH transfers_ordered AS (
  SELECT
    id,
    "toAccountId",
    amount,
    ROW_NUMBER() OVER (PARTITION BY "toAccountId" ORDER BY date DESC, "createdAt" DESC) as rn_desc
  FROM "Transaction"
  WHERE type = 'TRANSFER' AND "toAccountId" IS NOT NULL AND "parentId" IS NULL
),
with_cumulative AS (
  SELECT
    id,
    "toAccountId",
    amount,
    COALESCE(SUM(amount) OVER (PARTITION BY "toAccountId" ORDER BY rn_desc ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) as sum_after
  FROM transfers_ordered
),
final AS (
  SELECT
    wc.id,
    a.balance - wc.sum_after as to_balance_after,
    a.balance - wc.sum_after - wc.amount as to_balance_before
  FROM with_cumulative wc
  JOIN "Account" a ON a.id = wc."toAccountId"
)
UPDATE "Transaction" t
SET
  "toBalanceBefore" = f.to_balance_before,
  "toBalanceAfter" = f.to_balance_after
FROM final f
WHERE t.id = f.id;
