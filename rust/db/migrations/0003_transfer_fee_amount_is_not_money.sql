-- `InvestmentTransfer.feeAmount` is an amount in `feeUnit`, not an amount in
-- dollars — so it cannot be integer cents.
--
-- The classification manifest called it `money`, which is right for exactly one
-- of its three cases. A stock transfer's fee is USD; a bitcoin transfer's fee
-- is whatever `feeUnit` says, and the schema names three options:
-- Bitcoin, Sats and USD. A typical on-chain fee of 5,000 sats is 0.00005 BTC,
-- which `Cents::from_dollars` rounds to **0**. The fee would vanish, the
-- balance check that subtracts it would pass, and the audit row would record
-- that there was no fee.
--
-- This is the same defect ADR-033 was written about, one column further on:
-- one column holding two kinds of number, permitted because the old Postgres
-- `DECIMAL(65,30)` was wide enough to hide the difference. `feeBtc` (the
-- normalised BTC value) was already correctly classified as a quantity; its
-- as-entered sibling was not.
--
-- Free to change: `InvestmentTransfer` has **zero rows in production**
-- (verified against the live catalog before writing this), so nothing is
-- converted and nothing can be lost. SQLite cannot alter a column type, so the
-- table is rebuilt — which for an empty table is a rename away.
--
-- TEXT carries the ADR-033 obligation with it: `feeAmount` must never be
-- SUM/MIN/MAX/ORDER BY'd in SQL, because SQLite coerces TEXT to float under
-- aggregation. Nothing aggregates it today — checked across the TypeScript
-- routes before the change — and the fee is read one row at a time.

CREATE TABLE "InvestmentTransfer_new" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fromHoldingId" TEXT NOT NULL,
    "toHoldingId" TEXT NOT NULL,
    "quantity" TEXT NOT NULL,
    "bitcoinPrice" TEXT,
    "feeAmount" TEXT,
    "feeUnit" TEXT,
    "feeBtc" TEXT,
    "ticker" TEXT,
    "feeTransactionId" TEXT,
    "createdAt" TEXT NOT NULL,
    PRIMARY KEY ("id"),
    FOREIGN KEY ("fromHoldingId") REFERENCES "InvestmentHolding"("id") ON DELETE RESTRICT,
    FOREIGN KEY ("toHoldingId") REFERENCES "InvestmentHolding"("id") ON DELETE RESTRICT
);

-- Empty in production, but written as a real copy rather than a bare rename so
-- that a database which somehow does hold rows converts them instead of
-- silently dropping them. Cents to decimal dollars is exact.
INSERT INTO "InvestmentTransfer_new"
SELECT "id", "type", "fromHoldingId", "toHoldingId", "quantity", "bitcoinPrice",
       CASE WHEN "feeAmount" IS NULL THEN NULL
            ELSE CAST(("feeAmount" / 100) AS TEXT) || '.' ||
                 substr('0' || CAST((abs("feeAmount") % 100) AS TEXT), -2, 2) END,
       "feeUnit", "feeBtc", "ticker", "feeTransactionId", "createdAt"
  FROM "InvestmentTransfer";

DROP TABLE "InvestmentTransfer";
ALTER TABLE "InvestmentTransfer_new" RENAME TO "InvestmentTransfer";
