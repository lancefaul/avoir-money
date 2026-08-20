/**
 * Property-based tests for pause/resume API endpoints.
 * Feature: recurring-pause
 *
 * These tests hit the real API routes against the test database (port 5433).
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { prisma } from '@budget-tracker/db';
import {
  post,
  createGroup,
  createCategory,
  createIncome,
  createExpense,
  createAccount,
} from '../test/helpers.js';
import { today, makeDate } from '../lib/dates.js';

async function setupBase() {
  const group = await createGroup();
  const cat = await createCategory(group.id);
  const acct = await createAccount();
  return { group, cat, acct };
}

/** Arbitrary that produces a future date string (YYYY-MM-DD) within the next 1–365 days */
const futureDateArb = fc.integer({ min: 1, max: 365 }).map((offset) => {
  const d = new Date(today().getTime() + offset * 86_400_000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
});

// ─── Property 4: Resume sets correct state ───

describe('Feature: recurring-pause, Property 4: Resume sets correct state', () => {
  /**
   * **Validates: Requirements 3.1, 3.2**
   *
   * For any paused income, resuming with immediately=true sets pausedUntil
   * to null and startDate to today. Resuming with a specific resumeDate sets
   * pausedUntil to null and startDate to that date.
   */
  it('resume immediately sets pausedUntil=null and startDate=today', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 12 }),
        fc.constantFrom('days', 'weeks', 'months', 'years'),
        async (duration, unit) => {
          const { cat } = await setupBase();
          const income = await createIncome(cat.id, { frequency: 'MONTHLY' });

          // Pause first
          const pauseRes = await post(`/income/${income.id}/pause`, { duration, unit });
          expect(pauseRes.status).toBe(200);

          // Resume immediately
          const resumeRes = await post(`/income/${income.id}/resume`, { immediately: true });
          expect(resumeRes.status).toBe(200);

          const body = (await resumeRes.json()) as Record<string, unknown>;
          expect(body.pausedUntil).toBeNull();

          // startDate should be today (UTC midnight)
          const t = today();
          const startDate = new Date(body.startDate as string);
          expect(startDate.getUTCFullYear()).toBe(t.getUTCFullYear());
          expect(startDate.getUTCMonth()).toBe(t.getUTCMonth());
          expect(startDate.getUTCDate()).toBe(t.getUTCDate());
        },
      ),
      { numRuns: 20 },
    );
  });

  it('resume with specific date sets pausedUntil=null and startDate=that date', async () => {
    await fc.assert(
      fc.asyncProperty(futureDateArb, async (resumeDate) => {
        const { cat } = await setupBase();
        const income = await createIncome(cat.id, { frequency: 'MONTHLY' });

        // Pause indefinitely
        const pauseRes = await post(`/income/${income.id}/pause`, { indefinite: true });
        expect(pauseRes.status).toBe(200);

        // Resume with specific date
        const resumeRes = await post(`/income/${income.id}/resume`, { resumeDate });
        expect(resumeRes.status).toBe(200);

        const body = (await resumeRes.json()) as Record<string, unknown>;
        expect(body.pausedUntil).toBeNull();

        // startDate should match the provided resumeDate
        const startDate = new Date(body.startDate as string);
        const expected = new Date(resumeDate + 'T00:00:00.000Z');
        expect(startDate.getUTCFullYear()).toBe(expected.getUTCFullYear());
        expect(startDate.getUTCMonth()).toBe(expected.getUTCMonth());
        expect(startDate.getUTCDate()).toBe(expected.getUTCDate());
      }),
      { numRuns: 20 },
    );
  });
});

// ─── Property 5: Pause and resume preserve existing transactions ───

describe('Feature: recurring-pause, Property 5: Pause and resume preserve existing transactions', () => {
  /**
   * **Validates: Requirements 4.1, 4.2**
   *
   * For any income with linked transactions, pausing then resuming leaves
   * the transaction count and IDs unchanged.
   */
  it('pause then resume preserves all linked transactions for income', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 100, max: 9000 }),
        async (txCount, amount) => {
          const { cat, acct } = await setupBase();
          const income = await createIncome(cat.id, {
            amount,
            frequency: 'MONTHLY',
            accountId: acct.id,
          });

          // Create linked transactions
          const txIds: string[] = [];
          for (let i = 0; i < txCount; i++) {
            const day = String(Math.min(i + 1, 28)).padStart(2, '0');
            const tx = await prisma.transaction.create({
              data: {
                type: 'INCOME',
                name: income.name,
                amount,
                date: makeDate(2026, 2, i + 1), // March 2026
                accountId: acct.id,
                incomeId: income.id,
              },
            });
            txIds.push(tx.id);
          }

          // Snapshot before pause
          const before = await prisma.transaction.findMany({
            where: { incomeId: income.id },
            orderBy: { id: 'asc' },
          });

          // Pause
          const pauseRes = await post(`/income/${income.id}/pause`, { indefinite: true });
          expect(pauseRes.status).toBe(200);

          // Verify transactions unchanged after pause
          const afterPause = await prisma.transaction.findMany({
            where: { incomeId: income.id },
            orderBy: { id: 'asc' },
          });
          expect(afterPause.length).toBe(before.length);
          expect(afterPause.map((t) => t.id)).toEqual(before.map((t) => t.id));

          // Resume
          const resumeRes = await post(`/income/${income.id}/resume`, { immediately: true });
          expect(resumeRes.status).toBe(200);

          // Verify transactions unchanged after resume
          const afterResume = await prisma.transaction.findMany({
            where: { incomeId: income.id },
            orderBy: { id: 'asc' },
          });
          expect(afterResume.length).toBe(before.length);
          expect(afterResume.map((t) => t.id)).toEqual(before.map((t) => t.id));
          for (let i = 0; i < before.length; i++) {
            expect(Number(afterResume[i]!.amount)).toBe(Number(before[i]!.amount));
            expect(afterResume[i]!.date.getTime()).toBe(before[i]!.date.getTime());
          }
        },
      ),
      { numRuns: 15 },
    );
  });
});
