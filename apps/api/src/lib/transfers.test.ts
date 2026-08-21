/**
 * Integration tests for the transfers module.
 *
 * Tests reverseTransfer, executeStockTransfer, and executeBitcoinTransfer with real DB state.
 * Property tests live in transfers.property.test.ts.
 *
 * Feature: backend-coverage-push, backend-coverage-100
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 13.4
 */
import { describe, it, expect } from 'vitest';
import { prisma } from '@budget-tracker/db';
import { reverseTransfer, executeStockTransfer, executeBitcoinTransfer } from './transfers.js';
import {
  createWallet,
  createCustodian,
  createHolding,
  createAccount,
  createBudgetGroup,
  createBudget,
} from '../test/helpers.js';

// ─── reverseTransfer ───

describe('reverseTransfer', () => {
  it('reverses a BITCOIN transfer — restores source by transferQuantity + feeBtc, decrements destination, restores cost basis', async () => {
    const sourceWallet = await createWallet();
    const destWallet = await createWallet();

    // Source holding: after transfer has 3.5 BTC
    const sourceHolding = await createHolding({
      walletId: sourceWallet.id,
      type: 'BITCOIN',
      quantity: 3.5,
      costBasis: 175000,
    });

    // Destination holding: received 1.0 BTC with proportional cost basis
    const destHolding = await createHolding({
      walletId: destWallet.id,
      type: 'BITCOIN',
      quantity: 2.0,
      costBasis: 100000,
    });

    // The transfer record: 1.0 BTC transferred with 0.5 BTC fee
    const transfer = {
      id: 'test-transfer-btc',
      type: 'BITCOIN',
      fromHoldingId: sourceHolding.id,
      toHoldingId: destHolding.id,
      quantity: 1.0,
      feeBtc: 0.5,
      feeTransactionId: null,
    };

    await prisma.$transaction(async (tx) => {
      await reverseTransfer(transfer, tx);
    });

    // Verify source holding: incremented by transferQuantity + feeBtc = 1.0 + 0.5 = 1.5
    const updatedSource = await prisma.investmentHolding.findUniqueOrThrow({
      where: { id: sourceHolding.id },
    });
    expect(Number(updatedSource.quantity)).toBeCloseTo(3.5 + 1.0 + 0.5, 8); // 5.0

    // Verify destination holding: decremented by transferQuantity = 1.0
    const updatedDest = await prisma.investmentHolding.findUniqueOrThrow({
      where: { id: destHolding.id },
    });
    expect(Number(updatedDest.quantity)).toBeCloseTo(2.0 - 1.0, 8); // 1.0

    // Verify cost basis moved proportionally from destination back to source
    // Proportional cost basis = (1.0 / 2.0) * 100000 = 50000
    expect(Number(updatedSource.costBasis)).toBeCloseTo(175000 + 50000, 2); // 225000
    expect(Number(updatedDest.costBasis)).toBeCloseTo(100000 - 50000, 2); // 50000
  });

  it('reverses a STOCK transfer with feeTransactionId — restores account balance and deletes fee transaction', async () => {
    const sourceCustodian = await createCustodian();
    const destCustodian = await createCustodian();
    const feeAccount = await createAccount('Fee Account', 'CHECKING');

    // Source holding: after transfer has 50 shares
    const sourceHolding = await createHolding({
      custodianId: sourceCustodian.id,
      walletId: null,
      type: 'STOCK',
      ticker: 'AAPL',
      quantity: 50,
      costBasis: 5000,
    });

    // Destination holding: received 10 shares
    const destHolding = await createHolding({
      custodianId: destCustodian.id,
      walletId: null,
      type: 'STOCK',
      ticker: 'AAPL',
      quantity: 10,
      costBasis: 1000,
    });

    // Fee transaction that was created during the original transfer
    const feeTx = await prisma.transaction.create({
      data: {
        type: 'EXPENSE',
        name: 'Stock transfer fee: AAPL',
        amount: 25,
        date: new Date(Date.UTC(2026, 5, 15)),
        accountId: feeAccount.id,
      },
    });

    // Set account balance to reflect the fee was already deducted
    await prisma.account.update({
      where: { id: feeAccount.id },
      data: { balance: 975 }, // started at 1000, fee of 25 deducted
    });

    const transfer = {
      id: 'test-transfer-stock-fee',
      type: 'STOCK',
      fromHoldingId: sourceHolding.id,
      toHoldingId: destHolding.id,
      quantity: 10,
      feeBtc: null,
      feeTransactionId: feeTx.id,
    };

    await prisma.$transaction(async (tx) => {
      await reverseTransfer(transfer, tx);
    });

    // Verify account balance restored by fee amount
    const updatedAccount = await prisma.account.findUniqueOrThrow({
      where: { id: feeAccount.id },
    });
    expect(Number(updatedAccount.balance)).toBe(975 + 25); // 1000

    // Verify fee transaction deleted
    const deletedTx = await prisma.transaction.findUnique({
      where: { id: feeTx.id },
    });
    expect(deletedTx).toBeNull();

    // Verify holdings restored
    const updatedSource = await prisma.investmentHolding.findUniqueOrThrow({
      where: { id: sourceHolding.id },
    });
    expect(Number(updatedSource.quantity)).toBe(50 + 10); // 60

    const updatedDest = await prisma.investmentHolding.findUniqueOrThrow({
      where: { id: destHolding.id },
    });
    expect(Number(updatedDest.quantity)).toBe(0); // 10 - 10
  });

  it('reverses a STOCK transfer without feeTransactionId — restores holdings without touching transactions', async () => {
    const sourceCustodian = await createCustodian();
    const destCustodian = await createCustodian();

    const sourceHolding = await createHolding({
      custodianId: sourceCustodian.id,
      walletId: null,
      type: 'STOCK',
      ticker: 'GOOG',
      quantity: 20,
      costBasis: 4000,
    });

    const destHolding = await createHolding({
      custodianId: destCustodian.id,
      walletId: null,
      type: 'STOCK',
      ticker: 'GOOG',
      quantity: 5,
      costBasis: 1000,
    });

    const transfer = {
      id: 'test-transfer-stock-nofee',
      type: 'STOCK',
      fromHoldingId: sourceHolding.id,
      toHoldingId: destHolding.id,
      quantity: 5,
      feeBtc: null,
      feeTransactionId: null,
    };

    // Count transactions before reversal
    const txCountBefore = await prisma.transaction.count();

    await prisma.$transaction(async (tx) => {
      await reverseTransfer(transfer, tx);
    });

    // Verify holdings restored
    const updatedSource = await prisma.investmentHolding.findUniqueOrThrow({
      where: { id: sourceHolding.id },
    });
    expect(Number(updatedSource.quantity)).toBe(20 + 5); // 25

    const updatedDest = await prisma.investmentHolding.findUniqueOrThrow({
      where: { id: destHolding.id },
    });
    expect(Number(updatedDest.quantity)).toBe(0); // 5 - 5

    // Verify cost basis moved proportionally
    // Proportional cost basis = (5 / 5) * 1000 = 1000
    expect(Number(updatedSource.costBasis)).toBeCloseTo(4000 + 1000, 2); // 5000
    expect(Number(updatedDest.costBasis)).toBeCloseTo(1000 - 1000, 2); // 0

    // Verify no transactions were touched
    const txCountAfter = await prisma.transaction.count();
    expect(txCountAfter).toBe(txCountBefore);
  });
});

// ─── executeStockTransfer ───

describe('executeStockTransfer', () => {
  it('transfers stock — decrements source, finds-or-creates destination, creates InvestmentTransfer audit record', async () => {
    const sourceCustodian = await createCustodian();
    const destCustodian = await createCustodian();

    const sourceHolding = await createHolding({
      custodianId: sourceCustodian.id,
      walletId: null,
      type: 'STOCK',
      ticker: 'MSFT',
      quantity: 100,
      costBasis: 20000,
    });

    const input = {
      fromCustodianId: sourceCustodian.id,
      toCustodianId: destCustodian.id,
      holdingId: sourceHolding.id,
      quantity: 30,
    };

    let transferRecord: Awaited<ReturnType<typeof executeStockTransfer>>;
    await prisma.$transaction(async (tx) => {
      transferRecord = await executeStockTransfer(input, tx);
    });

    // Verify source holding decremented
    const updatedSource = await prisma.investmentHolding.findUniqueOrThrow({
      where: { id: sourceHolding.id },
    });
    expect(Number(updatedSource.quantity)).toBe(70); // 100 - 30

    // Verify proportional cost basis moved: (30 / 100) * 20000 = 6000
    expect(Number(updatedSource.costBasis)).toBeCloseTo(20000 - 6000, 2); // 14000

    // Verify destination holding created at target custodian
    const destHolding = await prisma.investmentHolding.findFirst({
      where: { ticker: 'MSFT', custodianId: destCustodian.id },
    });
    expect(destHolding).not.toBeNull();
    expect(Number(destHolding!.quantity)).toBe(30);
    expect(Number(destHolding!.costBasis)).toBeCloseTo(6000, 2);

    // Verify InvestmentTransfer audit record created
    const audit = await prisma.investmentTransfer.findFirst({
      where: { fromHoldingId: sourceHolding.id },
    });
    expect(audit).not.toBeNull();
    expect(audit!.type).toBe('STOCK');
    expect(Number(audit!.quantity)).toBe(30);
    expect(audit!.ticker).toBe('MSFT');
    expect(audit!.toHoldingId).toBe(destHolding!.id);
  });

  it('creates EXPENSE transaction for fee and decrements fee account balance', async () => {
    const sourceCustodian = await createCustodian();
    const destCustodian = await createCustodian();
    const feeAccount = await createAccount('Fee Account', 'CHECKING');

    // Set initial balance on fee account
    await prisma.account.update({
      where: { id: feeAccount.id },
      data: { balance: 5000 },
    });

    const group = await createBudgetGroup();
    const feeBudget = await createBudget(group.id, 'Transfer Fees');

    const sourceHolding = await createHolding({
      custodianId: sourceCustodian.id,
      walletId: null,
      type: 'STOCK',
      ticker: 'TSLA',
      quantity: 50,
      costBasis: 10000,
    });

    const input = {
      fromCustodianId: sourceCustodian.id,
      toCustodianId: destCustodian.id,
      holdingId: sourceHolding.id,
      quantity: 10,
      feeAmount: 75,
      feeBudgetId: feeBudget.id,
      feeAccountId: feeAccount.id,
    };

    await prisma.$transaction(async (tx) => {
      await executeStockTransfer(input, tx);
    });

    // Verify EXPENSE transaction created for the fee
    const feeTx = await prisma.transaction.findFirst({
      where: { accountId: feeAccount.id, type: 'EXPENSE' },
    });
    expect(feeTx).not.toBeNull();
    expect(Number(feeTx!.amount)).toBe(75);
    expect(feeTx!.budgetId).toBe(feeBudget.id);
    expect(feeTx!.name).toContain('Stock transfer fee');
    expect(feeTx!.name).toContain('TSLA');

    // Verify fee account balance decremented
    const updatedAccount = await prisma.account.findUniqueOrThrow({
      where: { id: feeAccount.id },
    });
    expect(Number(updatedAccount.balance)).toBe(5000 - 75); // 4925

    // Verify the transfer audit record references the fee transaction
    const audit = await prisma.investmentTransfer.findFirst({
      where: { fromHoldingId: sourceHolding.id },
    });
    expect(audit).not.toBeNull();
    expect(audit!.feeTransactionId).toBe(feeTx!.id);
    expect(Number(audit!.feeAmount)).toBe(75);
  });

  it('throws "Holding not found at source custodian" for nonexistent holding', async () => {
    const sourceCustodian = await createCustodian();
    const destCustodian = await createCustodian();

    const input = {
      fromCustodianId: sourceCustodian.id,
      toCustodianId: destCustodian.id,
      holdingId: 'nonexistent-holding-id',
      quantity: 10,
    };

    await expect(
      prisma.$transaction(async (tx) => {
        await executeStockTransfer(input, tx);
      }),
    ).rejects.toThrow('Holding not found at source custodian');
  });

  it('throws insufficient balance error when quantity exceeds source holding', async () => {
    const sourceCustodian = await createCustodian();
    const destCustodian = await createCustodian();

    const sourceHolding = await createHolding({
      custodianId: sourceCustodian.id,
      walletId: null,
      type: 'STOCK',
      ticker: 'AMZN',
      quantity: 5,
      costBasis: 1000,
    });

    const input = {
      fromCustodianId: sourceCustodian.id,
      toCustodianId: destCustodian.id,
      holdingId: sourceHolding.id,
      quantity: 50, // way more than the 5 available
    };

    await expect(
      prisma.$transaction(async (tx) => {
        await executeStockTransfer(input, tx);
      }),
    ).rejects.toThrow(/Insufficient balance/);
  });
});

// ─── executeBitcoinTransfer (gap coverage) ───

describe('executeBitcoinTransfer', () => {
  it('throws when source wallet has no bitcoin holding', async () => {
    const fromWallet = await createWallet();
    const toWallet = await createWallet();
    // No holding created for fromWallet

    const input = {
      fromWalletId: fromWallet.id,
      toWalletId: toWallet.id,
      quantity: 1.0,
      bitcoinUnit: 'Bitcoin' as const,
    };

    await expect(
      prisma.$transaction(async (tx) => {
        await executeBitcoinTransfer(input, tx);
      }),
    ).rejects.toThrow('Source wallet has no bitcoin holding');
  });

  it('converts Sats to BTC before applying transfer', async () => {
    const fromWallet = await createWallet();
    const toWallet = await createWallet();

    await createHolding({
      walletId: fromWallet.id,
      type: 'BITCOIN',
      quantity: 2.0,
      costBasis: 100000,
    });

    const satsToTransfer = 50_000_000; // 0.5 BTC

    const input = {
      fromWalletId: fromWallet.id,
      toWalletId: toWallet.id,
      quantity: satsToTransfer,
      bitcoinUnit: 'Sats' as const,
    };

    await prisma.$transaction(async (tx) => {
      await executeBitcoinTransfer(input, tx);
    });

    // Source should have 2.0 - 0.5 = 1.5 BTC
    const source = await prisma.investmentHolding.findFirst({
      where: { walletId: fromWallet.id, type: 'BITCOIN' },
    });
    expect(Number(source!.quantity)).toBeCloseTo(1.5, 8);

    // Destination should have 0.5 BTC
    const dest = await prisma.investmentHolding.findFirst({
      where: { walletId: toWallet.id, type: 'BITCOIN' },
    });
    expect(dest).toBeTruthy();
    expect(Number(dest!.quantity)).toBeCloseTo(0.5, 8);
  });

  it('converts USD fee to BTC using bitcoin price', async () => {
    const fromWallet = await createWallet();
    const toWallet = await createWallet();

    await createHolding({
      walletId: fromWallet.id,
      type: 'BITCOIN',
      quantity: 2.0,
      costBasis: 130000,
    });

    const bitcoinPrice = 65000;
    const feeUsd = 6.5; // = 0.0001 BTC at $65k

    const input = {
      fromWalletId: fromWallet.id,
      toWalletId: toWallet.id,
      quantity: 0.5,
      bitcoinUnit: 'Bitcoin' as const,
      bitcoinPrice,
      feeAmount: feeUsd,
      feeUnit: 'USD' as const,
    };

    await prisma.$transaction(async (tx) => {
      await executeBitcoinTransfer(input, tx);
    });

    const feeBtc = feeUsd / bitcoinPrice; // 0.0001
    // Source should have 2.0 - 0.5 - feeBtc
    const source = await prisma.investmentHolding.findFirst({
      where: { walletId: fromWallet.id, type: 'BITCOIN' },
    });
    expect(Number(source!.quantity)).toBeCloseTo(2.0 - 0.5 - feeBtc, 8);

    // Verify audit record has feeBtc
    const audit = await prisma.investmentTransfer.findFirst({
      where: { fromHoldingId: source!.id },
    });
    expect(audit).toBeTruthy();
    expect(Number(audit!.feeBtc)).toBeCloseTo(feeBtc, 8);
  });

  it('throws insufficient balance error with fee-specific message when fee causes shortfall', async () => {
    const fromWallet = await createWallet();
    const toWallet = await createWallet();

    await createHolding({
      walletId: fromWallet.id,
      type: 'BITCOIN',
      quantity: 1.0,
      costBasis: 65000,
    });

    // Transfer 0.9 BTC + 0.2 BTC fee = 1.1 BTC total, but only have 1.0
    const input = {
      fromWalletId: fromWallet.id,
      toWalletId: toWallet.id,
      quantity: 0.9,
      bitcoinUnit: 'Bitcoin' as const,
      bitcoinPrice: 65000,
      feeAmount: 0.2,
      feeUnit: 'Bitcoin' as const,
    };

    await expect(
      prisma.$transaction(async (tx) => {
        await executeBitcoinTransfer(input, tx);
      }),
    ).rejects.toThrow(/transfer.*\+.*fee/i);
  });

  it('increments existing destination holding instead of creating a new one', async () => {
    const fromWallet = await createWallet();
    const toWallet = await createWallet();

    await createHolding({
      walletId: fromWallet.id,
      type: 'BITCOIN',
      quantity: 3.0,
      costBasis: 195000,
    });

    // Pre-existing destination holding
    const existingDest = await createHolding({
      walletId: toWallet.id,
      type: 'BITCOIN',
      quantity: 1.0,
      costBasis: 65000,
    });

    const input = {
      fromWalletId: fromWallet.id,
      toWalletId: toWallet.id,
      quantity: 0.5,
      bitcoinUnit: 'Bitcoin' as const,
    };

    await prisma.$transaction(async (tx) => {
      await executeBitcoinTransfer(input, tx);
    });

    // Destination should be incremented, not a new holding
    const dest = await prisma.investmentHolding.findUniqueOrThrow({
      where: { id: existingDest.id },
    });
    expect(Number(dest.quantity)).toBeCloseTo(1.5, 8);

    // Verify no extra bitcoin holdings were created for the destination wallet
    const destHoldings = await prisma.investmentHolding.findMany({
      where: { walletId: toWallet.id, type: 'BITCOIN' },
    });
    expect(destHoldings).toHaveLength(1);
  });
});

// ─── executeStockTransfer (gap coverage) ───

describe('executeStockTransfer — gap coverage', () => {
  it('throws insufficient balance when source holding has zero quantity', async () => {
    const sourceCustodian = await createCustodian();
    const destCustodian = await createCustodian();

    const sourceHolding = await createHolding({
      custodianId: sourceCustodian.id,
      walletId: null,
      type: 'STOCK',
      ticker: 'NVDA',
      quantity: 0,
      costBasis: 0,
    });

    const input = {
      fromCustodianId: sourceCustodian.id,
      toCustodianId: destCustodian.id,
      holdingId: sourceHolding.id,
      quantity: 10,
    };

    await expect(
      prisma.$transaction(async (tx) => {
        await executeStockTransfer(input, tx);
      }),
    ).rejects.toThrow(/Insufficient balance.*0.*shares/);
  });

  it('transfers full holding quantity when quantity is omitted', async () => {
    const sourceCustodian = await createCustodian();
    const destCustodian = await createCustodian();

    const sourceHolding = await createHolding({
      custodianId: sourceCustodian.id,
      walletId: null,
      type: 'STOCK',
      ticker: 'META',
      quantity: 25,
      costBasis: 5000,
    });

    const input = {
      fromCustodianId: sourceCustodian.id,
      toCustodianId: destCustodian.id,
      holdingId: sourceHolding.id,
      // quantity intentionally omitted — should transfer all 25 shares
    };

    await prisma.$transaction(async (tx) => {
      await executeStockTransfer(input, tx);
    });

    // Source should be fully depleted
    const updatedSource = await prisma.investmentHolding.findUniqueOrThrow({
      where: { id: sourceHolding.id },
    });
    expect(Number(updatedSource.quantity)).toBe(0);
    expect(Number(updatedSource.costBasis)).toBeCloseTo(0, 2);

    // Destination should have all 25 shares with full cost basis
    const destHolding = await prisma.investmentHolding.findFirst({
      where: { ticker: 'META', custodianId: destCustodian.id },
    });
    expect(destHolding).toBeTruthy();
    expect(Number(destHolding!.quantity)).toBe(25);
    expect(Number(destHolding!.costBasis)).toBeCloseTo(5000, 2);
  });

  it('increments existing destination holding instead of creating a new one', async () => {
    const sourceCustodian = await createCustodian();
    const destCustodian = await createCustodian();

    const sourceHolding = await createHolding({
      custodianId: sourceCustodian.id,
      walletId: null,
      type: 'STOCK',
      ticker: 'GOOG',
      quantity: 40,
      costBasis: 8000,
    });

    // Pre-existing destination holding with same ticker at dest custodian
    const existingDest = await createHolding({
      custodianId: destCustodian.id,
      walletId: null,
      type: 'STOCK',
      ticker: 'GOOG',
      quantity: 10,
      costBasis: 2000,
    });

    const input = {
      fromCustodianId: sourceCustodian.id,
      toCustodianId: destCustodian.id,
      holdingId: sourceHolding.id,
      quantity: 15,
    };

    await prisma.$transaction(async (tx) => {
      await executeStockTransfer(input, tx);
    });

    // Destination should be incremented
    const dest = await prisma.investmentHolding.findUniqueOrThrow({
      where: { id: existingDest.id },
    });
    expect(Number(dest.quantity)).toBe(25); // 10 + 15

    // Proportional cost basis: (15/40) * 8000 = 3000
    expect(Number(dest.costBasis)).toBeCloseTo(2000 + 3000, 2);

    // Verify no extra holdings were created
    const destHoldings = await prisma.investmentHolding.findMany({
      where: { ticker: 'GOOG', custodianId: destCustodian.id },
    });
    expect(destHoldings).toHaveLength(1);
  });
});

// ─── reverseTransfer (gap coverage) ───

describe('reverseTransfer — gap coverage', () => {
  it('handles destination holding with zero quantity — proportional cost basis is 0', async () => {
    const sourceWallet = await createWallet();
    const destWallet = await createWallet();

    const sourceHolding = await createHolding({
      walletId: sourceWallet.id,
      type: 'BITCOIN',
      quantity: 1.0,
      costBasis: 50000,
    });

    // Destination holding has been fully depleted (quantity = 0)
    const destHolding = await createHolding({
      walletId: destWallet.id,
      type: 'BITCOIN',
      quantity: 0,
      costBasis: 0,
    });

    const transfer = {
      id: 'test-reverse-zero-dest',
      type: 'BITCOIN',
      fromHoldingId: sourceHolding.id,
      toHoldingId: destHolding.id,
      quantity: 0.5,
      feeBtc: null,
      feeTransactionId: null,
    };

    await prisma.$transaction(async (tx) => {
      await reverseTransfer(transfer, tx);
    });

    // Source should be incremented by transfer quantity (no fee)
    const updatedSource = await prisma.investmentHolding.findUniqueOrThrow({
      where: { id: sourceHolding.id },
    });
    expect(Number(updatedSource.quantity)).toBeCloseTo(1.5, 8);
    // Cost basis increment is 0 because destQty was 0
    expect(Number(updatedSource.costBasis)).toBeCloseTo(50000, 2);

    // Destination should be decremented (goes negative, which is fine for reversal)
    const updatedDest = await prisma.investmentHolding.findUniqueOrThrow({
      where: { id: destHolding.id },
    });
    expect(Number(updatedDest.quantity)).toBeCloseTo(-0.5, 8);
    expect(Number(updatedDest.costBasis)).toBeCloseTo(0, 2);
  });
});
