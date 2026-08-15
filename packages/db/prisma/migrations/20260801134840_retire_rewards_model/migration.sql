/*
  Warnings:

  - You are about to drop the column `rewardsBalance` on the `Account` table. All the data in the column will be lost.
  - You are about to drop the column `rewardsApplied` on the `Transaction` table. All the data in the column will be lost.
  - You are about to drop the `RewardsLedgerEntry` table. If the table is not empty, all the data it contains will be lost.

*/

-- Rewards retirement (ADR-030). The per-purchase `rewardsApplied` discount is
-- replaced by redeeming rewards as a payment leg from the card's rewards account.
-- Before dropping the column, bake each historical discounted row down to what
-- was actually charged (netAmount == amount - rewardsApplied), preserving the
-- original sticker price in the note. Balance-neutral: netAmount (which drives
-- the ledger and every balance) is untouched; only the display `amount` moves to
-- match it. A no-op where nothing was ever discounted (e.g. the test database).
UPDATE "Transaction"
SET "note" = COALESCE("note" || ' ', '') || '[pre-retirement sticker $' || round("amount", 2)::text || ']',
    "amount" = "netAmount"
WHERE "rewardsApplied" > 0;

-- DropForeignKey
ALTER TABLE "RewardsLedgerEntry" DROP CONSTRAINT "RewardsLedgerEntry_accountId_fkey";

-- DropForeignKey
ALTER TABLE "RewardsLedgerEntry" DROP CONSTRAINT "RewardsLedgerEntry_transactionId_fkey";

-- AlterTable
ALTER TABLE "Account" DROP COLUMN "rewardsBalance";

-- AlterTable
ALTER TABLE "Transaction" DROP COLUMN "rewardsApplied";

-- DropTable
DROP TABLE "RewardsLedgerEntry";

-- DropEnum
DROP TYPE "RewardsLedgerEntryType";
