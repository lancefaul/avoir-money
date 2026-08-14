/*
  Drops the tradeMetadata / bitcoinMetadata JSON columns on Transaction, now that
  trade/payment detail lives in the typed TradeDetail / BitcoinPaymentDetail tables.

  This migration is self-safe and order-independent: before dropping the columns it
  backfills any row that still has JSON but no detail row (idempotent — skips rows
  that already have a detail row, and rows whose JSON is malformed). FK references
  that no longer resolve are nulled (TradeDetail) or the row is skipped
  (BitcoinPaymentDetail, whose walletId FK is required). The app-level backfill
  script (prisma/backfill-trade-detail.ts) does the same with CUID ids; this is the
  belt-and-suspenders for anything it missed.
*/

-- Backfill TradeDetail from any remaining tradeMetadata JSON (orphan FKs nulled)
INSERT INTO "TradeDetail" (
  id, "transactionId", direction, "assetType", ticker, quantity, "unitPrice",
  "bitcoinUnit", "custodianId", "walletId"
)
SELECT
  gen_random_uuid()::text,
  t.id,
  t."tradeMetadata"->>'direction',
  t."tradeMetadata"->>'assetType',
  t."tradeMetadata"->>'ticker',
  (t."tradeMetadata"->>'quantity')::numeric,
  (t."tradeMetadata"->>'unitPrice')::numeric,
  t."tradeMetadata"->>'bitcoinUnit',
  c.id,
  w.id
FROM "Transaction" t
LEFT JOIN "Custodian" c ON c.id = t."tradeMetadata"->>'custodianId'
LEFT JOIN "Wallet" w ON w.id = t."tradeMetadata"->>'walletId'
WHERE t."tradeMetadata" IS NOT NULL
  AND t.type = 'TRADE'
  AND NOT EXISTS (SELECT 1 FROM "TradeDetail" d WHERE d."transactionId" = t.id)
  AND t."tradeMetadata"->>'direction' IS NOT NULL
  AND t."tradeMetadata"->>'assetType' IS NOT NULL
  AND (t."tradeMetadata"->>'quantity') ~ '^-?[0-9]+(\.[0-9]+)?$'
  AND (t."tradeMetadata"->>'unitPrice') ~ '^-?[0-9]+(\.[0-9]+)?$';

-- Backfill BitcoinPaymentDetail from any remaining bitcoinMetadata JSON
-- (walletId FK is required, so rows with an unresolved wallet are skipped)
INSERT INTO "BitcoinPaymentDetail" (
  id, "transactionId", "walletId", quantity, "unitPrice", "bitcoinUnit", "incomeType"
)
SELECT
  gen_random_uuid()::text,
  t.id,
  w.id,
  (t."bitcoinMetadata"->>'quantity')::numeric,
  (t."bitcoinMetadata"->>'unitPrice')::numeric,
  t."bitcoinMetadata"->>'bitcoinUnit',
  t."bitcoinMetadata"->>'incomeType'
FROM "Transaction" t
JOIN "Wallet" w ON w.id = t."bitcoinMetadata"->>'walletId'
WHERE t."bitcoinMetadata" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "BitcoinPaymentDetail" d WHERE d."transactionId" = t.id)
  AND t."bitcoinMetadata"->>'bitcoinUnit' IS NOT NULL
  AND (t."bitcoinMetadata"->>'quantity') ~ '^-?[0-9]+(\.[0-9]+)?$'
  AND (t."bitcoinMetadata"->>'unitPrice') ~ '^-?[0-9]+(\.[0-9]+)?$';

-- Drop the now-unused JSON columns
ALTER TABLE "Transaction" DROP COLUMN "bitcoinMetadata",
DROP COLUMN "tradeMetadata";
