-- One escrow record per (debtId, periodStartDate).
--
-- Editing a mortgage re-posts its escrow with the period already sitting in the
-- form, and that write inserted unconditionally, so a single period accumulated
-- rows: production reached five for 2026-08-01, two of them the same edit made
-- twice. The "current escrow" read then ordered by periodStartDate alone, all
-- five tied, and SQL has no defined order for a tie — so an arbitrary, stale row
-- won and an escrow edit appeared not to have saved.
--
-- Self-safe and order-independent: the duplicates are collapsed in the same
-- transaction that adds the constraint, so this cannot fail on existing data and
-- needs no cleanup run beforehand.

-- Keep the most recently created row for each period. `createdAt` is the same
-- signal the read-side tie-break uses (ADR-032), so the row surviving here is
-- exactly the one the app has been displaying since that fix. The id comparison
-- only settles rows created within the same clock tick, which same-transaction
-- inserts can produce.
DELETE FROM "EscrowRecord" a
USING "EscrowRecord" b
WHERE a."debtId" = b."debtId"
  AND a."periodStartDate" = b."periodStartDate"
  AND (
    a."createdAt" < b."createdAt"
    OR (a."createdAt" = b."createdAt" AND a."id" < b."id")
  );

CREATE UNIQUE INDEX "EscrowRecord_debtId_periodStartDate_key"
  ON "EscrowRecord"("debtId", "periodStartDate");
