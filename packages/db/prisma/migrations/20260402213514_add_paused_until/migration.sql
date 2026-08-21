-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "pausedUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Income" ADD COLUMN     "pausedUntil" TIMESTAMP(3);
