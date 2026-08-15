/*
  Retire the gift-card carveout (payment-split, ADR-030 — supersedes gift-card-ledger).

  Going forward a gift card is an ordinary account and a gift-card-funded purchase
  is a payment leg, so `netAmount` drops the gift-card term (now amount - rewardsApplied)
  and the giftCardApplied / giftCardAccountId columns are removed.

  Bake-in (must run BEFORE the columns are dropped): the historical gift-card rows
  keep the same stored `netAmount` — the balance driver — so this is balance-neutral
  for every account. `amount` is set to `netAmount + rewardsApplied` (= the old sticker
  minus the gift card) so the row stays self-consistent under the new formula
  (amount - rewardsApplied == netAmount); a future edit therefore can't drift it.
  `rewardsApplied` is left untouched so the rewards ledger is not desynced. The
  original total and the gift-card figure are preserved in the note.
*/

-- Bake in the historical gift-card rows (balance-neutral: netAmount unchanged)
UPDATE "Transaction"
SET
  note = TRIM(BOTH ' ' FROM COALESCE(note, '') ||
    ' [Gift card $' || to_char("giftCardApplied", 'FM999999990.00') ||
    ' applied; original total $' || to_char(amount, 'FM999999990.00') || ']'),
  amount = ROUND("netAmount" + "rewardsApplied", 2)
WHERE "giftCardApplied" > 0;

-- DropForeignKey
ALTER TABLE "Transaction" DROP CONSTRAINT "Transaction_giftCardAccountId_fkey";

-- AlterTable
ALTER TABLE "Transaction" DROP COLUMN "giftCardAccountId",
DROP COLUMN "giftCardApplied";
