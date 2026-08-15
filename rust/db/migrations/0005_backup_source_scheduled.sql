-- Add SCHEDULED to Backup.source.
--
-- SQLite cannot alter a CHECK constraint in place, so the table is rebuilt.
-- This is the standard twelve-step procedure reduced to what applies here:
-- there are no foreign keys pointing AT `Backup` and none leaving it, so no
-- referential integrity has to be suspended, and the only index is on
-- `createdAt`.
--
-- Why a fourth source rather than reusing MANUAL: retention counts and evicts
-- within a single source. If a scheduled run were labelled MANUAL, a daily
-- schedule at the default retention of 7 would delete every deliberate backup
-- the user took within a week — including the one taken immediately before a
-- risky import, which is the exact moment the feature exists for. Keeping the
-- buckets separate means "I asked for this" and "the app took this on a timer"
-- expire independently, which is what the two labels already meant.

CREATE TABLE "Backup_new" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "filepath" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "status" TEXT NOT NULL CHECK ("status" IN ('COMPLETED', 'FAILED', 'RESTORING')),
    "error" TEXT,
    "completedAt" TEXT,
    "createdAt" TEXT NOT NULL,
    "source" TEXT NOT NULL CHECK ("source" IN ('MANUAL', 'PRE_RESTORE', 'IMPORTED', 'SCHEDULED')),
    PRIMARY KEY ("id")
);

INSERT INTO "Backup_new"
    ("id","filename","filepath","sizeBytes","status","error","completedAt","createdAt","source")
SELECT "id","filename","filepath","sizeBytes","status","error","completedAt","createdAt","source"
  FROM "Backup";

DROP TABLE "Backup";
ALTER TABLE "Backup_new" RENAME TO "Backup";

CREATE INDEX "Backup_createdAt_idx" ON "Backup" ("createdAt");
