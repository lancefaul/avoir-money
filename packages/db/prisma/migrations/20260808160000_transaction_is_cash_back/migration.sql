-- Marks an INCOME row as cash back / a rebate rather than money earned.
--
-- Additive and defaulted, which is what makes the deploy ordering safe: a
-- client generated before this column exists simply never selects it, so
-- production can take this migration while the old dev server is still running.
-- The reverse order is the unsafe one — regenerating the client first points
-- live code at a column production does not have yet, and every Transaction
-- query throws (see the ERRORS.md entry "new code against an old database").
ALTER TABLE "Transaction" ADD COLUMN "isCashBack" BOOLEAN NOT NULL DEFAULT false;
