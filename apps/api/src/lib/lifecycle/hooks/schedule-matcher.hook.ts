import { prisma } from '@budget-tracker/db';
import type { HookDefinition } from '../types.js';
import type { DbClient } from '../db-client.js';

/**
 * Schedule Matcher lifecycle hook — automatically links transactions
 * to PENDING ScheduledTransaction rows within a ±5-day window.
 *
 * Priority 15: runs after balance (10) and before trade-holding (20).
 */

const MATCH_WINDOW_DAYS = 5;

function toNumber(v: number | { toNumber(): number }): number {
  return typeof v === 'number' ? v : v.toNumber();
}

export const scheduleMatcherHook: HookDefinition = {
  name: 'schedule-matcher',
  events: ['created', 'updated', 'deleted'],
  priority: 15,
  condition: (ctx) =>
    ctx.tx.expenseId != null ||
    ctx.tx.incomeId != null ||
    ctx.oldTx?.expenseId != null ||
    ctx.oldTx?.incomeId != null,

  async execute(ctx) {
    const db = ctx.db ?? prisma;
    if (ctx.event === 'created') {
      await onCreated(db, ctx.tx);
    } else if (ctx.event === 'updated') {
      await onUpdated(db, ctx.tx, ctx.oldTx);
    } else if (ctx.event === 'deleted') {
      await onDeleted(db, ctx.tx);
    }
  },
};

async function onCreated(
  db: DbClient,
  tx: {
    id: string;
    date: Date;
    amount: number | { toNumber(): number };
    expenseId: string | null;
    incomeId: string | null;
    occurrenceDate?: Date | null;
  },
) {
  // Skip if this transaction is already linked to a schedule row (e.g., from mark-as-paid)
  const alreadyLinked = await db.scheduledTransaction.findUnique({
    where: { transactionId: tx.id },
  });
  if (alreadyLinked) return;

  const sourceType = tx.expenseId ? 'EXPENSE' : 'INCOME';
  const sourceId = (tx.expenseId ?? tx.incomeId)!;
  // Use occurrenceDate for matching when available (mark-as-paid sets this to the original due date)
  const matchDate = tx.occurrenceDate ?? tx.date;
  const txAmount = toNumber(tx.amount);

  const windowStart = new Date(matchDate.getTime() - MATCH_WINDOW_DAYS * 86_400_000);
  const windowEnd = new Date(matchDate.getTime() + MATCH_WINDOW_DAYS * 86_400_000);

  const candidates = await db.scheduledTransaction.findMany({
    where: {
      sourceType,
      sourceId,
      status: 'PENDING',
      dueDate: { gte: windowStart, lte: windowEnd },
    },
  });

  if (candidates.length === 0) return;

  // Pick closest dueDate to matchDate
  const best = candidates.reduce((a, b) => {
    const diffA = Math.abs(a.dueDate.getTime() - matchDate.getTime());
    const diffB = Math.abs(b.dueDate.getTime() - matchDate.getTime());
    return diffA <= diffB ? a : b;
  });

  const expectedAmount = best.expectedAmount.toNumber();
  const status = txAmount >= expectedAmount ? 'PAID' : 'PARTIAL';

  await db.scheduledTransaction.update({
    where: { id: best.id },
    data: {
      transactionId: tx.id,
      actualAmount: txAmount,
      status,
    },
  });
}

async function onUpdated(
  db: DbClient,
  tx: {
    id: string;
    date: Date;
    amount: number | { toNumber(): number };
    expenseId: string | null;
    incomeId: string | null;
    occurrenceDate?: Date | null;
  },
  oldTx?: {
    id: string;
    date: Date;
    amount: number | { toNumber(): number };
    expenseId: string | null;
    incomeId: string | null;
    occurrenceDate?: Date | null;
  },
) {
  // When oldTx is available, detect link/unlink transitions
  if (oldTx) {
    const wasLinked = oldTx.expenseId != null || oldTx.incomeId != null;
    const isLinked = tx.expenseId != null || tx.incomeId != null;

    // Source was removed (unlink) — reset the matched scheduled row
    if (wasLinked && !isLinked) {
      await onDeleted(db, tx);
      return;
    }

    // Source was added (link) — match to a scheduled row
    if (!wasLinked && isLinked) {
      await onCreated(db, tx);
      return;
    }
  }

  const txAmount = toNumber(tx.amount);

  const linked = await db.scheduledTransaction.findUnique({
    where: { transactionId: tx.id },
  });

  if (!linked) {
    // Not currently matched — try to match (handles link-then-update and newly linked txns)
    if (tx.expenseId || tx.incomeId) {
      await onCreated(db, tx);
    }
    return;
  }

  // Use occurrenceDate for drift check when available — this is the intended due date,
  // not the actual payment date. A transaction paid late (e.g., Jun 24 for Jun 8 due)
  // should stay linked to the Jun 8 scheduled row.
  const matchDate = tx.occurrenceDate ?? tx.date;
  const drift = Math.abs(linked.dueDate.getTime() - matchDate.getTime());
  const windowMs = MATCH_WINDOW_DAYS * 86_400_000;

  if (drift > windowMs) {
    // Date moved outside the window — unlink from old row and re-match
    await db.scheduledTransaction.update({
      where: { id: linked.id },
      data: { status: 'PENDING', transactionId: null, actualAmount: null },
    });
    // Re-run matching against the new date
    if (tx.expenseId || tx.incomeId) {
      await onCreated(db, tx);
    }
    return;
  }

  // Still within window — just update amount/status
  const expectedAmount = linked.expectedAmount.toNumber();
  const status = txAmount >= expectedAmount ? 'PAID' : 'PARTIAL';

  await db.scheduledTransaction.update({
    where: { id: linked.id },
    data: {
      actualAmount: txAmount,
      status,
    },
  });
}

async function onDeleted(db: DbClient, tx: { id: string }) {
  const linked = await db.scheduledTransaction.findUnique({
    where: { transactionId: tx.id },
  });

  if (!linked) return;

  await db.scheduledTransaction.update({
    where: { id: linked.id },
    data: {
      status: 'PENDING',
      transactionId: null,
      actualAmount: null,
    },
  });
}
