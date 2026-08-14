import type { z } from 'zod';
import { prisma } from '@budget-tracker/db';
import type { TransactionSchema } from '@budget-tracker/core';

type Transaction = z.infer<typeof TransactionSchema>;

export function serializeTransaction(r: {
  id: string;
  type: string;
  name: string;
  amount: { toNumber(): number };
  netAmount: { toNumber(): number };
  date: Date;
  payPeriodId: string | null;
  expenseId: string | null;
  incomeId: string | null;
  accountId: string | null;
  toAccountId: string | null;
  budgetId: string | null;
  note: string | null;
  tradeDetail?: {
    direction: string;
    assetType: string;
    ticker: string | null;
    quantity: { toNumber(): number };
    unitPrice: { toNumber(): number };
    bitcoinUnit: string | null;
    custodianId: string | null;
    walletId: string | null;
  } | null;
  bitcoinPaymentDetail?: {
    walletId: string;
    quantity: { toNumber(): number };
    unitPrice: { toNumber(): number };
    bitcoinUnit: string;
    incomeType: string | null;
  } | null;
  costBasisAllocated?: { toNumber(): number } | null;
  balanceBefore?: { toNumber(): number } | null;
  balanceAfter?: { toNumber(): number } | null;
  toBalanceBefore?: { toNumber(): number } | null;
  toBalanceAfter?: { toNumber(): number } | null;
  parentId?: string | null;
  purchaseGroupId?: string | null;
  isCashBack?: boolean;
  _count?: { children: number };
  createdAt: Date;
  expense?: { budgetId: string } | null;
  income?: { budgetId: string } | null;
  adjustmentForSession?: { id: string } | null;
}): Transaction {
  return {
    id: r.id,
    type: r.type as Transaction['type'],
    name: r.name,
    amount: Number(r.amount),
    netAmount: Number(r.netAmount),
    date: r.date,
    payPeriodId: r.payPeriodId,
    expenseId: r.expenseId,
    incomeId: r.incomeId,
    accountId: r.accountId,
    toAccountId: r.toAccountId,
    budgetId: r.budgetId ?? r.expense?.budgetId ?? r.income?.budgetId ?? null,
    note: r.note,
    // Metadata response shape is derived from the typed detail relation.
    tradeMetadata: r.tradeDetail
      ? {
          direction: r.tradeDetail.direction,
          assetType: r.tradeDetail.assetType,
          ticker: r.tradeDetail.ticker,
          quantity: r.tradeDetail.quantity.toNumber(),
          unitPrice: r.tradeDetail.unitPrice.toNumber(),
          bitcoinUnit: r.tradeDetail.bitcoinUnit,
          custodianId: r.tradeDetail.custodianId,
          walletId: r.tradeDetail.walletId,
        }
      : null,
    bitcoinMetadata: r.bitcoinPaymentDetail
      ? {
          walletId: r.bitcoinPaymentDetail.walletId,
          quantity: r.bitcoinPaymentDetail.quantity.toNumber(),
          unitPrice: r.bitcoinPaymentDetail.unitPrice.toNumber(),
          bitcoinUnit: r.bitcoinPaymentDetail.bitcoinUnit,
          incomeType: r.bitcoinPaymentDetail.incomeType,
        }
      : null,
    costBasisAllocated: r.costBasisAllocated ? r.costBasisAllocated.toNumber() : null,
    balanceBefore: r.balanceBefore ? r.balanceBefore.toNumber() : null,
    balanceAfter: r.balanceAfter ? r.balanceAfter.toNumber() : null,
    toBalanceBefore: r.toBalanceBefore ? r.toBalanceBefore.toNumber() : null,
    toBalanceAfter: r.toBalanceAfter ? r.toBalanceAfter.toNumber() : null,
    parentId: r.parentId ?? null,
    childCount: r._count?.children ?? 0,
    purchaseGroupId: r.purchaseGroupId ?? null,
    isReconciliationAdjustment: Boolean(r.adjustmentForSession),
    isCashBack: Boolean(r.isCashBack),
    createdAt: r.createdAt,
  };
}

export function serializeChildTransaction(r: {
  id: string;
  parentId: string | null;
  budgetId: string | null;
  preTaxAmount: { toNumber(): number } | null;
  taxAmount: { toNumber(): number } | null;
  taxRate: { toNumber(): number } | null;
  amount: { toNumber(): number };
  note: string | null;
  createdAt: Date;
}) {
  return {
    id: r.id,
    parentId: r.parentId!,
    budgetId: r.budgetId!,
    preTaxAmount: r.preTaxAmount ? Number(r.preTaxAmount) : 0,
    taxAmount: r.taxAmount ? Number(r.taxAmount) : 0,
    taxRate: r.taxRate ? Number(r.taxRate) : null,
    lineTotal: Number(r.amount),
    note: r.note,
    createdAt: r.createdAt,
  };
}

export async function validateSplittableParent(
  parentId: string,
): Promise<
  | { ok: false; error: string; status: 400 | 404 }
  | { ok: true; parent: NonNullable<Awaited<ReturnType<typeof prisma.transaction.findUnique>>> }
> {
  const parent = await prisma.transaction.findUnique({ where: { id: parentId } });
  if (!parent) return { ok: false, error: 'Transaction not found', status: 404 };
  if (parent.parentId) return { ok: false, error: 'Cannot split a child transaction', status: 400 };
  if (parent.type !== 'EXPENSE' && parent.type !== 'REFUND') {
    return { ok: false, error: 'Only EXPENSE and REFUND transactions can be split', status: 400 };
  }
  return { ok: true, parent };
}
