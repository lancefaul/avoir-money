-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "parentAccountId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Account_parentAccountId_key" ON "Account"("parentAccountId");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_parentAccountId_fkey" FOREIGN KEY ("parentAccountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
