-- AlterTable: convert Category.group from CategoryGroup enum to TEXT
-- First add a temp column, copy data, drop old, rename
ALTER TABLE "Category" ADD COLUMN "group_new" TEXT;
UPDATE "Category" SET "group_new" = "group"::TEXT;
ALTER TABLE "Category" DROP COLUMN "group";
ALTER TABLE "Category" RENAME COLUMN "group_new" TO "group";
ALTER TABLE "Category" ALTER COLUMN "group" SET NOT NULL;

-- Drop the enum type
DROP TYPE IF EXISTS "CategoryGroup";
