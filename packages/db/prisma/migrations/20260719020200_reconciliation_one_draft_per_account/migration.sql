-- At most one DRAFT reconciliation session per account.
--
-- A partial unique index, because the constraint applies only to DRAFT rows: an
-- account accumulates any number of RECONCILED or ABANDONED sessions over time,
-- but two concurrent drafts would let the same period be reconciled twice with
-- conflicting resolutions. Prisma's @@unique cannot express a WHERE clause, so
-- this lives in its own hand-written migration rather than being appended to a
-- generated one (editing an applied migration breaks its checksum).
CREATE UNIQUE INDEX "ReconciliationSession_one_draft_per_account"
  ON "ReconciliationSession" ("accountId")
  WHERE "status" = 'DRAFT';
