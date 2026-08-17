CREATE TABLE "UtilityLink" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "expenseId" TEXT NOT NULL,
    CONSTRAINT "UtilityLink_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UtilityLink_type_key" ON "UtilityLink"("type");
ALTER TABLE "UtilityLink" ADD CONSTRAINT "UtilityLink_expenseId_fkey"
    FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
