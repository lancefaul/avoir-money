-- Split the balanceBefore/balanceAfter overload.
--
-- Those two columns carried two different units depending on the row:
-- integer cents for a cash transaction, and a BTC quantity for a
-- bitcoin-payment row. They never collided, because a cross-field rule keeps
-- the two disjoint (a bitcoin-payment row has accountId NULL, a cash row has
-- one set) — but one column meaning two things is what let the conflict go
-- unnoticed until ADR-033 made the money columns INTEGER cents, at which
-- point they could no longer represent 8-decimal BTC at all.
--
-- No data moves. Verified against production before writing this: 1,884 rows
-- carry a balanceBefore and EVERY one has a non-null accountId, and all 205
-- BitcoinPaymentDetail rows have it NULL. The TypeScript that would have
-- written BTC there (writeWalletLedger, added 2026-05-24) has never executed,
-- because the newest bitcoin payment predates it by five days.
--
-- TEXT, not INTEGER, for the same reason quantity and unitPrice are TEXT
-- (ADR-033): this is a quantity, not money. It must never be SUM'd or
-- ORDER BY'd in SQL — SQLite coerces TEXT to float under aggregation.

ALTER TABLE "Transaction" ADD COLUMN "btcBalanceBefore" TEXT;
ALTER TABLE "Transaction" ADD COLUMN "btcBalanceAfter" TEXT;
