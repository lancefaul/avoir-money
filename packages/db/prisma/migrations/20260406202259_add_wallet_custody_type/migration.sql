-- CreateEnum
CREATE TYPE "CustodyType" AS ENUM ('CUSTODIAL', 'NON_CUSTODIAL');

-- CreateEnum
CREATE TYPE "StorageType" AS ENUM ('HOT', 'COLD');

-- AlterTable
ALTER TABLE "Wallet" ADD COLUMN     "custodyType" "CustodyType" NOT NULL DEFAULT 'NON_CUSTODIAL',
ADD COLUMN     "storageType" "StorageType";

-- CreateTable
CREATE TABLE "InvestmentTransfer" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fromHoldingId" TEXT NOT NULL,
    "toHoldingId" TEXT NOT NULL,
    "quantity" DECIMAL(65,30) NOT NULL,
    "bitcoinPrice" DECIMAL(65,30),
    "feeAmount" DECIMAL(65,30),
    "feeUnit" TEXT,
    "feeBtc" DECIMAL(65,30),
    "ticker" TEXT,
    "feeTransactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvestmentTransfer_pkey" PRIMARY KEY ("id")
);
