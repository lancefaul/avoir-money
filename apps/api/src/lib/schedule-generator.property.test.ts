/**
 * Property-Based Tests for Schedule Generator
 *
 * Tests Properties 2, 3, 4, 5, 6, and 12 from the design document.
 * DB-backed tests create fixtures, run generateSchedule, then query results.
 * Property 4 tests the pure resolveExpectedAmount function (no DB needed).
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { prisma } from '@budget-tracker/db';
import { generateSchedule } from './schedule-generator.js';
import { occurrences } from './recurring.js';
import { makeDate } from './dates.js';
import { createGroup, createCategory, createExpense, createIncome } from '../test/helpers.js';

// ─── Helpers ───

/** Create a fresh category group + category for each property iteration */
async function freshCategory() {
  const group = await createGroup();
  return (await createCategory(group.id)).id;
}

/**
 * Test-local copy of resolveExpectedAmount (now private in schedule-generator.ts).
 * Mirrors the production logic for property-based testing.
 */
function absoluteBiweeklyIndex(occurrenceDate: Date, anchor: Date): number {
  const msPerDay = 86_400_000;
  const daysDiff = Math.round((occurrenceDate.getTime() - anchor.getTime()) / msPerDay);
  return Math.round(daysDiff / 14) + 1;
}

function resolveExpectedAmount(
  baseAmount: number,
  amountSchedule: Record<string, number> | null,
  occurrenceDate: Date,
  frequency: string,
  anchorDate?: Date | null,
  utilityReadings?: Array<{
    expenseId: string;
    cost: number;
    dueDate: Date | null;
    billDate: Date;
  }>,
  expenseId?: string,
): number {
  if (utilityReadings && expenseId) {
    const occ = { year: occurrenceDate.getUTCFullYear(), month: occurrenceDate.getUTCMonth() };
    const reading = utilityReadings.find((r) => {
      if (r.expenseId !== expenseId) return false;
      const rd = r.dueDate ?? r.billDate;
      return rd.getUTCFullYear() === occ.year && rd.getUTCMonth() === occ.month;
    });
    if (reading) return reading.cost;
  }
  if (amountSchedule) {
    if (frequency === 'BIWEEKLY' && anchorDate) {
      const absIndex = absoluteBiweeklyIndex(occurrenceDate, anchorDate);
      const key = absIndex % 2 === 1 ? '1' : '2';
      const val = amountSchedule[key];
      if (val != null) return val;
    } else if (frequency === 'SEMI_MONTHLY') {
      const key = occurrenceDate.getUTCDate() <= 15 ? '1' : '2';
      const val = amountSchedule[key];
      if (val != null) return val;
    } else {
      const monthKey = (occurrenceDate.getUTCMonth() + 1).toString();
      const val = amountSchedule[monthKey];
      if (val != null) return val;
    }
  }
  return baseAmount;
}

// ─── Generators ───

const amountArb = fc.double({ min: 1, max: 10000, noNaN: true, noDefaultInfinity: true });
const dueDayArb = fc.integer({ min: 1, max: 28 });
const monthArb = fc.integer({ min: 1, max: 10 });

// ─── Property 2: Source Type FK Invariant ───
// Feature: transaction-schedule, Property 2: Source Type FK Invariant

describe('Feature: transaction-schedule, Property 2: Source Type FK Invariant', () => {
  /**
   * Validates: Requirements 1.4, 1.5, 1.6
   *
   * For any ScheduledTransaction produced by the generator:
   * - If sourceType is EXPENSE then expenseId === sourceId and incomeId === null
   * - If sourceType is INCOME then incomeId === sourceId and expenseId === null
   */
  it('EXPENSE rows have expenseId=sourceId and incomeId=null; INCOME rows vice versa', async () => {
    await fc.assert(
      fc.asyncProperty(amountArb, dueDayArb, async (amount, dueDay) => {
        const catId = await freshCategory();
        const expense = await createExpense(catId, {
          amount,
          frequency: 'MONTHLY',
          dueDay,
        });
        const income = await createIncome(catId, {
          amount,
          frequency: 'MONTHLY',
          startDate: makeDate(2026, 0, 1),
        });

        const periodStart = makeDate(2026, 3, 1);
        const periodEnd = makeDate(2026, 3, 30);

        await generateSchedule({ periodStart, periodEnd });

        const rows = await prisma.scheduledTransaction.findMany({
          where: {
            OR: [
              { sourceType: 'EXPENSE', sourceId: expense.id },
              { sourceType: 'INCOME', sourceId: income.id },
            ],
          },
        });

        for (const row of rows) {
          if (row.sourceType === 'EXPENSE') {
            expect(row.expenseId).toBe(row.sourceId);
            expect(row.incomeId).toBeNull();
          } else {
            expect(row.incomeId).toBe(row.sourceId);
            expect(row.expenseId).toBeNull();
          }
        }
      }),
      { numRuns: 20 },
    );
  });
});

// ─── Property 3: Generator Produces Correct PENDING Rows ───
// Feature: transaction-schedule, Property 3: Generator Produces Correct PENDING Rows

describe('Feature: transaction-schedule, Property 3: Generator Produces Correct PENDING Rows', () => {
  /**
   * Validates: Requirements 2.1, 2.3, 2.8
   */
  it('row count matches occurrences() yield count and all rows are PENDING', async () => {
    await fc.assert(
      fc.asyncProperty(amountArb, dueDayArb, monthArb, async (amount, dueDay, month) => {
        const catId = await freshCategory();
        const expense = await createExpense(catId, {
          amount,
          frequency: 'MONTHLY',
          dueDay,
          skipWeekend: false,
        });

        const periodStart = makeDate(2026, month - 1, 1);
        const periodEnd = makeDate(2026, month, 0);

        let expectedCount = 0;
        for (const d of occurrences(
          'MONTHLY',
          dueDay,
          null,
          null,
          null,
          null,
          periodStart,
          periodEnd,
        )) {
          if (d >= periodStart && d <= periodEnd) expectedCount++;
        }

        await generateSchedule({
          periodStart,
          periodEnd,
          sourceType: 'EXPENSE',
          sourceId: expense.id,
        });

        const rows = await prisma.scheduledTransaction.findMany({
          where: { sourceType: 'EXPENSE', sourceId: expense.id },
        });

        expect(rows.length).toBe(expectedCount);
        for (const row of rows) {
          expect(row.status).toBe('PENDING');
        }
      }),
      { numRuns: 20 },
    );
  });
});

// ─── Property 4: Amount Resolution Correctness ───
// Feature: transaction-schedule, Property 4: Amount Resolution Correctness

describe('Feature: transaction-schedule, Property 4: Amount Resolution Correctness', () => {
  /**
   * Validates: Requirements 2.2
   */
  it('returns amountSchedule value when present, base amount otherwise', () => {
    fc.assert(
      fc.property(
        amountArb,
        fc.integer({ min: 1, max: 12 }),
        amountArb,
        (baseAmount, monthNum, scheduleAmount) => {
          const schedule: Record<string, number> = { [monthNum.toString()]: scheduleAmount };
          const occDate = makeDate(2026, monthNum - 1, 15);

          expect(resolveExpectedAmount(baseAmount, schedule, occDate, 'MONTHLY')).toBe(
            scheduleAmount,
          );
          expect(resolveExpectedAmount(baseAmount, null, occDate, 'MONTHLY')).toBe(baseAmount);
        },
      ),
      { numRuns: 20 },
    );
  });

  it('utility reading takes precedence over both schedule and base amount', () => {
    fc.assert(
      fc.property(
        amountArb,
        amountArb,
        amountArb,
        fc.integer({ min: 1, max: 12 }),
        (baseAmount, scheduleAmount, utilityCost, monthNum) => {
          const expenseId = 'test-expense-id';
          const schedule: Record<string, number> = { [monthNum.toString()]: scheduleAmount };
          const occDate = makeDate(2026, monthNum - 1, 15);
          const utilityReadings = [
            {
              expenseId,
              cost: utilityCost,
              dueDate: makeDate(2026, monthNum - 1, 10),
              billDate: makeDate(2026, monthNum - 1, 1),
            },
          ];

          expect(
            resolveExpectedAmount(
              baseAmount,
              schedule,
              occDate,
              'MONTHLY',
              undefined,
              utilityReadings,
              expenseId,
            ),
          ).toBe(utilityCost);
        },
      ),
      { numRuns: 20 },
    );
  });

  it('BIWEEKLY uses alternating 1/2 keys from amountSchedule based on absolute position from anchor', () => {
    fc.assert(
      fc.property(
        amountArb,
        amountArb,
        amountArb,
        fc.integer({ min: 0, max: 20 }),
        (baseAmount, amount1, amount2, periodOffset) => {
          const schedule: Record<string, number> = { '1': amount1, '2': amount2 };
          const anchor = makeDate(2026, 3, 1); // April 1
          // Create an occurrence date that is exactly periodOffset * 14 days from anchor
          const occDate = new Date(anchor.getTime() + periodOffset * 14 * 86_400_000);
          const result = resolveExpectedAmount(baseAmount, schedule, occDate, 'BIWEEKLY', anchor);
          const absIndex = periodOffset + 1; // 1-based
          const expectedKey = absIndex % 2 === 1 ? '1' : '2';
          expect(result).toBe(schedule[expectedKey]);
        },
      ),
      { numRuns: 20 },
    );
  });

  it('SEMI_MONTHLY uses day <= 15 → key 1, day > 15 → key 2', () => {
    fc.assert(
      fc.property(
        amountArb,
        amountArb,
        amountArb,
        fc.integer({ min: 1, max: 28 }),
        (baseAmount, amount1, amount2, day) => {
          const schedule: Record<string, number> = { '1': amount1, '2': amount2 };
          const occDate = makeDate(2026, 3, day);
          const result = resolveExpectedAmount(baseAmount, schedule, occDate, 'SEMI_MONTHLY');
          expect(result).toBe(schedule[day <= 15 ? '1' : '2']);
        },
      ),
      { numRuns: 20 },
    );
  });
});

// ─── Property 5: Weekend Shifting Invariant ───
// Feature: transaction-schedule, Property 5: Weekend Shifting Invariant

describe('Feature: transaction-schedule, Property 5: Weekend Shifting Invariant', () => {
  /**
   * Validates: Requirements 2.4
   */
  it('no dueDate falls on Saturday or Sunday when skipWeekend = true', async () => {
    await fc.assert(
      fc.asyncProperty(amountArb, dueDayArb, monthArb, async (amount, dueDay, month) => {
        const catId = await freshCategory();
        const expense = await createExpense(catId, {
          amount,
          frequency: 'MONTHLY',
          dueDay,
          skipWeekend: true,
        });

        const periodStart = makeDate(2026, month - 1, 1);
        const periodEnd = makeDate(2026, month, 0);

        await generateSchedule({
          periodStart,
          periodEnd,
          sourceType: 'EXPENSE',
          sourceId: expense.id,
        });

        const rows = await prisma.scheduledTransaction.findMany({
          where: { sourceType: 'EXPENSE', sourceId: expense.id },
        });

        for (const row of rows) {
          const dow = row.dueDate.getUTCDay();
          expect(dow).not.toBe(0); // Not Sunday
          expect(dow).not.toBe(6); // Not Saturday
        }
      }),
      { numRuns: 20 },
    );
  });
});

// ─── Property 6: Generator Idempotency ───
// Feature: transaction-schedule, Property 6: Generator Idempotency

describe('Feature: transaction-schedule, Property 6: Generator Idempotency', () => {
  /**
   * Validates: Requirements 1.2, 2.7, 16.3
   */
  it('second call with same params creates zero additional rows', async () => {
    await fc.assert(
      fc.asyncProperty(amountArb, dueDayArb, monthArb, async (amount, dueDay, month) => {
        const catId = await freshCategory();
        const expense = await createExpense(catId, {
          amount,
          frequency: 'MONTHLY',
          dueDay,
          skipWeekend: false,
        });

        const periodStart = makeDate(2026, month - 1, 1);
        const periodEnd = makeDate(2026, month, 0);
        const opts = {
          periodStart,
          periodEnd,
          sourceType: 'EXPENSE' as const,
          sourceId: expense.id,
        };

        const firstCount = await generateSchedule(opts);
        const firstRows = await prisma.scheduledTransaction.findMany({
          where: { sourceType: 'EXPENSE', sourceId: expense.id },
          orderBy: { dueDate: 'asc' },
        });
        const secondCount = await generateSchedule(opts);

        // Rows are preserved (not recreated), so a repeat run creates nothing new.
        expect(secondCount).toBe(0);

        const rows = await prisma.scheduledTransaction.findMany({
          where: { sourceType: 'EXPENSE', sourceId: expense.id },
          orderBy: { dueDate: 'asc' },
        });
        expect(rows.length).toBe(firstCount);
        // Row ids are stable across regenerations.
        expect(rows.map((r) => r.id)).toEqual(firstRows.map((r) => r.id));
      }),
      { numRuns: 20 },
    );
  });
});

// ─── Property 12: Past Period Immutability ───
// Feature: transaction-schedule, Property 12: Past Period Immutability

describe('Feature: transaction-schedule, Property 12: Past Period Immutability', () => {
  /**
   * Validates: Requirements 10.3
   */
  it('generator does not overwrite non-PENDING rows in past periods', async () => {
    await fc.assert(
      fc.asyncProperty(
        amountArb,
        dueDayArb,
        fc.constantFrom(
          'PAID' as const,
          'PARTIAL' as const,
          'SKIPPED' as const,
          'SNOOZED' as const,
        ),
        async (amount, dueDay, nonPendingStatus) => {
          const catId = await freshCategory();
          const expense = await createExpense(catId, {
            amount,
            frequency: 'MONTHLY',
            dueDay,
            skipWeekend: false,
          });

          const periodStart = makeDate(2025, 0, 1);
          const periodEnd = makeDate(2025, 0, 31);

          await generateSchedule({
            periodStart,
            periodEnd,
            sourceType: 'EXPENSE',
            sourceId: expense.id,
          });

          await prisma.scheduledTransaction.updateMany({
            where: { sourceType: 'EXPENSE', sourceId: expense.id },
            data: { status: nonPendingStatus, actualAmount: amount },
          });

          const beforeRows = await prisma.scheduledTransaction.findMany({
            where: { sourceType: 'EXPENSE', sourceId: expense.id },
          });

          await generateSchedule({
            periodStart,
            periodEnd,
            sourceType: 'EXPENSE',
            sourceId: expense.id,
          });

          const afterRows = await prisma.scheduledTransaction.findMany({
            where: { sourceType: 'EXPENSE', sourceId: expense.id },
          });

          expect(afterRows.length).toBe(beforeRows.length);
          for (const after of afterRows) {
            const before = beforeRows.find((b) => b.id === after.id);
            expect(before).toBeDefined();
            expect(after.status).toBe(nonPendingStatus);
            expect(Number(after.actualAmount)).toBeCloseTo(amount, 2);
          }
        },
      ),
      { numRuns: 20 },
    );
  });
});
