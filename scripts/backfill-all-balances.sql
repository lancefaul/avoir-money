-- Full backfill of balanceBefore/balanceAfter for ALL transactions
-- This considers BOTH roles an account plays:
--   As accountId (source): EXPENSE=-netAmount, INCOME/REFUND=+netAmount, TRANSFER=-amount, TRADE=±amount
--   As toAccountId (destination of transfer): +amount
--
-- Strategy: For each account, create a unified timeline of ALL events that affect its balance,
-- compute running balance, then write back.

-- Step 1: Clear all existing balance fields to start fresh
UPDATE "Transaction" SET "balanceBefore" = NULL, "balanceAfter" = NULL, "toBalanceBefore" = NULL, "toBalanceAfter" = NULL;

-- Step 2: Build unified timeline per account and compute running balances
-- Each account is affected by:
--   (a) Transactions where it is the source (accountId)
--   (b) Transfers where it is the destination (toAccountId)
-- We assign a delta to each event and compute cumulative balance.

WITH all_events AS (
  -- Source account events
  SELECT
    t.id as tx_id,
    t."accountId" as affected_account_id,
    'source' as role,
    t.date,
    t."createdAt",
    CASE
      WHEN t.type = 'EXPENSE' THEN -COALESCE(t."netAmount", t.amount)
      WHEN t.type = 'INCOME' THEN COALESCE(t."netAmount", t.amount)
      WHEN t.type = 'REFUND' THEN COALESCE(t."netAmount", t.amount)
      WHEN t.type = 'TRANSFER' THEN -t.amount
      WHEN t.type = 'TRADE' THEN
        CASE
          WHEN (t."tradeMetadata"::jsonb)->>'direction' = 'SELL' THEN t.amount
          ELSE -t.amount
        END
      ELSE 0
    END as delta
  FROM "Transaction" t
  WHERE t."accountId" IS NOT NULL AND t."parentId" IS NULL

  UNION ALL

  -- Destination account events (transfers received)
  SELECT
    t.id as tx_id,
    t."toAccountId" as affected_account_id,
    'destination' as role,
    t.date,
    t."createdAt",
    t.amount as delta  -- transfers ADD to destination
  FROM "Transaction" t
  WHERE t.type = 'TRANSFER' AND t."toAccountId" IS NOT NULL AND t."parentId" IS NULL
),
ordered AS (
  SELECT
    tx_id,
    affected_account_id,
    role,
    delta,
    ROW_NUMBER() OVER (PARTITION BY affected_account_id ORDER BY date ASC, "createdAt" ASC, role ASC) as rn
  FROM all_events
),
running AS (
  SELECT
    tx_id,
    affected_account_id,
    role,
    delta,
    SUM(delta) OVER (PARTITION BY affected_account_id ORDER BY rn) as cumulative
  FROM ordered
),
-- Compute offset: actual account balance minus last computed cumulative
last_per_account AS (
  SELECT DISTINCT ON (affected_account_id)
    affected_account_id,
    cumulative as last_cumulative
  FROM running
  ORDER BY affected_account_id, cumulative DESC
  -- This doesn't work right. Use a different approach.
),
-- Actually get the max rn per account
max_rn AS (
  SELECT affected_account_id, MAX(rn) as max_rn_val
  FROM ordered
  GROUP BY affected_account_id
),
last_entry AS (
  SELECT r.affected_account_id, r.cumulative as last_cumulative
  FROM running r
  JOIN max_rn m ON r.affected_account_id = m.affected_account_id
  JOIN ordered o ON o.tx_id = r.tx_id AND o.affected_account_id = r.affected_account_id AND o.role = r.role
  WHERE o.rn = m.max_rn_val
),
offsets AS (
  SELECT
    le.affected_account_id,
    a.balance - le.last_cumulative as offset
  FROM last_entry le
  JOIN "Account" a ON a.id = le.affected_account_id
),
final_values AS (
  SELECT
    r.tx_id,
    r.affected_account_id,
    r.role,
    r.cumulative - r.delta + COALESCE(o.offset, 0) as balance_before,
    r.cumulative + COALESCE(o.offset, 0) as balance_after
  FROM running r
  LEFT JOIN offsets o ON o.affected_account_id = r.affected_account_id
)
-- Step 3: Write source balances
UPDATE "Transaction" t
SET
  "balanceBefore" = fv.balance_before,
  "balanceAfter" = fv.balance_after
FROM final_values fv
WHERE t.id = fv.tx_id AND fv.role = 'source';

-- Step 4: Write destination balances for transfers
WITH all_events AS (
  SELECT
    t.id as tx_id,
    t."accountId" as affected_account_id,
    'source' as role,
    t.date,
    t."createdAt",
    CASE
      WHEN t.type = 'EXPENSE' THEN -COALESCE(t."netAmount", t.amount)
      WHEN t.type = 'INCOME' THEN COALESCE(t."netAmount", t.amount)
      WHEN t.type = 'REFUND' THEN COALESCE(t."netAmount", t.amount)
      WHEN t.type = 'TRANSFER' THEN -t.amount
      WHEN t.type = 'TRADE' THEN
        CASE
          WHEN (t."tradeMetadata"::jsonb)->>'direction' = 'SELL' THEN t.amount
          ELSE -t.amount
        END
      ELSE 0
    END as delta
  FROM "Transaction" t
  WHERE t."accountId" IS NOT NULL AND t."parentId" IS NULL

  UNION ALL

  SELECT
    t.id as tx_id,
    t."toAccountId" as affected_account_id,
    'destination' as role,
    t.date,
    t."createdAt",
    t.amount as delta
  FROM "Transaction" t
  WHERE t.type = 'TRANSFER' AND t."toAccountId" IS NOT NULL AND t."parentId" IS NULL
),
ordered AS (
  SELECT
    tx_id,
    affected_account_id,
    role,
    delta,
    ROW_NUMBER() OVER (PARTITION BY affected_account_id ORDER BY date ASC, "createdAt" ASC, role ASC) as rn
  FROM all_events
),
running AS (
  SELECT
    tx_id,
    affected_account_id,
    role,
    delta,
    rn,
    SUM(delta) OVER (PARTITION BY affected_account_id ORDER BY rn) as cumulative
  FROM ordered
),
max_rn AS (
  SELECT affected_account_id, MAX(rn) as max_rn_val
  FROM ordered
  GROUP BY affected_account_id
),
last_entry AS (
  SELECT DISTINCT ON (r.affected_account_id)
    r.affected_account_id,
    r.cumulative as last_cumulative
  FROM running r
  JOIN max_rn m ON r.affected_account_id = m.affected_account_id
  WHERE r.rn = m.max_rn_val
  ORDER BY r.affected_account_id
),
offsets AS (
  SELECT
    le.affected_account_id,
    a.balance - le.last_cumulative as offset
  FROM last_entry le
  JOIN "Account" a ON a.id = le.affected_account_id
),
final_values AS (
  SELECT
    r.tx_id,
    r.affected_account_id,
    r.role,
    r.cumulative - r.delta + COALESCE(o.offset, 0) as balance_before,
    r.cumulative + COALESCE(o.offset, 0) as balance_after
  FROM running r
  LEFT JOIN offsets o ON o.affected_account_id = r.affected_account_id
  WHERE r.role = 'destination'
)
UPDATE "Transaction" t
SET
  "toBalanceBefore" = fv.balance_before,
  "toBalanceAfter" = fv.balance_after
FROM final_values fv
WHERE t.id = fv.tx_id;
