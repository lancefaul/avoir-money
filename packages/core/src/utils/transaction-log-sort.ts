import type { ScheduledTransaction, Transaction } from '../types/index.js';

/** Display status pre-computed by the caller (e.g. via mapScheduleStatus) */
export type ScheduledDisplayStatus = 'DUE' | 'OVERDUE' | 'PAID' | 'PARTIAL' | 'SNOOZED' | 'SKIPPED';

/**
 * Legacy anticipation entry shape — retained for backward compatibility with
 * the transactions route which maps ScheduledTransaction rows to this shape.
 */
export interface AnticipationEntry {
  id: string;
  sourceType: 'expense' | 'income';
  sourceId: string;
  name: string;
  amount: number;
  occurrenceDate: Date;
  status: 'DUE' | 'OVERDUE' | 'UPCOMING';
  budgetId: string;
  accountId: string | null;
  isAutomatic: boolean;
  frequency: string;
}

export type TransactionLogEntry =
  | { kind: 'anticipation'; data: AnticipationEntry }
  | { kind: 'scheduled'; data: ScheduledTransaction; displayStatus: ScheduledDisplayStatus }
  | { kind: 'transaction'; data: Transaction };

/**
 * Sort a mixed list of anticipations, scheduled transactions, and real transactions
 * for the transaction log.
 *
 * Order: UPCOMING first, then OVERDUE, then DUE, then real transactions.
 * Within each group, sorted by date descending (farthest future / most recent first).
 * Requirements: 12.3, 12.4
 */
export function sortTransactionLog(entries: TransactionLogEntry[]): TransactionLogEntry[] {
  return [...entries].sort((a, b) => {
    const groupA = entryGroup(a);
    const groupB = entryGroup(b);

    if (groupA !== groupB) return groupA - groupB;

    const dateA = entryDate(a);
    const dateB = entryDate(b);

    // All groups sort by date descending (farthest future / most recent first)
    return dateB - dateA;
  });
}

/** Extract the sort date from any entry type */
function entryDate(entry: TransactionLogEntry): number {
  if (entry.kind === 'anticipation') return entry.data.occurrenceDate.getTime();
  if (entry.kind === 'scheduled') return entry.data.dueDate.getTime();
  return entry.data.date.getTime();
}

/**
 * Group order: UPCOMING → OVERDUE → DUE → transactions.
 * All groups sort date descending within.
 */
function entryGroup(entry: TransactionLogEntry): number {
  if (entry.kind === 'anticipation') {
    if (entry.data.status === 'UPCOMING') return 0;
    if (entry.data.status === 'OVERDUE') return 1;
    if (entry.data.status === 'DUE') return 2;
  }
  if (entry.kind === 'scheduled') {
    if (entry.displayStatus === 'OVERDUE') return 1;
    if (entry.displayStatus === 'DUE') return 2;
    // PAID, PARTIAL, SNOOZED, SKIPPED — treat like transactions
  }
  return 3;
}
