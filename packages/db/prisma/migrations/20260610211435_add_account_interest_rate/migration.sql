-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "earnsInterest" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "interestRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "interestRateType" TEXT NOT NULL DEFAULT 'APY';
