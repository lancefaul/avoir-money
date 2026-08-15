-- Convert Account.type from AccountType enum to TEXT
ALTER TABLE "Account" ADD COLUMN "type_new" TEXT;
UPDATE "Account" SET "type_new" = "type"::TEXT;
ALTER TABLE "Account" DROP COLUMN "type";
ALTER TABLE "Account" RENAME COLUMN "type_new" TO "type";
ALTER TABLE "Account" ALTER COLUMN "type" SET NOT NULL;

DROP TYPE IF EXISTS "AccountType";
