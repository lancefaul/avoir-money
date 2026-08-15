/**
 * Unit Tests for Schedule Generator
 *
 * Tests ONE_TIME sources skipped, paused sources skipped,
 * and all 7 recurring frequencies produce correct rows.
 *
 * Feature: transaction-schedule
 * Requirements: 2.5, 2.6, 2.8
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@budget-tracker/db';
import { generateSchedule, invalidateSchedule } from './schedule-generator.js';
import { makeDate } from './dates.js';
import { createGroup, createCategory, createExpense, createIncome } from '../test/helpers.js';

let budgetId: string;

beforeEach(async () => {
  const group = await createGroup();
  const cat = await createCategory(group.id);
  budgetId = cat.id;
});

const periodStart = makeDate(2026, 3, 1); // April 1
const periodEnd = makeDate(2026, 3, 30); // April 30

describe('Schedule Generator — ONE_TIME sources skipped', () => {
  it('generates zero rows for a ONE_TIME expense', async () => {
    const expense = await createExpense(budgetId, {
      amount: 500,
      frequency: 'ONE_TIME',
      dueDay: 15,
    });

    const count = await generateSchedule({
      periodStart,
      periodEnd,
      sourceType: 'EXPENSE',
      sourceId: expense.id,
    });

    expect(count).toBe(0);
    const rows = await prisma.scheduledTransaction.findMany({
      where: { sourceId: expense.id },
    });
    expect(rows).toHaveLength(0);
  });

  it('generates zero rows for a ONE_TIME income', async () => {
    const income = await createIncome(budgetId, {
      amount: 3000,
      frequency: 'ONE_TIME',
    });

    const count = await generateSchedule({
      periodStart,
      periodEnd,
      sourceType: 'INCOME',
      sourceId: income.id,
    });

    expect(count).toBe(0);
  });
});

describe('Schedule Generator — paused sources skipped', () => {
  it('generates zero rows for a paused expense', async () => {
    const expense = await createExpense(budgetId, {
      amount: 200,
      frequency: 'MONTHLY',
      dueDay: 15,
      pausedUntil: makeDate(2099, 0, 1),
    });

    const count = await generateSchedule({
      periodStart,
      periodEnd,
      sourceType: 'EXPENSE',
      sourceId: expense.id,
    });

    expect(count).toBe(0);
  });

  it('generates zero rows for a paused income', async () => {
    const income = await createIncome(budgetId, {
      amount: 5000,
      frequency: 'BIWEEKLY',
      pausedUntil: makeDate(2099, 0, 1),
    });

    const count = await generateSchedule({
      periodStart,
      periodEnd,
      sourceType: 'INCOME',
      sourceId: income.id,
    });

    expect(count).toBe(0);
  });

  it('generates rows for an expense whose pause has expired', async () => {
    const expense = await createExpense(budgetId, {
      amount: 100,
      frequency: 'MONTHLY',
      dueDay: 15,
      pausedUntil: makeDate(2020, 0, 1),
    });

    const count = await generateSchedule({
      periodStart,
      periodEnd,
      sourceType: 'EXPENSE',
      sourceId: expense.id,
    });

    expect(count).toBeGreaterThan(0);
  });
});

describe('Schedule Generator — edge cases', () => {
  it('clamps dueDay 31 to last day of a short month (Feb 28)', async () => {
    const expense = await createExpense(budgetId, {
      amount: 200,
      frequency: 'MONTHLY',
      dueDay: 31,
      skipWeekend: false,
    });

    const febStart = makeDate(2026, 1, 1); // Feb 1
    const febEnd = makeDate(2026, 1, 28); // Feb 28

    const count = await generateSchedule({
      periodStart: febStart,
      periodEnd: febEnd,
      sourceType: 'EXPENSE',
      sourceId: expense.id,
    });

    expect(count).toBe(1);
    const rows = await prisma.scheduledTransaction.findMany({
      where: { sourceId: expense.id },
    });
    expect(rows).toHaveLength(1);
    // Feb 2026 has 28 days — dueDay 31 should clamp to 28
    expect(rows[0]!.dueDate.getUTCDate()).toBe(28);
    expect(rows[0]!.dueDate.getUTCMonth()).toBe(1); // February
  });

  it('BIWEEKLY generates occurrences every 14 days anchored to start date', async () => {
    const expense = await createExpense(budgetId, {
      amount: 100,
      frequency: 'BIWEEKLY',
      startDate: makeDate(2026, 0, 5), // Jan 5 anchor
      skipWeekend: false,
    });

    // Use a 2-month window to get multiple occurrences
    const start = makeDate(2026, 0, 1); // Jan 1
    const end = makeDate(2026, 1, 28); // Feb 28

    const count = await generateSchedule({
      periodStart: start,
      periodEnd: end,
      sourceType: 'EXPENSE',
      sourceId: expense.id,
    });

    expect(count).toBeGreaterThanOrEqual(3);
    const rows = await prisma.scheduledTransaction.findMany({
      where: { sourceId: expense.id },
      orderBy: { dueDate: 'asc' },
    });

    // Verify every consecutive pair is exactly 14 days apart
    for (let i = 1; i < rows.length; i++) {
      const diff = rows[i]!.dueDate.getTime() - rows[i - 1]!.dueDate.getTime();
      expect(diff).toBe(14 * 24 * 60 * 60 * 1000);
    }
  });

  it('calling generateSchedule twice for the same period does not create duplicates (idempotence)', async () => {
    const expense = await createExpense(budgetId, {
      amount: 300,
      frequency: 'MONTHLY',
      dueDay: 10,
      skipWeekend: false,
    });

    const opts = {
      periodStart,
      periodEnd,
      sourceType: 'EXPENSE' as const,
      sourceId: expense.id,
    };

    const firstCount = await generateSchedule(opts);
    expect(firstCount).toBe(1);
    const [firstRow] = await prisma.scheduledTransaction.findMany({
      where: { sourceId: expense.id },
    });

    const secondCount = await generateSchedule(opts);
    expect(secondCount).toBe(0); // existing row preserved (skipDuplicates), not recreated

    const rows = await prisma.scheduledTransaction.findMany({
      where: { sourceId: expense.id },
    });
    expect(rows).toHaveLength(1);
    // The row id is stable across regenerations — this is what keeps a
    // client-held scheduled-transaction id valid (no 404 on mark-as-paid).
    expect(rows[0]!.id).toBe(firstRow!.id);
  });

  it('preserves the row id across regenerations (stale-id regression)', async () => {
    const expense = await createExpense(budgetId, {
      amount: 250,
      frequency: 'MONTHLY',
      dueDay: 12,
      skipWeekend: false,
    });
    const opts = {
      periodStart,
      periodEnd,
      sourceType: 'EXPENSE' as const,
      sourceId: expense.id,
    };

    await generateSchedule(opts);
    const original = await prisma.scheduledTransaction.findFirstOrThrow({
      where: { sourceId: expense.id },
    });

    // Simulate the schedule being regenerated by other GET requests while the
    // client holds the original id.
    await generateSchedule(opts);
    await generateSchedule(opts);

    // The original id must still resolve — mark-as-paid looks up by this id.
    const stillThere = await prisma.scheduledTransaction.findUnique({
      where: { id: original.id },
    });
    expect(stillThere).not.toBeNull();
    expect(stillThere!.status).toBe('PENDING');
  });

  it('refreshes expectedAmount in place without changing the row id', async () => {
    const expense = await createExpense(budgetId, {
      amount: 100,
      frequency: 'MONTHLY',
      dueDay: 8,
      skipWeekend: false,
    });
    const opts = {
      periodStart,
      periodEnd,
      sourceType: 'EXPENSE' as const,
      sourceId: expense.id,
    };

    await generateSchedule(opts);
    const before = await prisma.scheduledTransaction.findFirstOrThrow({
      where: { sourceId: expense.id },
    });
    expect(Number(before.expectedAmount)).toBe(100);

    // Change the source amount, then regenerate.
    await prisma.expense.update({ where: { id: expense.id }, data: { amount: 175 } });
    await generateSchedule(opts);

    const after = await prisma.scheduledTransaction.findUniqueOrThrow({
      where: { id: before.id },
    });
    expect(after.id).toBe(before.id); // same row
    expect(Number(after.expectedAmount)).toBe(175); // amount refreshed in place
  });

  it('prunes a PENDING row when its occurrence no longer exists', async () => {
    const expense = await createExpense(budgetId, {
      amount: 200,
      frequency: 'MONTHLY',
      dueDay: 15,
      skipWeekend: false,
    });
    const opts = {
      periodStart,
      periodEnd,
      sourceType: 'EXPENSE' as const,
      sourceId: expense.id,
    };

    await generateSchedule(opts);
    expect(await prisma.scheduledTransaction.count({ where: { sourceId: expense.id } })).toBe(1);

    // Pause the source so it produces no occurrences, then regenerate.
    await prisma.expense.update({
      where: { id: expense.id },
      data: { pausedUntil: makeDate(2099, 0, 1) },
    });
    await generateSchedule(opts);

    // The now-invalid PENDING row is pruned.
    expect(
      await prisma.scheduledTransaction.count({
        where: { sourceId: expense.id, status: 'PENDING' },
      }),
    ).toBe(0);
  });

  it('invalidateSchedule deletes future PENDING rows', async () => {
    const expense = await createExpense(budgetId, {
      amount: 150,
      frequency: 'MONTHLY',
      dueDay: 15,
      skipWeekend: false,
    });

    // Generate rows first
    await generateSchedule({
      periodStart,
      periodEnd,
      sourceType: 'EXPENSE',
      sourceId: expense.id,
    });

    const beforeRows = await prisma.scheduledTransaction.findMany({
      where: { sourceId: expense.id, status: 'PENDING' },
    });
    expect(beforeRows.length).toBeGreaterThan(0);

    // Invalidate — should delete all PENDING rows
    const deleted = await invalidateSchedule('EXPENSE', expense.id);
    expect(deleted).toBe(beforeRows.length);

    const afterRows = await prisma.scheduledTransaction.findMany({
      where: { sourceId: expense.id, status: 'PENDING' },
    });
    expect(afterRows).toHaveLength(0);
  });

  it('QUARTERLY generates occurrences only in correct quarter months', async () => {
    // Start in January → quarter months are Jan(0), Apr(3), Jul(6), Oct(9)
    const expense = await createExpense(budgetId, {
      amount: 500,
      frequency: 'QUARTERLY',
      dueDay: 15,
      startDate: makeDate(2026, 0, 1),
      skipWeekend: false,
    });

    // Full year window
    const yearStart = makeDate(2026, 0, 1);
    const yearEnd = makeDate(2026, 11, 31);

    const count = await generateSchedule({
      periodStart: yearStart,
      periodEnd: yearEnd,
      sourceType: 'EXPENSE',
      sourceId: expense.id,
    });

    expect(count).toBe(4);
    const rows = await prisma.scheduledTransaction.findMany({
      where: { sourceId: expense.id },
      orderBy: { dueDate: 'asc' },
    });
    expect(rows).toHaveLength(4);

    const months = rows.map((r) => r.dueDate.getUTCMonth());
    // Quarter months relative to Jan start: Jan(0), Apr(3), Jul(6), Oct(9)
    expect(months).toEqual([0, 3, 6, 9]);
  });
});

describe('Schedule Generator — utility due date resolution', () => {
  it('uses utility reading due date when a matching reading exists for the month', async () => {
    // Create a utility provider and service linked to an expense
    const provider = await prisma.utilityProvider.create({
      data: { name: 'Test Electric Co' },
    });

    const expense = await createExpense(budgetId, {
      amount: 150,
      frequency: 'MONTHLY',
      dueDay: 15,
      skipWeekend: false,
    });

    const service = await prisma.utilityService.create({
      data: {
        providerId: provider.id,
        serviceType: 'ELECTRIC',
        metering: 'METERED',
        expenseId: expense.id,
      },
    });

    // Create a utility reading with a specific due date (April 7)
    await prisma.utilityReading.create({
      data: {
        serviceId: service.id,
        billDate: makeDate(2026, 3, 1), // April 1
        dueDate: makeDate(2026, 3, 7), // April 7 (overrides expense dueDay of 15)
        cost: 125.5,
        usage: 850,
        unitCost: 0.1476,
      },
    });

    const count = await generateSchedule({
      periodStart,
      periodEnd,
      sourceType: 'EXPENSE',
      sourceId: expense.id,
    });

    expect(count).toBe(1);
    const rows = await prisma.scheduledTransaction.findMany({
      where: { sourceId: expense.id },
    });
    expect(rows).toHaveLength(1);
    // Should use reading's dueDate (April 7), not expense's dueDay (15)
    expect(rows[0]!.dueDate.getUTCDate()).toBe(7);
    expect(rows[0]!.dueDate.getUTCMonth()).toBe(3); // April
  });

  it('falls back to expense default dueDay when no matching reading exists', async () => {
    const provider = await prisma.utilityProvider.create({
      data: { name: 'Test Gas Co' },
    });

    const expense = await createExpense(budgetId, {
      amount: 80,
      frequency: 'MONTHLY',
      dueDay: 20,
      skipWeekend: false,
    });

    const service = await prisma.utilityService.create({
      data: {
        providerId: provider.id,
        serviceType: 'GAS',
        metering: 'METERED',
        expenseId: expense.id,
      },
    });

    // Create a reading for a different month (March, not April)
    await prisma.utilityReading.create({
      data: {
        serviceId: service.id,
        billDate: makeDate(2026, 2, 1), // March 1
        dueDate: makeDate(2026, 2, 10), // March 10
        cost: 65.0,
      },
    });

    const count = await generateSchedule({
      periodStart,
      periodEnd,
      sourceType: 'EXPENSE',
      sourceId: expense.id,
    });

    expect(count).toBe(1);
    const rows = await prisma.scheduledTransaction.findMany({
      where: { sourceId: expense.id },
    });
    expect(rows).toHaveLength(1);
    // Should use expense's dueDay (20) since no April reading exists
    expect(rows[0]!.dueDate.getUTCDate()).toBe(20);
    expect(rows[0]!.dueDate.getUTCMonth()).toBe(3); // April
  });

  it('uses expense dueDay when utility service has no readings', async () => {
    const provider = await prisma.utilityProvider.create({
      data: { name: 'Test Water Co' },
    });

    const expense = await createExpense(budgetId, {
      amount: 45,
      frequency: 'MONTHLY',
      dueDay: 25,
      skipWeekend: false,
    });

    // Create service but no readings
    await prisma.utilityService.create({
      data: {
        providerId: provider.id,
        serviceType: 'WATER',
        metering: 'METERED',
        expenseId: expense.id,
      },
    });

    const count = await generateSchedule({
      periodStart,
      periodEnd,
      sourceType: 'EXPENSE',
      sourceId: expense.id,
    });

    expect(count).toBe(1);
    const rows = await prisma.scheduledTransaction.findMany({
      where: { sourceId: expense.id },
    });
    expect(rows).toHaveLength(1);
    // Should use expense's dueDay (25) since no readings exist
    expect(rows[0]!.dueDate.getUTCDate()).toBe(25);
    expect(rows[0]!.dueDate.getUTCMonth()).toBe(3); // April
  });

  it('uses expense dueDay when expense is not linked to any utility service', async () => {
    const expense = await createExpense(budgetId, {
      amount: 100,
      frequency: 'MONTHLY',
      dueDay: 12,
      skipWeekend: false,
    });

    const count = await generateSchedule({
      periodStart,
      periodEnd,
      sourceType: 'EXPENSE',
      sourceId: expense.id,
    });

    expect(count).toBe(1);
    const rows = await prisma.scheduledTransaction.findMany({
      where: { sourceId: expense.id },
    });
    expect(rows).toHaveLength(1);
    // Should use expense's dueDay (12) since no utility service link exists
    expect(rows[0]!.dueDate.getUTCDate()).toBe(12);
    expect(rows[0]!.dueDate.getUTCMonth()).toBe(3); // April
  });
});

describe('Schedule Generator — utility reading cost in expected amount', () => {
  it('uses totalReadingCost (cost + flat convenience fee + other fees) when matching reading exists', async () => {
    const provider = await prisma.utilityProvider.create({
      data: { name: 'Test Electric Co' },
    });

    const expense = await createExpense(budgetId, {
      amount: 100,
      frequency: 'MONTHLY',
      dueDay: 15,
      skipWeekend: false,
    });

    const service = await prisma.utilityService.create({
      data: {
        providerId: provider.id,
        serviceType: 'ELECTRIC',
        metering: 'METERED',
        expenseId: expense.id,
      },
    });

    // Create reading with cost=125.50, flat convenience fee=3.50, other fees=2.00
    // Total should be 125.50 + 3.50 + 2.00 = 131.00
    await prisma.utilityReading.create({
      data: {
        serviceId: service.id,
        billDate: makeDate(2026, 3, 1), // April 1
        dueDate: makeDate(2026, 3, 7), // April 7
        cost: 125.5,
        convenienceFee: 3.5,
        convenienceFeeType: 'flat',
        otherFees: 2.0,
        usage: 850,
        unitCost: 0.1476,
      },
    });

    const count = await generateSchedule({
      periodStart,
      periodEnd,
      sourceType: 'EXPENSE',
      sourceId: expense.id,
    });

    expect(count).toBe(1);
    const rows = await prisma.scheduledTransaction.findMany({
      where: { sourceId: expense.id },
    });
    expect(rows).toHaveLength(1);
    // Should use totalReadingCost (131.00), not base amount (100)
    expect(rows[0]!.expectedAmount.toNumber()).toBe(131.0);
  });

  it('uses totalReadingCost with percent convenience fee', async () => {
    const provider = await prisma.utilityProvider.create({
      data: { name: 'Test Gas Co' },
    });

    const expense = await createExpense(budgetId, {
      amount: 80,
      frequency: 'MONTHLY',
      dueDay: 20,
      skipWeekend: false,
    });

    const service = await prisma.utilityService.create({
      data: {
        providerId: provider.id,
        serviceType: 'GAS',
        metering: 'METERED',
        expenseId: expense.id,
      },
    });

    // Create reading with cost=100.00, 2.5% convenience fee, no other fees
    // Total should be 100.00 + (100.00 * 0.025) = 102.50
    await prisma.utilityReading.create({
      data: {
        serviceId: service.id,
        billDate: makeDate(2026, 3, 1), // April 1
        dueDate: makeDate(2026, 3, 10), // April 10
        cost: 100.0,
        convenienceFee: 2.5,
        convenienceFeeType: 'percent',
        usage: 500,
        unitCost: 0.2,
      },
    });

    const count = await generateSchedule({
      periodStart,
      periodEnd,
      sourceType: 'EXPENSE',
      sourceId: expense.id,
    });

    expect(count).toBe(1);
    const rows = await prisma.scheduledTransaction.findMany({
      where: { sourceId: expense.id },
    });
    expect(rows).toHaveLength(1);
    // Should use totalReadingCost (102.50), not base amount (80)
    expect(rows[0]!.expectedAmount.toNumber()).toBe(102.5);
  });

  it('uses totalReadingCost with only other fees (no convenience fee)', async () => {
    const provider = await prisma.utilityProvider.create({
      data: { name: 'Test Water Co' },
    });

    const expense = await createExpense(budgetId, {
      amount: 50,
      frequency: 'MONTHLY',
      dueDay: 25,
      skipWeekend: false,
    });

    const service = await prisma.utilityService.create({
      data: {
        providerId: provider.id,
        serviceType: 'WATER',
        metering: 'METERED',
        expenseId: expense.id,
      },
    });

    // Create reading with cost=45.00, no convenience fee, other fees=5.00
    // Total should be 45.00 + 5.00 = 50.00
    await prisma.utilityReading.create({
      data: {
        serviceId: service.id,
        billDate: makeDate(2026, 3, 1), // April 1
        dueDate: makeDate(2026, 3, 15), // April 15
        cost: 45.0,
        otherFees: 5.0,
        usage: 300,
        unitCost: 0.15,
      },
    });

    const count = await generateSchedule({
      periodStart,
      periodEnd,
      sourceType: 'EXPENSE',
      sourceId: expense.id,
    });

    expect(count).toBe(1);
    const rows = await prisma.scheduledTransaction.findMany({
      where: { sourceId: expense.id },
    });
    expect(rows).toHaveLength(1);
    // Should use totalReadingCost (50.00), not base amount (50)
    expect(rows[0]!.expectedAmount.toNumber()).toBe(50.0);
  });

  it('uses base amount when no reading exists for the occurrence month', async () => {
    const provider = await prisma.utilityProvider.create({
      data: { name: 'Test Internet Co' },
    });

    const expense = await createExpense(budgetId, {
      amount: 60,
      frequency: 'MONTHLY',
      dueDay: 5,
      skipWeekend: false,
    });

    const service = await prisma.utilityService.create({
      data: {
        providerId: provider.id,
        serviceType: 'INTERNET',
        metering: 'UNMETERED',
        expenseId: expense.id,
      },
    });

    // Create readings for March and February (not April — the test period)
    await prisma.utilityReading.create({
      data: {
        serviceId: service.id,
        billDate: makeDate(2026, 2, 1), // March 1
        dueDate: makeDate(2026, 2, 10), // March 10
        cost: 75.0,
        convenienceFee: 2.0,
        convenienceFeeType: 'flat',
      },
    });

    await prisma.utilityReading.create({
      data: {
        serviceId: service.id,
        billDate: makeDate(2026, 1, 1), // February 1
        dueDate: makeDate(2026, 1, 10), // February 10
        cost: 70.0,
        convenienceFee: 2.0,
        convenienceFeeType: 'flat',
      },
    });

    const count = await generateSchedule({
      periodStart,
      periodEnd,
      sourceType: 'EXPENSE',
      sourceId: expense.id,
    });

    expect(count).toBe(1);
    const rows = await prisma.scheduledTransaction.findMany({
      where: { sourceId: expense.id },
    });
    expect(rows).toHaveLength(1);
    // No reading for April — uses base expense amount (60), not a reading from another month
    expect(rows[0]!.expectedAmount.toNumber()).toBe(60);
  });

  it('uses base amount when utility service exists but has no readings', async () => {
    const provider = await prisma.utilityProvider.create({
      data: { name: 'Test Garbage Co' },
    });

    const expense = await createExpense(budgetId, {
      amount: 35,
      frequency: 'MONTHLY',
      dueDay: 1,
      skipWeekend: false,
    });

    // Create service but no readings
    await prisma.utilityService.create({
      data: {
        providerId: provider.id,
        serviceType: 'GARBAGE',
        metering: 'UNMETERED',
        expenseId: expense.id,
      },
    });

    const count = await generateSchedule({
      periodStart,
      periodEnd,
      sourceType: 'EXPENSE',
      sourceId: expense.id,
    });

    expect(count).toBe(1);
    const rows = await prisma.scheduledTransaction.findMany({
      where: { sourceId: expense.id },
    });
    expect(rows).toHaveLength(1);
    // Should use base amount (35) since no readings exist
    expect(rows[0]!.expectedAmount.toNumber()).toBe(35);
  });
});

describe('Schedule Generator — amount schedule overrides', () => {
  it('BIWEEKLY uses alternating index keying (odd→"1", even→"2")', async () => {
    const expense = await createExpense(budgetId, {
      amount: 100,
      frequency: 'BIWEEKLY',
      startDate: makeDate(2026, 3, 3), // April 3 (first occurrence)
      skipWeekend: false,
      amountSchedule: { '1': 150, '2': 200 }, // odd occurrences get 150, even get 200
    });

    const count = await generateSchedule({
      periodStart,
      periodEnd,
      sourceType: 'EXPENSE',
      sourceId: expense.id,
    });

    expect(count).toBeGreaterThanOrEqual(2);
    const rows = await prisma.scheduledTransaction.findMany({
      where: { sourceId: expense.id },
      orderBy: { dueDate: 'asc' },
    });

    // First occurrence (index 1, odd) should use key "1" → 150
    expect(rows[0]!.expectedAmount.toNumber()).toBe(150);
    // Second occurrence (index 2, even) should use key "2" → 200
    expect(rows[1]!.expectedAmount.toNumber()).toBe(200);
  });

  it('SEMI_MONTHLY uses day-of-month keying (day≤15→"1", day>15→"2")', async () => {
    const expense = await createExpense(budgetId, {
      amount: 100,
      frequency: 'SEMI_MONTHLY',
      dueDay: 1, // First occurrence on the 1st, second on the 15th
      skipWeekend: false,
      amountSchedule: { '1': 250, '2': 300 }, // day≤15 gets 250, day>15 gets 300
    });

    const count = await generateSchedule({
      periodStart,
      periodEnd,
      sourceType: 'EXPENSE',
      sourceId: expense.id,
    });

    expect(count).toBe(2);
    const rows = await prisma.scheduledTransaction.findMany({
      where: { sourceId: expense.id },
      orderBy: { dueDate: 'asc' },
    });

    // First occurrence (day 1, ≤15) should use key "1" → 250
    expect(rows[0]!.dueDate.getUTCDate()).toBe(1);
    expect(rows[0]!.expectedAmount.toNumber()).toBe(250);
    // Second occurrence (day 15, ≤15) should use key "1" → 250
    expect(rows[1]!.dueDate.getUTCDate()).toBe(15);
    expect(rows[1]!.expectedAmount.toNumber()).toBe(250);
  });

  it('SEMI_MONTHLY correctly distinguishes day≤15 vs day>15', async () => {
    const expense = await createExpense(budgetId, {
      amount: 100,
      frequency: 'SEMI_MONTHLY',
      dueDay: 20, // First occurrence on the 20th (>15), second on the 15th (≤15)
      skipWeekend: false,
      amountSchedule: { '1': 175, '2': 225 }, // day≤15 gets 175, day>15 gets 225
    });

    const count = await generateSchedule({
      periodStart,
      periodEnd,
      sourceType: 'EXPENSE',
      sourceId: expense.id,
    });

    expect(count).toBe(2);
    const rows = await prisma.scheduledTransaction.findMany({
      where: { sourceId: expense.id },
      orderBy: { dueDate: 'asc' },
    });

    // First occurrence (day 15, ≤15) should use key "1" → 175
    expect(rows[0]!.dueDate.getUTCDate()).toBe(15);
    expect(rows[0]!.expectedAmount.toNumber()).toBe(175);
    // Second occurrence (day 20, >15) should use key "2" → 225
    expect(rows[1]!.dueDate.getUTCDate()).toBe(20);
    expect(rows[1]!.expectedAmount.toNumber()).toBe(225);
  });

  it('MONTHLY uses 1-indexed month keying', async () => {
    const expense = await createExpense(budgetId, {
      amount: 100,
      frequency: 'MONTHLY',
      dueDay: 15,
      skipWeekend: false,
      amountSchedule: {
        '1': 500, // January
        '2': 600, // February
        '3': 700, // March
        '4': 800, // April
        '5': 900, // May
        '6': 1000, // June
        '7': 1100, // July
        '8': 1200, // August
        '9': 1300, // September
        '10': 1400, // October
        '11': 1500, // November
        '12': 1600, // December
      },
    });

    const count = await generateSchedule({
      periodStart,
      periodEnd,
      sourceType: 'EXPENSE',
      sourceId: expense.id,
    });

    expect(count).toBe(1);
    const rows = await prisma.scheduledTransaction.findMany({
      where: { sourceId: expense.id },
    });

    // April is month 4 (1-indexed) → should use key "4" → 800
    expect(rows[0]!.expectedAmount.toNumber()).toBe(800);
  });

  it('MONTHLY falls back to base amount when month key not in schedule', async () => {
    const expense = await createExpense(budgetId, {
      amount: 100,
      frequency: 'MONTHLY',
      dueDay: 15,
      skipWeekend: false,
      amountSchedule: {
        '1': 500, // January
        '2': 600, // February
        // April (month 4) not defined
      },
    });

    const count = await generateSchedule({
      periodStart,
      periodEnd,
      sourceType: 'EXPENSE',
      sourceId: expense.id,
    });

    expect(count).toBe(1);
    const rows = await prisma.scheduledTransaction.findMany({
      where: { sourceId: expense.id },
    });

    // April (month 4) not in schedule → should use base amount (100)
    expect(rows[0]!.expectedAmount.toNumber()).toBe(100);
  });

  it('INCOME supports amount schedule overrides with BIWEEKLY frequency', async () => {
    const income = await createIncome(budgetId, {
      amount: 5000,
      frequency: 'BIWEEKLY',
      startDate: makeDate(2026, 3, 3), // April 3 (first occurrence)
      amountSchedule: {
        '1': 6000, // Odd occurrences get bonus
        '2': 5500, // Even occurrences get smaller bonus
      },
    });

    const count = await generateSchedule({
      periodStart,
      periodEnd,
      sourceType: 'INCOME',
      sourceId: income.id,
    });

    expect(count).toBeGreaterThanOrEqual(2);
    const rows = await prisma.scheduledTransaction.findMany({
      where: { sourceId: income.id },
      orderBy: { dueDate: 'asc' },
    });

    // First occurrence (index 1, odd) → should use key "1" → 6000
    expect(rows[0]!.expectedAmount.toNumber()).toBe(6000);
    // Second occurrence (index 2, even) → should use key "2" → 5500
    expect(rows[1]!.expectedAmount.toNumber()).toBe(5500);
  });
});

describe('Schedule Generator — utility due date override in main loop', () => {
  it('uses utility reading due date as occurrence date in generated scheduled transaction', async () => {
    // Create a utility provider and service linked to an expense
    const provider = await prisma.utilityProvider.create({
      data: { name: 'Test Power Co' },
    });

    const expense = await createExpense(budgetId, {
      amount: 200,
      frequency: 'MONTHLY',
      dueDay: 22,
      skipWeekend: false,
    });

    const service = await prisma.utilityService.create({
      data: {
        providerId: provider.id,
        serviceType: 'ELECTRIC',
        metering: 'METERED',
        expenseId: expense.id,
      },
    });

    // Create a utility reading with a specific due date (April 9)
    // This should override the expense's dueDay (22)
    await prisma.utilityReading.create({
      data: {
        serviceId: service.id,
        billDate: makeDate(2026, 3, 1), // April 1
        dueDate: makeDate(2026, 3, 9), // April 9 (overrides expense dueDay of 22)
        cost: 185.75,
        usage: 920,
        unitCost: 0.2019,
      },
    });

    // Call generateSchedule for the period
    const count = await generateSchedule({
      periodStart,
      periodEnd,
      sourceType: 'EXPENSE',
      sourceId: expense.id,
    });

    expect(count).toBe(1);
    const rows = await prisma.scheduledTransaction.findMany({
      where: { sourceId: expense.id },
    });
    expect(rows).toHaveLength(1);

    // Verify the scheduled transaction uses the reading's due date (April 9)
    // as the occurrence date, not the expense's default dueDay (22)
    expect(rows[0]!.dueDate.getUTCDate()).toBe(9);
    expect(rows[0]!.dueDate.getUTCMonth()).toBe(3); // April
    expect(rows[0]!.dueDate.getUTCFullYear()).toBe(2026);

    // Also verify the expected amount uses the reading cost
    expect(rows[0]!.expectedAmount.toNumber()).toBe(185.75);
  });

  it('uses expense dueDay when no utility reading exists for the month', async () => {
    const provider = await prisma.utilityProvider.create({
      data: { name: 'Test Utility Co' },
    });

    const expense = await createExpense(budgetId, {
      amount: 150,
      frequency: 'MONTHLY',
      dueDay: 18,
      skipWeekend: false,
    });

    const service = await prisma.utilityService.create({
      data: {
        providerId: provider.id,
        serviceType: 'GAS',
        metering: 'METERED',
        expenseId: expense.id,
      },
    });

    // Create a reading for a different month (May, not April)
    await prisma.utilityReading.create({
      data: {
        serviceId: service.id,
        billDate: makeDate(2026, 4, 1), // May 1
        dueDate: makeDate(2026, 4, 12), // May 12
        cost: 95.0,
      },
    });

    const count = await generateSchedule({
      periodStart,
      periodEnd,
      sourceType: 'EXPENSE',
      sourceId: expense.id,
    });

    expect(count).toBe(1);
    const rows = await prisma.scheduledTransaction.findMany({
      where: { sourceId: expense.id },
    });
    expect(rows).toHaveLength(1);

    // Should use expense's dueDay (18) since no April reading exists
    expect(rows[0]!.dueDate.getUTCDate()).toBe(18);
    expect(rows[0]!.dueDate.getUTCMonth()).toBe(3); // April

    // Should use base amount (150) since no reading exists ON OR BEFORE April
    // The May reading is in the future relative to the April occurrence
    expect(rows[0]!.expectedAmount.toNumber()).toBe(150);
  });
});

describe('Schedule Generator — all 7 frequencies produce correct rows', () => {
  it('WEEKLY produces rows for each week in the period', async () => {
    const expense = await createExpense(budgetId, {
      amount: 50,
      frequency: 'WEEKLY',
      skipWeekend: false,
    });

    const count = await generateSchedule({
      periodStart,
      periodEnd,
      sourceType: 'EXPENSE',
      sourceId: expense.id,
    });

    // April 2026: Sundays are 5, 12, 19, 26 → 4 occurrences
    expect(count).toBeGreaterThanOrEqual(3);
    expect(count).toBeLessThanOrEqual(5);
  });

  it('BIWEEKLY produces rows every 2 weeks', async () => {
    const income = await createIncome(budgetId, {
      amount: 2500,
      frequency: 'BIWEEKLY',
      startDate: makeDate(2026, 3, 3),
    });

    const count = await generateSchedule({
      periodStart,
      periodEnd,
      sourceType: 'INCOME',
      sourceId: income.id,
    });

    expect(count).toBeGreaterThanOrEqual(1);
    expect(count).toBeLessThanOrEqual(3);
  });

  it('SEMI_MONTHLY produces 2 rows per month', async () => {
    const expense = await createExpense(budgetId, {
      amount: 300,
      frequency: 'SEMI_MONTHLY',
      dueDay: 1,
      skipWeekend: false,
    });

    const count = await generateSchedule({
      periodStart,
      periodEnd,
      sourceType: 'EXPENSE',
      sourceId: expense.id,
    });

    expect(count).toBe(2);
  });

  it('MONTHLY produces 1 row per month', async () => {
    const expense = await createExpense(budgetId, {
      amount: 1200,
      frequency: 'MONTHLY',
      dueDay: 10,
      skipWeekend: false,
    });

    const count = await generateSchedule({
      periodStart,
      periodEnd,
      sourceType: 'EXPENSE',
      sourceId: expense.id,
    });

    expect(count).toBe(1);
    const rows = await prisma.scheduledTransaction.findMany({
      where: { sourceId: expense.id },
    });
    expect(rows[0]!.dueDate.getUTCDate()).toBe(10);
  });

  it('QUARTERLY produces 1 row when the quarter month falls in the period', async () => {
    const expense = await createExpense(budgetId, {
      amount: 500,
      frequency: 'QUARTERLY',
      dueDay: 15,
      startDate: makeDate(2026, 0, 1),
      skipWeekend: false,
    });

    const count = await generateSchedule({
      periodStart,
      periodEnd,
      sourceType: 'EXPENSE',
      sourceId: expense.id,
    });

    expect(count).toBe(1);
  });

  it('BIANNUAL produces 1 row when the biannual month falls in the period', async () => {
    const expense = await createExpense(budgetId, {
      amount: 2000,
      frequency: 'BIANNUAL',
      dueDay: 20,
      startDate: makeDate(2026, 3, 1),
      skipWeekend: false,
    });

    const count = await generateSchedule({
      periodStart,
      periodEnd,
      sourceType: 'EXPENSE',
      sourceId: expense.id,
    });

    expect(count).toBe(1);
  });

  it('ANNUAL produces 1 row when the annual month falls in the period', async () => {
    const expense = await createExpense(budgetId, {
      amount: 5000,
      frequency: 'ANNUAL',
      dueDay: 25,
      startDate: makeDate(2026, 3, 1),
      skipWeekend: false,
    });

    const count = await generateSchedule({
      periodStart,
      periodEnd,
      sourceType: 'EXPENSE',
      sourceId: expense.id,
    });

    expect(count).toBe(1);
    const rows = await prisma.scheduledTransaction.findMany({
      where: { sourceId: expense.id },
    });
    expect(rows[0]!.dueDate.getUTCDate()).toBe(25);
  });

  it('ANNUAL produces 0 rows when the annual month does NOT fall in the period', async () => {
    const expense = await createExpense(budgetId, {
      amount: 5000,
      frequency: 'ANNUAL',
      dueDay: 15,
      startDate: makeDate(2026, 5, 1),
      skipWeekend: false,
    });

    const count = await generateSchedule({
      periodStart,
      periodEnd,
      sourceType: 'EXPENSE',
      sourceId: expense.id,
    });

    expect(count).toBe(0);
  });
});

describe('Schedule Generator — backward match (tx created before schedule row)', () => {
  it('links an existing unmatched transaction when a new PENDING row is generated for it', async () => {
    const group = await createGroup();
    const cat = await createCategory(group.id);
    const expense = await createExpense(cat.id, {
      amount: 990,
      frequency: 'ANNUAL',
      dueDay: 18,
      startDate: makeDate(2026, 4, 1), // May anchor
      skipWeekend: false,
    });

    // Simulate: transaction was entered before schedule generation ran.
    // expenseId is set (linked to the recurring expense) but no scheduled row exists yet.
    const tx = await prisma.transaction.create({
      data: {
        type: 'EXPENSE',
        name: 'Day Camp',
        amount: 990,
        date: makeDate(2026, 4, 18), // May 18 — same as dueDate
        expenseId: expense.id,
        budgetId: cat.id,
      },
    });

    // At this point the transaction has no matching scheduled row
    const beforeScheduled = await prisma.scheduledTransaction.findUnique({
      where: { transactionId: tx.id },
    });
    expect(beforeScheduled).toBeNull();

    // Now the schedule generator runs and creates the PENDING row
    const count = await generateSchedule({
      periodStart: makeDate(2026, 4, 1), // May 1
      periodEnd: makeDate(2026, 4, 31), // May 31
      sourceType: 'EXPENSE',
      sourceId: expense.id,
    });

    expect(count).toBe(1);

    // The backward match should have linked the existing transaction
    const scheduled = await prisma.scheduledTransaction.findFirst({
      where: { sourceId: expense.id },
    });
    expect(scheduled).not.toBeNull();
    expect(scheduled!.transactionId).toBe(tx.id);
    expect(scheduled!.status).toBe('PAID');
    expect(Number(scheduled!.actualAmount)).toBe(990);
  });

  it('links a partial payment when transaction amount is less than expected', async () => {
    const group = await createGroup();
    const cat = await createCategory(group.id);
    const expense = await createExpense(cat.id, {
      amount: 500,
      frequency: 'MONTHLY',
      dueDay: 15,
      skipWeekend: false,
    });

    // Transaction entered before schedule row, partial amount
    const tx = await prisma.transaction.create({
      data: {
        type: 'EXPENSE',
        name: 'Partial Payment',
        amount: 250,
        date: makeDate(2026, 3, 15),
        expenseId: expense.id,
        budgetId: cat.id,
      },
    });

    await generateSchedule({
      periodStart: makeDate(2026, 3, 1),
      periodEnd: makeDate(2026, 3, 30),
      sourceType: 'EXPENSE',
      sourceId: expense.id,
    });

    const scheduled = await prisma.scheduledTransaction.findFirst({
      where: { sourceId: expense.id },
    });
    expect(scheduled).not.toBeNull();
    expect(scheduled!.transactionId).toBe(tx.id);
    expect(scheduled!.status).toBe('PARTIAL');
    expect(Number(scheduled!.actualAmount)).toBe(250);
  });

  it('does not link a transaction that is already matched to another scheduled row', async () => {
    const group = await createGroup();
    const cat = await createCategory(group.id);
    const expense = await createExpense(cat.id, {
      amount: 100,
      frequency: 'MONTHLY',
      dueDay: 10,
      skipWeekend: false,
    });

    const tx = await prisma.transaction.create({
      data: {
        type: 'EXPENSE',
        name: 'Already Linked Payment',
        amount: 100,
        date: makeDate(2026, 3, 10),
        expenseId: expense.id,
        budgetId: cat.id,
      },
    });

    // Create an existing scheduled row that is already linked to this tx
    const existingScheduled = await prisma.scheduledTransaction.create({
      data: {
        sourceType: 'EXPENSE',
        sourceId: expense.id,
        dueDate: makeDate(2026, 3, 9), // 1 day before — already PAID and linked
        expectedAmount: 100,
        actualAmount: 100,
        status: 'PAID',
        transactionId: tx.id,
        expenseId: expense.id,
      },
    });

    // generateSchedule tries to create April 10 row — but April is already PAID
    // (fulfilled months check) so no new row and no double-link
    await generateSchedule({
      periodStart: makeDate(2026, 3, 1),
      periodEnd: makeDate(2026, 3, 30),
      sourceType: 'EXPENSE',
      sourceId: expense.id,
    });

    // The existing linked row must be untouched
    const unchanged = await prisma.scheduledTransaction.findUnique({
      where: { id: existingScheduled.id },
    });
    expect(unchanged!.transactionId).toBe(tx.id);
    expect(unchanged!.status).toBe('PAID');
  });
});
