-- AlterTable
ALTER TABLE "Custodian" ADD COLUMN     "managementUrl" TEXT;

-- AlterTable
ALTER TABLE "Debt" ADD COLUMN     "managementUrl" TEXT;

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "managementUrl" TEXT;

-- AlterTable
ALTER TABLE "Income" ADD COLUMN     "managementUrl" TEXT;

-- AlterTable
ALTER TABLE "Wallet" ADD COLUMN     "managementUrl" TEXT;
