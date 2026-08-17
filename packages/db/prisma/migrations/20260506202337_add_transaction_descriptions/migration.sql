-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "descriptionId" TEXT;

-- CreateTable
CREATE TABLE "TransactionDescription" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransactionDescription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TransactionDescription_name_key" ON "TransactionDescription"("name");

-- CreateIndex
CREATE INDEX "Transaction_descriptionId_idx" ON "Transaction"("descriptionId");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_descriptionId_fkey" FOREIGN KEY ("descriptionId") REFERENCES "TransactionDescription"("id") ON DELETE SET NULL ON UPDATE CASCADE;
