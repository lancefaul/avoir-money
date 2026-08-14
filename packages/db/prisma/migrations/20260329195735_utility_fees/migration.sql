-- AlterTable
ALTER TABLE "UtilityReading" ADD COLUMN     "convenienceFee" DECIMAL(65,30),
ADD COLUMN     "convenienceFeeType" TEXT,
ADD COLUMN     "otherFees" DECIMAL(65,30);
