-- CreateTable
CREATE TABLE "TradeDetail" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "assetType" TEXT NOT NULL,
    "ticker" TEXT,
    "quantity" DECIMAL(65,30) NOT NULL,
    "unitPrice" DECIMAL(65,30) NOT NULL,
    "bitcoinUnit" TEXT,
    "custodianId" TEXT,
    "walletId" TEXT,

    CONSTRAINT "TradeDetail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BitcoinPaymentDetail" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "quantity" DECIMAL(65,30) NOT NULL,
    "unitPrice" DECIMAL(65,30) NOT NULL,
    "bitcoinUnit" TEXT NOT NULL,
    "incomeType" TEXT,

    CONSTRAINT "BitcoinPaymentDetail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TradeDetail_transactionId_key" ON "TradeDetail"("transactionId");

-- CreateIndex
CREATE INDEX "TradeDetail_custodianId_idx" ON "TradeDetail"("custodianId");

-- CreateIndex
CREATE INDEX "TradeDetail_walletId_idx" ON "TradeDetail"("walletId");

-- CreateIndex
CREATE UNIQUE INDEX "BitcoinPaymentDetail_transactionId_key" ON "BitcoinPaymentDetail"("transactionId");

-- CreateIndex
CREATE INDEX "BitcoinPaymentDetail_walletId_idx" ON "BitcoinPaymentDetail"("walletId");

-- AddForeignKey
ALTER TABLE "TradeDetail" ADD CONSTRAINT "TradeDetail_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeDetail" ADD CONSTRAINT "TradeDetail_custodianId_fkey" FOREIGN KEY ("custodianId") REFERENCES "Custodian"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeDetail" ADD CONSTRAINT "TradeDetail_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BitcoinPaymentDetail" ADD CONSTRAINT "BitcoinPaymentDetail_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BitcoinPaymentDetail" ADD CONSTRAINT "BitcoinPaymentDetail_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
