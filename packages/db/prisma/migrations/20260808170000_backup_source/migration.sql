-- Where a backup came from, which decides whether retention may delete it.
--
-- Retention keeps the newest N and drops the rest. That is right for routine
-- backups and wrong for the other two sources: a PRE_RESTORE snapshot is the
-- rollback point for the restore that just ran, and an IMPORTED dump was
-- supplied by hand precisely because it existed nowhere else.
--
-- Additive and defaulted, so production can take this while a client generated
-- before it keeps serving (see 20260808160000_transaction_is_cash_back). Every
-- existing row is MANUAL, which is what they all are.
CREATE TYPE "BackupSource" AS ENUM ('MANUAL', 'PRE_RESTORE', 'IMPORTED');

ALTER TABLE "Backup" ADD COLUMN "source" "BackupSource" NOT NULL DEFAULT 'MANUAL';
