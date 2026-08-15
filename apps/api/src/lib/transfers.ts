/**
 * Investment transfer utilities.
 * Pure helper functions for transfer calculations and DB orchestration.
 */

import type { prisma } from '@budget-tracker/db';
import type { BitcoinTransferInput, StockTransferInput } from '@budget-tracker/core';
import { today } from './dates.js';

/** Prisma interactive-transaction client (omits $connect, $transaction, etc.) */
type PrismaTransactionClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Validated bitcoin transfer input (after Zod parsing). */
type ValidatedBitcoinTransfer = BitcoinTransferInput;

const SATS_PER_BTC = 100_000_000;

/**
 * Convert a fee amount to BTC based on the fee unit.
 *
 * - Bitcoin: returned as-is
 * - Sats: divided by 100,000,000
 * - USD: divided by the current bitcoin price
 */
function convertFeeToBtc(
  feeAmount: number,
  feeUnit: 'Bitcoin' | 'Sats' | 'USD',
  bitcoinPrice: number,
): number {
  switch (feeUnit) {
    case 'Bitcoin':
      return feeAmount;
    case 'Sats':
      return feeAmount / SATS_PER_BTC;
    case 'USD':
      return feeAmount / bitcoinPrice;
  }
}

/**
 * Compute the proportional cost basis for a transfer.
 *
 * When transferring a portion of a holding, the cost basis moves
 * proportionally: (transferQuantity / sourceQuantity) * sourceCostBasis.
 *
 * Returns 0 if sourceQuantity is zero or negative (no basis to apportion).
 */
function computeProportionalCostBasis(
  transferQuantity: number,
  sourceQuantity: number,
  sourceCostBasis: number,
): number {
  if (sourceQuantity <= 0) return 0;
  return (transferQuantity / sourceQuantity) * sourceCostBasis;
}

/**
 * Normalize a bitcoin quantity to BTC.
 *
 * If the unit is Sats, converts to BTC by dividing by 100,000,000.
 * If the unit is already Bitcoin, returns the value unchanged.
 */
function normalizeQuantityToBtc(quantity: number, unit: 'Bitcoin' | 'Sats'): number {
  return unit === 'Sats' ? quantity / SATS_PER_BTC : quantity;
}

// ─── Bitcoin Transfer Orchestration ───

/**
 * Execute a bitcoin wallet-to-wallet transfer inside a Prisma transaction.
 *
 * 1. Normalize quantity to BTC, convert fee to BTC
 * 2. Verify source holding exists and has sufficient balance (quantity + fee)
 * 3. Decrement source holding quantity and cost basis proportionally
 * 4. Find or create destination holding, increment quantity and cost basis
 * 5. Create InvestmentTransfer audit record
 *
 * Does NOT create a Transaction record — bitcoin fees are tracked within
 * the investments domain only.
 */
export async function executeBitcoinTransfer(
  input: ValidatedBitcoinTransfer,
  tx: PrismaTransactionClient,
) {
  const { fromWalletId, toWalletId, quantity, bitcoinUnit, bitcoinPrice, feeAmount, feeUnit } =
    input;

  // 1. Normalize quantity and fee to BTC
  const transferBtc = normalizeQuantityToBtc(quantity, bitcoinUnit);
  const feeBtc =
    feeAmount && feeUnit && bitcoinPrice ? convertFeeToBtc(feeAmount, feeUnit, bitcoinPrice) : 0;
  const totalDeduction = transferBtc + feeBtc;

  // 2. Verify source holding exists and has sufficient balance
  const sourceHolding = await tx.investmentHolding.findFirst({
    where: { walletId: fromWalletId, type: 'BITCOIN' },
  });

  if (!sourceHolding) {
    throw new Error('Source wallet has no bitcoin holding');
  }

  const sourceQty = Number(sourceHolding.quantity);
  const sourceCostBasis = Number(sourceHolding.costBasis ?? 0);

  if (sourceQty < totalDeduction) {
    throw new Error(
      feeBtc > 0
        ? `Insufficient balance: have ${sourceQty} BTC, need ${transferBtc} (transfer) + ${feeBtc} (fee)`
        : `Insufficient balance: have ${sourceQty} BTC, trying to transfer ${transferBtc}`,
    );
  }

  // 3. Compute proportional cost basis for the transfer amount (excluding fee)
  const proportionalCostBasis = computeProportionalCostBasis(
    transferBtc,
    sourceQty,
    sourceCostBasis,
  );

  // Decrement source holding
  await tx.investmentHolding.update({
    where: { id: sourceHolding.id },
    data: {
      quantity: { decrement: totalDeduction },
      costBasis: { decrement: proportionalCostBasis },
    },
  });

  // 4. Find or create destination holding
  let destHolding = await tx.investmentHolding.findFirst({
    where: { walletId: toWalletId, type: 'BITCOIN' },
  });

  if (destHolding) {
    destHolding = await tx.investmentHolding.update({
      where: { id: destHolding.id },
      data: {
        quantity: { increment: transferBtc },
        costBasis: { increment: proportionalCostBasis },
      },
    });
  } else {
    // Look up wallet name for the holding display name
    const destWallet = await tx.wallet.findUniqueOrThrow({ where: { id: toWalletId } });
    destHolding = await tx.investmentHolding.create({
      data: {
        name: destWallet.name,
        ticker: null,
        type: 'BITCOIN',
        quantity: transferBtc,
        costBasis: proportionalCostBasis,
        walletId: toWalletId,
      },
    });
  }

  // 5. Create InvestmentTransfer audit record
  const transfer = await tx.investmentTransfer.create({
    data: {
      type: 'BITCOIN',
      fromHoldingId: sourceHolding.id,
      toHoldingId: destHolding.id,
      quantity: transferBtc,
      bitcoinPrice: bitcoinPrice ?? null,
      feeAmount: feeAmount ?? null,
      feeUnit: feeUnit ?? null,
      feeBtc: feeBtc > 0 ? feeBtc : null,
    },
  });

  return transfer;
}

// ─── Reverse Transfer ───

/**
 * Reverse an investment transfer inside a Prisma transaction.
 *
 * 1. Restore source holding: increment quantity by transfer.quantity,
 *    increment costBasis proportionally (based on destination holding's current ratio)
 * 2. Reduce destination holding: decrement quantity and costBasis proportionally
 * 3. For STOCK transfers with a feeTransactionId: restore account balance, delete fee tx
 * 4. For BITCOIN transfers with feeBtc > 0: add feeBtc back to source holding quantity
 */
export async function reverseTransfer(
  transfer: {
    id: string;
    type: string;
    fromHoldingId: string;
    toHoldingId: string;
    quantity: { toNumber(): number } | number;
    feeBtc: { toNumber(): number } | number | null;
    feeTransactionId: string | null;
  },
  tx: PrismaTransactionClient,
) {
  const transferQty =
    typeof transfer.quantity === 'number' ? transfer.quantity : transfer.quantity.toNumber();
  const feeBtc =
    transfer.feeBtc !== null
      ? typeof transfer.feeBtc === 'number'
        ? transfer.feeBtc
        : transfer.feeBtc.toNumber()
      : 0;

  // Load destination holding to compute proportional cost basis to move back
  const destHolding = await tx.investmentHolding.findUniqueOrThrow({
    where: { id: transfer.toHoldingId },
  });
  const destQty = Number(destHolding.quantity);
  const destCostBasis = Number(destHolding.costBasis ?? 0);

  const proportionalCostBasis = destQty > 0 ? (transferQty / destQty) * destCostBasis : 0;

  // 1. Restore source holding quantity and cost basis
  const sourceIncrement = transferQty + (transfer.type === 'BITCOIN' ? feeBtc : 0);
  await tx.investmentHolding.update({
    where: { id: transfer.fromHoldingId },
    data: {
      quantity: { increment: sourceIncrement },
      costBasis: { increment: proportionalCostBasis },
    },
  });

  // 2. Reduce destination holding
  await tx.investmentHolding.update({
    where: { id: transfer.toHoldingId },
    data: {
      quantity: { decrement: transferQty },
      costBasis: { decrement: proportionalCostBasis },
    },
  });

  // 3. For STOCK transfers with a fee transaction: restore account balance and delete tx
  if (transfer.type === 'STOCK' && transfer.feeTransactionId) {
    const feeTx = await tx.transaction.findUnique({
      where: { id: transfer.feeTransactionId },
    });
    if (feeTx) {
      await tx.account.update({
        where: { id: feeTx.accountId ?? undefined },
        data: { balance: { increment: Number(feeTx.amount) } },
      });
      await tx.transaction.delete({ where: { id: feeTx.id } });
    }
  }

  // Steps 4 (BITCOIN feeBtc restoration) is already handled in step 1 above
  // by adding feeBtc to the source increment.
}

// ─── Stock Transfer Orchestration ───

/** Validated stock transfer input (after Zod parsing). */
type ValidatedStockTransfer = StockTransferInput;

/**
 * Execute a stock custodian-to-custodian transfer inside a Prisma transaction.
 *
 * 1. Verify source holding exists and belongs to the source custodian
 * 2. Transfer the full holding quantity for that stock
 * 3. Decrement source holding quantity and cost basis proportionally
 * 4. Find or create destination holding (matching ticker + destination custodian)
 * 5. If fee provided: create EXPENSE Transaction, deduct from source account
 * 6. Create InvestmentTransfer audit record
 */
export async function executeStockTransfer(
  input: ValidatedStockTransfer,
  tx: PrismaTransactionClient,
) {
  const {
    fromCustodianId,
    toCustodianId,
    holdingId,
    quantity: requestedQty,
    feeAmount,
    feeBudgetId,
    feeAccountId,
  } = input;

  // 1. Verify source holding exists and belongs to source custodian
  const sourceHolding = await tx.investmentHolding.findFirst({
    where: { id: holdingId, custodianId: fromCustodianId },
  });

  if (!sourceHolding) {
    throw new Error('Holding not found at source custodian');
  }

  const sourceQty = Number(sourceHolding.quantity);
  const sourceCostBasis = Number(sourceHolding.costBasis ?? 0);

  if (sourceQty <= 0) {
    throw new Error(`Insufficient balance: have ${sourceQty} shares, trying to transfer`);
  }

  // 2. Transfer the requested quantity or full holding if omitted
  const transferQty = requestedQty ?? sourceQty;

  if (transferQty > sourceQty) {
    throw new Error(
      `Insufficient balance: have ${sourceQty} shares, trying to transfer ${transferQty}`,
    );
  }

  // 3. Compute proportional cost basis
  const proportionalCostBasis = computeProportionalCostBasis(
    transferQty,
    sourceQty,
    sourceCostBasis,
  );

  // Decrement source holding
  await tx.investmentHolding.update({
    where: { id: sourceHolding.id },
    data: {
      quantity: { decrement: transferQty },
      costBasis: { decrement: proportionalCostBasis },
    },
  });

  // 4. Find or create destination holding (matching ticker + destination custodian)
  let destHolding = await tx.investmentHolding.findFirst({
    where: { ticker: sourceHolding.ticker, custodianId: toCustodianId },
  });

  if (destHolding) {
    destHolding = await tx.investmentHolding.update({
      where: { id: destHolding.id },
      data: {
        quantity: { increment: transferQty },
        costBasis: { increment: proportionalCostBasis },
      },
    });
  } else {
    const destCustodian = await tx.custodian.findUniqueOrThrow({ where: { id: toCustodianId } });
    destHolding = await tx.investmentHolding.create({
      data: {
        name: `${destCustodian.name} $${sourceHolding.ticker}`,
        ticker: sourceHolding.ticker,
        type: sourceHolding.type,
        quantity: transferQty,
        costBasis: proportionalCostBasis,
        custodianId: toCustodianId,
      },
    });
  }

  // 5. If fee provided: create EXPENSE Transaction and deduct from account
  let feeTransactionId: string | null = null;

  if (feeAmount && feeAmount > 0 && feeBudgetId && feeAccountId) {
    const feeTx = await tx.transaction.create({
      data: {
        type: 'EXPENSE',
        name: `Stock transfer fee: ${sourceHolding.ticker}`,
        amount: feeAmount,
        date: today(),
        budgetId: feeBudgetId,
        accountId: feeAccountId,
      },
    });
    feeTransactionId = feeTx.id;

    // Deduct fee from account balance (EXPENSE decrements)
    await tx.account.update({
      where: { id: feeAccountId },
      data: { balance: { decrement: feeAmount } },
    });
  }

  // 6. Create InvestmentTransfer audit record
  const transfer = await tx.investmentTransfer.create({
    data: {
      type: 'STOCK',
      fromHoldingId: sourceHolding.id,
      toHoldingId: destHolding.id,
      quantity: transferQty,
      ticker: sourceHolding.ticker,
      feeAmount: feeAmount ?? null,
      feeTransactionId,
    },
  });

  return transfer;
}
