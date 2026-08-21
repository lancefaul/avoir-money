-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "hasRewards" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "rewardsBalance" DECIMAL(65,30) NOT NULL DEFAULT 0;
