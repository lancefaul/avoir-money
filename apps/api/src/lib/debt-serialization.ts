/**
 * Serialization helpers for the debts route, extracted from routes/debts.ts.
 * Read-only — the escrow lookup touches EscrowRecord, not the master ledger.
 */
import { prisma } from '@budget-tracker/db';
import type { z } from 'zod';
import { resolveBasePayment } from '@budget-tracker/core';
import type { DebtSchema, EscrowRecordSchema } from '@budget-tracker/core';

type Debt = z.infer<typeof DebtSchema>;

export function serializeDebt(
  r: {
    id: string;
    name: string;
    type: string;
    originalBalance: { toNumber(): number };
    currentBalance: { toNumber(): number };
    apr: { toNumber(): number };
    minimumPayment: { toNumber(): number };
    frequency: string;
    startDate: Date;
    maturityDate: Date | null;
    termMonths: number | null;
    linkedExpenseId: string | null;
    linkedAccountId: string | null;
    paidOff: boolean;
    escrowEnabled: boolean;
    note: string | null;
    managementUrl: string | null;
    createdAt: Date;
    updatedAt: Date;
  },
  escrowAmount = 0,
): Debt {
  const originalBalance = Number(r.originalBalance);
  const apr = Number(r.apr);
  const minimumPayment = Number(r.minimumPayment);
  const frequency = r.frequency as Debt['frequency'];
  // The payment actually charged, falling back to the loan terms only when none
  // is recorded — the same helper the amortization schedule uses, so the figure
  // shown here and the one the schedule amortizes cannot drift apart. Escrow is
  // a pass-through added on top and is never part of P&I.
  const pAndI = resolveBasePayment({
    minimumPayment,
    originalBalance,
    apr,
    termMonths: r.termMonths,
    frequency,
  });
  const monthlyPayment = Math.round((pAndI + escrowAmount) * 100) / 100;
  return {
    id: r.id,
    name: r.name,
    type: r.type as Debt['type'],
    originalBalance,
    currentBalance: Number(r.currentBalance),
    apr,
    minimumPayment,
    frequency,
    startDate: r.startDate,
    maturityDate: r.maturityDate,
    termMonths: r.termMonths,
    linkedExpenseId: r.linkedExpenseId,
    linkedAccountId: r.linkedAccountId,
    paidOff: r.paidOff,
    escrowEnabled: r.escrowEnabled,
    note: r.note,
    managementUrl: r.managementUrl,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    monthlyPayment,
  };
}

/**
 * Fetch the most recent escrow amount for each of the given debt IDs in a
 * single query. Returns a map of debtId → current monthly escrow amount.
 *
 * **`createdAt` is a required tie-break, not decoration.** Editing escrow
 * inserts a new row rather than updating the existing one, so a single period
 * accumulates several records — production reached five rows all dated
 * 2026-08-01. Ordering by `periodStartDate` alone leaves those tied, and a tie
 * has no defined order in SQL: Postgres returned whichever row it liked, which
 * was a stale one. The symptom was an escrow edit that appeared not to save —
 * the write had succeeded, and this read could not see it.
 */
export async function latestEscrowByDebt(debtIds: string[]): Promise<Map<string, number>> {
  if (debtIds.length === 0) return new Map();
  const records = await prisma.escrowRecord.findMany({
    where: { debtId: { in: debtIds } },
    orderBy: [{ periodStartDate: 'desc' }, { createdAt: 'desc' }],
  });
  const map = new Map<string, number>();
  for (const rec of records) {
    if (!map.has(rec.debtId)) map.set(rec.debtId, rec.monthlyAmount.toNumber());
  }
  return map;
}

type EscrowRecord = z.infer<typeof EscrowRecordSchema>;

export function serializeEscrowRecord(r: {
  id: string;
  debtId: string;
  monthlyAmount: { toNumber(): number };
  periodStartDate: Date;
  periodEndDate: Date;
  createdAt: Date;
  updatedAt: Date;
}): EscrowRecord {
  return {
    id: r.id,
    debtId: r.debtId,
    monthlyAmount: r.monthlyAmount.toNumber(),
    periodStartDate: r.periodStartDate,
    periodEndDate: r.periodEndDate,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}
