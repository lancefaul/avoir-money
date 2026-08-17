/**
 * Property test: a merge is balance-neutral (reconcile-merge task 2.5).
 *
 * For any set of same-type EXPENSE (or REFUND) transactions summing to the
 * statement amount, replacing them with the parent + children leaves the
 * account's balance exactly where it was. Deleting the originals returns their
 * combined effect; the parent takes the same effect back; the children are
 * excluded from balance entirely. Net zero, for every shape of input.
 *
 * Amounts are generated as integer cents so each is exactly representable at 2dp
 * — no `fc.double`, so no NaN/Infinity guard is needed here.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import fc from 'fast-check';
import { prisma } from '@budget-tracker/db';
import { sumCurrency } from '@budget-tracker/core';
import { post } from '../test/helpers.js';
import { createBudgetGroup, createBudget } from '../test/helpers.js';
import { ledgerCreate } from '../lib/lifecycle/index.js';

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    await prisma.$connect();
  }
});

// The merge substitutes Uncategorized for a null child budget; recreate it after
// the global per-test truncation (see reconciliations.merge.test.ts).
beforeEach(async () => {
  const existing = await prisma.budget.findFirst({
    where: { name: 'Uncategorized', isSystem: true },
  });
  if (!existing) {
    const group = await createBudgetGroup('__mrgp_system');
    await prisma.budget.create({
      data: { name: 'Uncategorized', isSystem: true, groupId: group.id },
    });
  }
});

const centsArb = fc.integer({ min: 1, max: 500_000 });

describe('merge is balance-neutral', () => {
  it('the account balance after a merge equals the balance before', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('EXPENSE', 'REFUND'),
        fc.array(centsArb, { minLength: 1, maxLength: 6 }),
        async (type, cents) => {
          const group = await createBudgetGroup();
          const budget = await createBudget(group.id);
          const account = await prisma.account.create({
            data: {
              name: `__mp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              type: 'CHECKING',
              balance: 0,
              openingBalance: 0,
            },
          });

          const amounts = cents.map((c) => c / 100);
          const ids: string[] = [];
          for (const amount of amounts) {
            const tx = await ledgerCreate({
              type,
              name: 'p',
              amount,
              date: new Date(Date.UTC(2026, 1, 5)),
              accountId: account.id,
              budgetId: budget.id,
            });
            ids.push(tx.id);
          }
          const sum = sumCurrency(amounts);

          const balanceBefore = Number(
            (await prisma.account.findUniqueOrThrow({ where: { id: account.id } })).balance,
          );

          const sessionRes = await post('/reconciliations', {
            accountId: account.id,
            periodStart: '2026-02-01',
            periodEnd: '2026-02-28',
            statementEndingBalance: 0,
          });
          const sessionId = ((await sessionRes.json()) as { id: string }).id;
          const row = await prisma.statementRow.create({
            data: {
              sessionId,
              postedDate: new Date(Date.UTC(2026, 1, 8)),
              transactionDate: new Date(Date.UTC(2026, 1, 5)),
              description: 'x',
              amount: type === 'EXPENSE' ? -sum : sum,
              rawLine: `r-${Math.random()}`,
            },
          });

          const res = await post(`/reconciliations/${sessionId}/merge`, {
            statementRowId: row.id,
            transactionIds: ids,
            name: 'Merged',
          });
          expect(res.status).toBe(201);

          const balanceAfter = Number(
            (await prisma.account.findUniqueOrThrow({ where: { id: account.id } })).balance,
          );
          expect(balanceAfter).toBe(balanceBefore);
        },
      ),
      { numRuns: 12 },
    );
  }, 120_000);
});
