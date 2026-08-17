-- Create CategoryGroup table
CREATE TABLE "CategoryGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#94a3b8',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CategoryGroup_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CategoryGroup_name_key" ON "CategoryGroup"("name");

-- Populate from existing distinct group values
INSERT INTO "CategoryGroup" ("id", "name", "color")
SELECT
    gen_random_uuid()::TEXT,
    "group",
    COALESCE((SELECT c2."color" FROM "Category" c2 WHERE c2."group" = c."group" AND c2."color" IS NOT NULL LIMIT 1), '#94a3b8')
FROM (SELECT DISTINCT "group" FROM "Category") c;

-- Add groupId column to Category
ALTER TABLE "Category" ADD COLUMN "groupId" TEXT;

-- Populate groupId from the group name
UPDATE "Category" SET "groupId" = (
    SELECT "id" FROM "CategoryGroup" WHERE "CategoryGroup"."name" = "Category"."group"
);

-- Make groupId required
ALTER TABLE "Category" ALTER COLUMN "groupId" SET NOT NULL;

-- Drop old columns
ALTER TABLE "Category" DROP COLUMN "group";
ALTER TABLE "Category" DROP COLUMN "color";

-- Add foreign key
ALTER TABLE "Category" ADD CONSTRAINT "Category_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "CategoryGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
