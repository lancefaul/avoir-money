export interface ExpenseRecord {
  id: string;
  name: string;
  amount: number;
  frequency: string;
  budgetId: string;
  accountId: string | null;
  isAutomatic: boolean;
  skipWeekend: boolean;
  dueDay: number | null;
  dueWeekday: number | null;
  dueOrdinal: number | null;
  amountSchedule: Record<string, number> | null;
  startDate: string | null;
  endDate: string | null;
  note: string | null;
  pausedUntil: string | null;
  linkedDebtId: string | null;
  archivedAt: string | null;
  managementUrl: string | null;
}

export interface ClassifiedExpenses {
  active: ExpenseRecord[];
  paused: ExpenseRecord[];
  archived: ExpenseRecord[];
}

/**
 * Classify an array of expense records into active, paused, and archived buckets.
 *
 * Rules:
 * - archivedAt !== null → archived (takes precedence)
 * - archivedAt === null && pausedUntil !== null → paused
 * - otherwise → active
 */
export function classifyExpenses(expenses: ExpenseRecord[]): ClassifiedExpenses {
  const active: ExpenseRecord[] = [];
  const paused: ExpenseRecord[] = [];
  const archived: ExpenseRecord[] = [];

  for (const expense of expenses) {
    if (expense.archivedAt !== null) {
      archived.push(expense);
    } else if (expense.pausedUntil !== null) {
      paused.push(expense);
    } else {
      active.push(expense);
    }
  }

  return { active, paused, archived };
}
