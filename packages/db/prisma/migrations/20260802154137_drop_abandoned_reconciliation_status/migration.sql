/*
  Warnings:

  - The values [ABANDONED] on the enum `ReconciliationStatus` will be removed. If these variants are still used in the database, this will fail.
    (Verified 0 rows carry ABANDONED before applying — the 28 historical sessions were deleted 2026-07-20; ADR-029 made `abandon` delete the session outright.)
*/
-- AlterEnum
-- The partial unique index `one_draft_per_account` has a WHERE predicate
-- (`status = 'DRAFT'`) that references the enum type, so it must be dropped
-- before the column-type swap and recreated after — otherwise the ALTER fails
-- with `operator does not exist: ReconciliationStatus_new = ReconciliationStatus`.
-- The plain btree index (accountId, status) needs no such handling; Postgres
-- rebuilds it automatically across the type change.
BEGIN;
DROP INDEX "ReconciliationSession_one_draft_per_account";
CREATE TYPE "ReconciliationStatus_new" AS ENUM ('DRAFT', 'RECONCILED');
ALTER TABLE "ReconciliationSession" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "ReconciliationSession" ALTER COLUMN "status" TYPE "ReconciliationStatus_new" USING ("status"::text::"ReconciliationStatus_new");
ALTER TYPE "ReconciliationStatus" RENAME TO "ReconciliationStatus_old";
ALTER TYPE "ReconciliationStatus_new" RENAME TO "ReconciliationStatus";
DROP TYPE "ReconciliationStatus_old";
ALTER TABLE "ReconciliationSession" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
CREATE UNIQUE INDEX "ReconciliationSession_one_draft_per_account"
  ON "ReconciliationSession" ("accountId")
  WHERE "status" = 'DRAFT';
COMMIT;
