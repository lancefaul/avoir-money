-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "parentId" TEXT,
ADD COLUMN     "preTaxAmount" DECIMAL(65,30),
ADD COLUMN     "taxAmount" DECIMAL(65,30),
ADD COLUMN     "taxRate" DECIMAL(65,30);

-- Convert UtilityReading.type from enum to text (preserving data)
ALTER TABLE "UtilityReading" ALTER COLUMN "type" SET DATA TYPE TEXT USING "type"::TEXT;

-- DropEnum (safe now that no column references it)
DROP TYPE IF EXISTS "UtilityType";

-- CreateTable
CREATE TABLE "CustomUtilityType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomUtilityType_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomUtilityType_name_key" ON "CustomUtilityType"("name");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
