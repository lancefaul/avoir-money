/**
 * Ledger Service — the single gate for all Transaction mutations.
 *
 * Every code path that creates, updates, or deletes a transaction MUST go through
 * this module. It guarantees:
 * 1. netAmount is always recalculated (equal to amount)
 * 2. All lifecycle hooks fire in priority order
 * 3. The old transaction state is captured for proper reversal
 *
 * No other module should call prisma.transaction.create/update/delete directly
 * for mutations that affect amounts, types, or accounts.
 */
import { prisma } from '@budget-tracker/db';
import { roundCurrency } from '@budget-tracker/core';
import { createLifecycleManager } from './index.js';
import type { TransactionRecord } from './types.js';
import type { DbClient } from './db-client.js';

const lifecycleManager = createLifecycleManager();

// ─── Investment detail sync (typed TradeDetail / BitcoinPaymentDetail rows) ───
//
// During cutover the JSON blobs are still written on the Transaction row (dual-write);
// these keep the typed detail tables in sync from the same validated metadata input.

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Upsert (or, when meta is null, remove) the TradeDetail row for a transaction. */
async function syncTradeDetail(db: DbClient, transactionId: string, meta: unknown): Promise<void> {
  if (meta == null) {
    await db.tradeDetail.deleteMany({ where: { transactionId } });
    return;
  }
  const m = meta as Record<string, unknown>;
  const direction = str(m['direction']);
  const assetType = str(m['assetType']);
  const quantity = num(m['quantity']);
  const unitPrice = num(m['unitPrice']);
  if (!direction || !assetType || quantity === null || unitPrice === null) return;

  const row = {
    direction,
    assetType,
    ticker: str(m['ticker']),
    quantity,
    unitPrice,
    bitcoinUnit: str(m['bitcoinUnit']),
    custodianId: str(m['custodianId']),
    walletId: str(m['walletId']),
  };
  await db.tradeDetail.upsert({
    where: { transactionId },
    create: { transactionId, ...row },
    update: row,
  });
}

/** Upsert (or, when meta is null, remove) the BitcoinPaymentDetail row for a transaction. */
async function syncBitcoinPaymentDetail(
  db: DbClient,
  transactionId: string,
  meta: unknown,
): Promise<void> {
  if (meta == null) {
    await db.bitcoinPaymentDetail.deleteMany({ where: { transactionId } });
    return;
  }
  const m = meta as Record<string, unknown>;
  const walletId = str(m['walletId']);
  const quantity = num(m['quantity']);
  const unitPrice = num(m['unitPrice']);
  const bitcoinUnit = str(m['bitcoinUnit']);
  if (!walletId || quantity === null || unitPrice === null || !bitcoinUnit) return;

  const row = { walletId, quantity, unitPrice, bitcoinUnit, incomeType: str(m['incomeType']) };
  await db.bitcoinPaymentDetail.upsert({
    where: { transactionId },
    create: { transactionId, ...row },
    update: row,
  });
}

/** Fields needed to compute balance effects */
const LEDGER_SELECT = {
  id: true,
  type: true,
  name: true,
  amount: true,
  netAmount: true,
  date: true,
  createdAt: true,
  accountId: true,
  toAccountId: true,
  expenseId: true,
  incomeId: true,
  budgetId: true,
  descriptionId: true,
  tradeDetail: true,
  bitcoinPaymentDetail: true,
  parentId: true,
} as const;

export interface LedgerUpdateData {
  amount?: number;
  name?: string;
  date?: Date;
  type?: string;
  accountId?: string | null;
  toAccountId?: string | null;
  expenseId?: string | null;
  incomeId?: string | null;
  budgetId?: string | null;
  descriptionId?: string | null;
  tradeMetadata?: unknown;
  bitcoinMetadata?: unknown;
  note?: string | null;
  occurrenceDate?: Date | null;
  imported?: boolean;
  /** Cash back / rebate rather than money earned. INCOME only. */
  isCashBack?: boolean;
}

/**
 * Update a transaction through the ledger gate.
 * Recalculates netAmount and dispatches lifecycle hooks.
 *
 * Returns the updated transaction record.
 */
export async function ledgerUpdate(
  id: string,
  changes: LedgerUpdateData,
  db: DbClient = prisma,
): Promise<TransactionRecord> {
  const oldTx = await db.transaction.findUniqueOrThrow({
    where: { id },
    select: LEDGER_SELECT,
  });

  // Compute effective values for netAmount calculation.
  // Every monetary input is rounded to cents before it is stored or used in
  // arithmetic — the Decimal columns now persist values exactly as given
  // (see packages/db/src/decimal-precision.ts), so anything unrounded that
  // reaches here would be written verbatim rather than quietly absorbed.
  const effectiveAmount = roundCurrency(changes.amount ?? Number(oldTx.amount));
  // netAmount tracks amount 1:1 since the rewardsApplied discount was retired
  // (rewards redemption is now a payment leg, not a per-purchase reduction).
  const netAmount = effectiveAmount;

  // Build the update payload. tradeMetadata / bitcoinMetadata are inputs used only
  // to sync the typed detail rows below — they are no longer stored on Transaction.
  const { tradeMetadata: _tm, bitcoinMetadata: _bm, ...updatableChanges } = changes;
  const updateData = {
    ...updatableChanges,
    ...(changes.amount !== undefined ? { amount: effectiveAmount } : {}),
    netAmount,
  };

  // Ensure budgetId is never set to null — fall back to Uncategorized
  if ('budgetId' in changes && !changes.budgetId) {
    const uncatBudget = await db.budget.findFirst({
      where: { name: 'Uncategorized', isSystem: true },
      select: { id: true },
    });
    if (uncatBudget) {
      updateData.budgetId = uncatBudget.id;
    }
  }

  const record = await db.transaction.update({
    where: { id },
    data: updateData as Parameters<typeof prisma.transaction.update>[0]['data'],
  });

  // Keep the typed detail rows in sync when metadata is part of this update
  if ('tradeMetadata' in changes) await syncTradeDetail(db, id, changes.tradeMetadata ?? null);
  if ('bitcoinMetadata' in changes)
    await syncBitcoinPaymentDetail(db, id, changes.bitcoinMetadata ?? null);

  // Re-read with the detail relations so hooks can consume the typed rows
  const withDetail = await db.transaction.findUniqueOrThrow({
    where: { id },
    select: LEDGER_SELECT,
  });

  await lifecycleManager.dispatch('updated', {
    tx: withDetail,
    oldTx,
    db,
  });

  return record;
}

/**
 * Batch update multiple transactions through the ledger gate.
 * Each transaction is updated individually to ensure proper lifecycle dispatch.
 */
export async function ledgerUpdateMany(
  ids: string[],
  changesPerTx: (txId: string) => LedgerUpdateData | Promise<LedgerUpdateData>,
  db: DbClient = prisma,
): Promise<number> {
  let updated = 0;
  for (const id of ids) {
    const changes = await changesPerTx(id);
    await ledgerUpdate(id, changes, db);
    updated++;
  }
  return updated;
}

export interface LedgerCreateData {
  type: string;
  name: string;
  amount: number;
  date: Date;
  accountId?: string | null;
  toAccountId?: string | null;
  expenseId?: string | null;
  incomeId?: string | null;
  budgetId?: string | null;
  descriptionId?: string | null;
  tradeMetadata?: unknown;
  bitcoinMetadata?: unknown;
  note?: string | null;
  occurrenceDate?: Date | null;
  imported?: boolean;
  /** Cash back / rebate rather than money earned. INCOME only. */
  isCashBack?: boolean;
  payPeriodId?: string | null;
  /** Groups the legs (and Anchor) of a multi-account purchase — payment-split. */
  purchaseGroupId?: string | null;
}

/**
 * Create a transaction through the ledger gate.
 * Computes netAmount and dispatches lifecycle hooks.
 * Ensures budgetId is never null — defaults to "Uncategorized" system budget.
 *
 * Returns the created transaction record (re-read after hooks to pick up mutations).
 */
export async function ledgerCreate(
  data: LedgerCreateData,
  db: DbClient = prisma,
): Promise<TransactionRecord> {
  // Round every monetary input to cents before storing — see ledgerUpdate above.
  const amount = roundCurrency(data.amount);
  // netAmount == amount: the rewardsApplied discount was retired (rewards
  // redemption is now a payment leg, not a per-purchase reduction).
  const netAmount = amount;

  // Ensure budgetId is never null — fall back to Uncategorized
  let budgetId = data.budgetId ?? null;
  if (!budgetId) {
    const uncatBudget = await db.budget.findFirst({
      where: { name: 'Uncategorized', isSystem: true },
      select: { id: true },
    });
    budgetId = uncatBudget?.id ?? null;
  }

  // Auto-link or create TransactionDescription from transaction name
  let descriptionId = data.descriptionId ?? null;
  if (!descriptionId && data.name) {
    const existing = await db.transactionDescription.findFirst({
      where: { name: { equals: data.name, mode: 'insensitive' } },
      select: { id: true },
    });
    if (existing) {
      descriptionId = existing.id;
    } else {
      const created = await db.transactionDescription.create({
        data: { name: data.name },
        select: { id: true },
      });
      descriptionId = created.id;
    }
  }

  // tradeMetadata / bitcoinMetadata are inputs used only to build the typed detail
  // rows below — they are no longer stored on Transaction.
  const { tradeMetadata: _tm, bitcoinMetadata: _bm, ...storableData } = data;
  const createData = {
    ...storableData,
    amount,
    budgetId,
    descriptionId,
    netAmount,
  };

  const record = await db.transaction.create({
    data: createData as Parameters<typeof prisma.transaction.create>[0]['data'],
  });

  // Populate the typed detail rows from the validated metadata input
  if (data.tradeMetadata != null) await syncTradeDetail(db, record.id, data.tradeMetadata);
  if (data.bitcoinMetadata != null)
    await syncBitcoinPaymentDetail(db, record.id, data.bitcoinMetadata);

  // Re-read with the detail relations so hooks can consume the typed rows
  const withDetail = await db.transaction.findUniqueOrThrow({
    where: { id: record.id },
    select: LEDGER_SELECT,
  });

  await lifecycleManager.dispatch('created', { tx: withDetail, db });

  // Re-read to pick up any lifecycle hook mutations (e.g. system budget auto-assignment)
  const final = await db.transaction.findUniqueOrThrow({ where: { id: record.id } });
  return final;
}

export interface LedgerDeleteContext {
  /** Pre-read debt payment for reversal (read BEFORE delete since onDelete: SetNull nullifies FK) */
  debtPayment?: unknown;
}

/**
 * Delete a transaction through the ledger gate.
 * Dispatches lifecycle hooks for proper reversal of all side effects.
 */
export async function ledgerDelete(
  id: string,
  ctx?: LedgerDeleteContext,
  db: DbClient = prisma,
): Promise<void> {
  const tx = await db.transaction.findUniqueOrThrow({
    where: { id },
    select: LEDGER_SELECT,
  });

  await db.transaction.delete({ where: { id } });

  await lifecycleManager.dispatch('deleted', {
    tx,
    db,
    ...(ctx?.debtPayment ? { _debtPayment: ctx.debtPayment } : {}),
  });
}
