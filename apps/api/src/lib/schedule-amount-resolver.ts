/**
 * Pure amount/due-date resolution helpers for the schedule generator.
 *
 * Extracted from schedule-generator.ts — these are side-effect-free functions
 * (no prisma access) that resolve the expected amount and due date for a single
 * recurring occurrence, factoring in utility readings and amount schedules.
 */
import { localDate } from './dates.js';

/** Utility reading info for a specific month, keyed by expenseId */
export interface UtilityReadingInfo {
  expenseId: string;
  cost: number;
  convenienceFee: number | null;
  convenienceFeeType: string | null;
  otherFees: number | null;
  dueDate: Date | null;
  billDate: Date;
}

/**
 * Resolve the due date for a utility-linked expense occurrence.
 *
 * Finds the reading whose dueDate is closest to the occurrence (within ±15 days)
 * and returns that reading's dueDate, which represents the actual payment deadline
 * for the bill. This ensures the schedule shows the real due date rather than the
 * Expense's generic dueDay.
 *
 * Returns null if no reading matches, meaning the caller keeps the original date.
 */
export function resolveUtilityDueDate(
  occurrenceDate: Date,
  utilityReadings: UtilityReadingInfo[] | undefined,
  expenseId: string | undefined,
): Date | null {
  if (!utilityReadings || !expenseId) return null;

  const MATCH_WINDOW_MS = 15 * 86_400_000;
  const occTime = occurrenceDate.getTime();
  let bestReading: UtilityReadingInfo | undefined;
  let bestDist = Infinity;
  for (const r of utilityReadings) {
    if (r.expenseId !== expenseId) continue;
    if (!r.dueDate) continue;
    const dist = Math.abs(r.dueDate.getTime() - occTime);
    if (dist <= MATCH_WINDOW_MS && dist < bestDist) {
      bestDist = dist;
      bestReading = r;
    }
  }
  return bestReading?.dueDate ?? null;
}

/** Calculate total cost including convenience fee and other fees */
function totalReadingCost(r: UtilityReadingInfo): number {
  let total = r.cost;
  if (r.convenienceFee != null && r.convenienceFee > 0) {
    if (r.convenienceFeeType === 'percent') {
      total += r.cost * (r.convenienceFee / 100);
    } else {
      total += r.convenienceFee;
    }
  }
  if (r.otherFees != null) total += r.otherFees;
  return Math.round(total * 100) / 100;
}

/**
 * Compute the absolute biweekly occurrence index (1-based) for a given date
 * relative to the anchor (start) date. This is deterministic regardless of
 * what query range generateSchedule is called with.
 */
function absoluteBiweeklyIndex(occurrenceDate: Date, anchor: Date): number {
  const msPerDay = 86_400_000;
  const daysDiff = Math.round((occurrenceDate.getTime() - anchor.getTime()) / msPerDay);
  // Number of 14-day intervals from anchor, 1-based
  return Math.round(daysDiff / 14) + 1;
}

/**
 * Resolve expected amount for a single occurrence.
 *
 * Priority: utility reading (if available) → amountSchedule → base amount.
 * Follows the same resolution logic as the old anticipation engine.
 */
export function resolveExpectedAmount(
  baseAmount: number,
  amountSchedule: Record<string, number> | null,
  occurrenceDate: Date,
  frequency: string,
  anchorDate?: Date | null,
  utilityReadings?: UtilityReadingInfo[],
  expenseId?: string,
): number {
  // 1. Utility reading takes highest precedence (for utility-linked expenses)
  if (utilityReadings && expenseId) {
    // Find the reading whose dueDate is closest to this occurrence (within ±15 days).
    // This handles cases where dueDate=Jun-30 should match a Jul-1 occurrence,
    // and dueDate=Jun-01 should match a Jun-1 occurrence.
    const MATCH_WINDOW_MS = 15 * 86_400_000;
    const occTime = occurrenceDate.getTime();
    let bestReading: UtilityReadingInfo | undefined;
    let bestDist = Infinity;
    for (const r of utilityReadings) {
      if (r.expenseId !== expenseId) continue;
      const rDate = r.dueDate ?? r.billDate;
      const dist = Math.abs(rDate.getTime() - occTime);
      if (dist <= MATCH_WINDOW_MS && dist < bestDist) {
        bestDist = dist;
        bestReading = r;
      }
    }
    if (bestReading) return totalReadingCost(bestReading);
    // No reading within window — fall through to amountSchedule or base amount
  }

  // 2. amountSchedule override
  if (amountSchedule) {
    if (frequency === 'BIWEEKLY' && anchorDate) {
      // Use absolute position from anchor to get a stable key regardless of query range
      const absIndex = absoluteBiweeklyIndex(occurrenceDate, anchorDate);
      const key = absIndex % 2 === 1 ? '1' : '2';
      const val = amountSchedule[key];
      if (val != null) return val;
    } else if (frequency === 'SEMI_MONTHLY') {
      const key = localDate(occurrenceDate).day <= 15 ? '1' : '2';
      const val = amountSchedule[key];
      if (val != null) return val;
    } else {
      // Default: use month key (1-indexed)
      const monthKey = (localDate(occurrenceDate).month + 1).toString();
      const val = amountSchedule[monthKey];
      if (val != null) return val;
    }
  }

  // 3. Base amount fallback
  return baseAmount;
}
