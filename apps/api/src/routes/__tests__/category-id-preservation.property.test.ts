/**
 * Preservation Property Tests — categoryId → budgetId rename bugfix
 *
 * Property 2: Preservation — Non-Budget Fields and Null Handling Unchanged
 *
 * These tests verify behavior that should NOT change after the rename fix.
 * They now use `budgetId` in API requests/responses, matching the fixed schemas.
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8**
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { prisma } from '@budget-tracker/db';
import {
  post,
  put,
  get,
  del,
  createAccount,
  createBudgetGroup,
  createBudget,
} from '../../test/helpers.js';

// ─── Generators ───

let counter = 0;
function uniqueName(prefix = 'PRES') {
  return `${prefix}_${++counter}_${Date.now()}`;
}

const transactionTypeArb = fc.constantFrom(
  'EXPENSE' as const,
  'INCOME' as const,
  'REFUND' as const,
);

const amountArb = fc
  .double({ min: 0.01, max: 99999, noNaN: true, noDefaultInfinity: true })
  .map((n) => Math.round(n * 100) / 100);

const noteArb = fc.option(
  fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
  { nil: null },
);

const dateArb = fc
  .date({
    min: new Date(Date.UTC(2026, 0, 1)),
    max: new Date(Date.UTC(2026, 11, 31)),
    // fc.date() includes Invalid Date (NaN) in its domain unless excluded;
    // an invalid date reaches .toISOString() below and throws RangeError,
    // which surfaced as an intermittent ~1-in-15 flake under the commit gate.
    noInvalidDate: true,
  })
  .map((d) => {
    // Normalize to UTC midnight
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  });

// ─── Shared setup ───

async function setupTestData() {
  const account = await createAccount();
  const group = await createBudgetGroup();
  const budget = await createBudget(group.id);
  return { account, group, budget };
}

// ─── Property 2.1: Null budget handling ───
// **Validates: Requirements 3.1**

describe('Property 2: Preservation — Null Budget Handling', () => {
  it('transactions with null budgetId are stored and retrieved correctly', async () => {
    await fc.assert(
      fc.asyncProperty(
        transactionTypeArb,
        amountArb,
        noteArb,
        dateArb,
        async (type, amount, note, date) => {
          const { account } = await setupTestData();

          // Create transaction with null budgetId
          const createRes = await post('/transactions', {
            type,
            name: uniqueName('NULL_BDG'),
            amount,
            date: date.toISOString(),
            accountId: account.id,
            budgetId: null,
            note,
          });
          expect(createRes.status).toBe(201);
          const created = (await createRes.json()) as Record<string, unknown>;

          // API response should have budgetId: null
          expect(created['budgetId']).toBeNull();

          // Database should have budgetId: null
          const dbRecord = await prisma.transaction.findUnique({
            where: { id: created['id'] as string },
          });
          expect(dbRecord).not.toBeNull();
          expect(dbRecord!.budgetId).toBeNull();

          // Read back via list endpoint
          const listRes = await get(`/transactions?accountId=${account.id}&skipGenerate=true`);
          expect(listRes.status).toBe(200);
          const listBody = (await listRes.json()) as { transactions: Record<string, unknown>[] };
          const found = listBody.transactions.find((t) => t['id'] === created['id']);
          expect(found).toBeDefined();
          expect(found!['budgetId']).toBeNull();
        },
      ),
      { numRuns: 5 },
    );
  });
});

// ─── Property 2.2: Non-budget field updates preserve budget field ───
// **Validates: Requirements 3.2**

describe('Property 2: Preservation — Non-Budget Field Updates', () => {
  it('updating amount, date, note preserves the budget field', async () => {
    await fc.assert(
      fc.asyncProperty(
        amountArb,
        amountArb,
        noteArb,
        dateArb,
        dateArb,
        async (origAmount, newAmount, newNote, origDate, newDate) => {
          const { account, budget } = await setupTestData();

          // Create transaction with a budget assignment
          const createRes = await post('/transactions', {
            type: 'EXPENSE',
            name: uniqueName('FIELD_UPD'),
            amount: origAmount,
            date: origDate.toISOString(),
            accountId: account.id,
            budgetId: budget.id,
            note: 'original note',
          });
          expect(createRes.status).toBe(201);
          const created = (await createRes.json()) as Record<string, unknown>;
          const txId = created['id'] as string;

          // Update only non-budget fields
          const updateRes = await put(`/transactions/${txId}`, {
            amount: newAmount,
            date: newDate.toISOString(),
            note: newNote,
          });
          expect(updateRes.status).toBe(200);
          const updated = (await updateRes.json()) as Record<string, unknown>;

          // Budget field should be preserved (not cleared or changed)
          expect(updated['budgetId']).toBe(budget.id);

          // Non-budget fields should be updated
          expect(updated['amount']).toBeCloseTo(newAmount, 1);
          expect(updated['note']).toBe(newNote);

          // Verify in database
          const dbRecord = await prisma.transaction.findUnique({ where: { id: txId } });
          expect(dbRecord!.budgetId).toBe(budget.id);
        },
      ),
      { numRuns: 5 },
    );
  });
});

// ─── Property 2.3: Lifecycle hooks — balance adjustments ───
// **Validates: Requirements 3.3**

describe('Property 2: Preservation — Lifecycle Hooks Execute Correctly', () => {
  it('balance hook adjusts account balance on create and delete', async () => {
    await fc.assert(
      fc.asyncProperty(transactionTypeArb, amountArb, async (type, amount) => {
        const { account, budget } = await setupTestData();

        // Record initial balance
        const initialAccount = await prisma.account.findUnique({ where: { id: account.id } });
        const initialBalance = Number(initialAccount!.balance);

        // Create transaction
        const createRes = await post('/transactions', {
          type,
          name: uniqueName('LIFECYCLE'),
          amount,
          date: new Date(Date.UTC(2026, 5, 15)).toISOString(),
          accountId: account.id,
          budgetId: budget.id,
        });
        expect(createRes.status).toBe(201);
        const created = (await createRes.json()) as Record<string, unknown>;
        const txId = created['id'] as string;

        // Check balance was adjusted
        const afterCreate = await prisma.account.findUnique({ where: { id: account.id } });
        const afterCreateBalance = Number(afterCreate!.balance);

        if (type === 'INCOME' || type === 'REFUND') {
          expect(afterCreateBalance).toBeCloseTo(initialBalance + amount, 1);
        } else {
          expect(afterCreateBalance).toBeCloseTo(initialBalance - amount, 1);
        }

        // Delete transaction
        const deleteRes = await del(`/transactions/${txId}`);
        expect(deleteRes.status).toBe(204);

        // Balance should be restored
        const afterDelete = await prisma.account.findUnique({ where: { id: account.id } });
        const afterDeleteBalance = Number(afterDelete!.balance);
        expect(afterDeleteBalance).toBeCloseTo(initialBalance, 1);
      }),
      { numRuns: 5 },
    );
  });
});

// ─── Property 2.4: Query filtering by non-budget fields ───
// **Validates: Requirements 3.4**

describe('Property 2: Preservation — Query Filtering', () => {
  it('filtering by accountId returns correct results', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 3 }),
        fc.integer({ min: 1, max: 3 }),
        async (countA, countB) => {
          const accountA = await createAccount();
          const accountB = await createAccount();

          // Create transactions for account A
          for (let i = 0; i < countA; i++) {
            const res = await post('/transactions', {
              type: 'EXPENSE',
              name: uniqueName('FILTER_A'),
              amount: 10,
              date: new Date(Date.UTC(2026, 5, 15)).toISOString(),
              accountId: accountA.id,
            });
            expect(res.status).toBe(201);
          }

          // Create transactions for account B
          for (let i = 0; i < countB; i++) {
            const res = await post('/transactions', {
              type: 'EXPENSE',
              name: uniqueName('FILTER_B'),
              amount: 20,
              date: new Date(Date.UTC(2026, 5, 15)).toISOString(),
              accountId: accountB.id,
            });
            expect(res.status).toBe(201);
          }

          // Filter by account A
          const listA = await get(`/transactions?accountId=${accountA.id}&skipGenerate=true`);
          expect(listA.status).toBe(200);
          const bodyA = (await listA.json()) as {
            transactions: Record<string, unknown>[];
            totalCount: number;
          };
          expect(bodyA.totalCount).toBe(countA);
          for (const tx of bodyA.transactions) {
            expect(tx['accountId']).toBe(accountA.id);
          }

          // Filter by account B
          const listB = await get(`/transactions?accountId=${accountB.id}&skipGenerate=true`);
          expect(listB.status).toBe(200);
          const bodyB = (await listB.json()) as {
            transactions: Record<string, unknown>[];
            totalCount: number;
          };
          expect(bodyB.totalCount).toBe(countB);
          for (const tx of bodyB.transactions) {
            expect(tx['accountId']).toBe(accountB.id);
          }
        },
      ),
      { numRuns: 3 },
    );
  });

  it('filtering by date range returns correct results', async () => {
    const { account } = await setupTestData();

    // Create transactions on specific dates
    const jan = await post('/transactions', {
      type: 'EXPENSE',
      name: uniqueName('JAN'),
      amount: 10,
      date: new Date(Date.UTC(2026, 0, 15)).toISOString(),
      accountId: account.id,
    });
    expect(jan.status).toBe(201);

    const mar = await post('/transactions', {
      type: 'EXPENSE',
      name: uniqueName('MAR'),
      amount: 20,
      date: new Date(Date.UTC(2026, 2, 15)).toISOString(),
      accountId: account.id,
    });
    expect(mar.status).toBe(201);

    const jun = await post('/transactions', {
      type: 'EXPENSE',
      name: uniqueName('JUN'),
      amount: 30,
      date: new Date(Date.UTC(2026, 5, 15)).toISOString(),
      accountId: account.id,
    });
    expect(jun.status).toBe(201);

    // Filter Feb–Apr: should only get March
    const dateFrom = new Date(Date.UTC(2026, 1, 1)).toISOString();
    const dateTo = new Date(Date.UTC(2026, 3, 30)).toISOString();
    const listRes = await get(
      `/transactions?accountId=${account.id}&dateFrom=${dateFrom}&dateTo=${dateTo}&skipGenerate=true`,
    );
    expect(listRes.status).toBe(200);
    const body = (await listRes.json()) as {
      transactions: Record<string, unknown>[];
      totalCount: number;
    };
    expect(body.totalCount).toBe(1);
    expect(body.transactions[0]!['amount']).toBe(20);
  });

  it('filtering by type returns correct results', async () => {
    const { account } = await setupTestData();

    await post('/transactions', {
      type: 'EXPENSE',
      name: uniqueName('TYPE_E'),
      amount: 10,
      date: new Date(Date.UTC(2026, 5, 15)).toISOString(),
      accountId: account.id,
    });
    await post('/transactions', {
      type: 'INCOME',
      name: uniqueName('TYPE_I'),
      amount: 20,
      date: new Date(Date.UTC(2026, 5, 15)).toISOString(),
      accountId: account.id,
    });

    const listRes = await get(
      `/transactions?accountId=${account.id}&type=INCOME&skipGenerate=true`,
    );
    expect(listRes.status).toBe(200);
    const body = (await listRes.json()) as {
      transactions: Record<string, unknown>[];
      totalCount: number;
    };
    expect(body.totalCount).toBe(1);
    expect(body.transactions[0]!['type']).toBe('INCOME');
  });
});

// ─── Property 2.5: Pagination ───
// **Validates: Requirements 3.5**

describe('Property 2: Preservation — Pagination', () => {
  it('page boundaries and total counts are correct', async () => {
    const { account } = await setupTestData();
    const totalTxns = 5;

    // Create 5 transactions
    const createdIds: string[] = [];
    for (let i = 0; i < totalTxns; i++) {
      const res = await post('/transactions', {
        type: 'EXPENSE',
        name: uniqueName('PAGE'),
        amount: (i + 1) * 10,
        date: new Date(Date.UTC(2026, 5, 15 - i)).toISOString(),
        accountId: account.id,
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as Record<string, unknown>;
      createdIds.push(body['id'] as string);
    }

    // Fetch page 1 (limit 2)
    const page1Res = await get(`/transactions?accountId=${account.id}&limit=2&skipGenerate=true`);
    expect(page1Res.status).toBe(200);
    const page1 = (await page1Res.json()) as {
      transactions: Record<string, unknown>[];
      totalCount: number;
      hasMore: boolean;
      nextCursor: string | null;
    };
    expect(page1.totalCount).toBe(totalTxns);
    expect(page1.transactions.length).toBe(2);
    expect(page1.hasMore).toBe(true);
    expect(page1.nextCursor).not.toBeNull();

    // Fetch page 2 using cursor
    const page2Res = await get(
      `/transactions?accountId=${account.id}&limit=2&cursor=${page1.nextCursor}&skipGenerate=true`,
    );
    expect(page2Res.status).toBe(200);
    const page2 = (await page2Res.json()) as {
      transactions: Record<string, unknown>[];
      totalCount: number;
      hasMore: boolean;
      nextCursor: string | null;
    };
    expect(page2.totalCount).toBe(totalTxns);
    expect(page2.transactions.length).toBe(2);
    expect(page2.hasMore).toBe(true);

    // Fetch page 3 — should have 1 remaining
    const page3Res = await get(
      `/transactions?accountId=${account.id}&limit=2&cursor=${page2.nextCursor}&skipGenerate=true`,
    );
    expect(page3Res.status).toBe(200);
    const page3 = (await page3Res.json()) as {
      transactions: Record<string, unknown>[];
      totalCount: number;
      hasMore: boolean;
      nextCursor: string | null;
    };
    expect(page3.totalCount).toBe(totalTxns);
    expect(page3.transactions.length).toBe(1);
    expect(page3.hasMore).toBe(false);

    // All IDs across pages should be unique
    const allPageIds = [
      ...page1.transactions.map((t) => t['id']),
      ...page2.transactions.map((t) => t['id']),
      ...page3.transactions.map((t) => t['id']),
    ];
    expect(new Set(allPageIds).size).toBe(totalTxns);
  });
});

// ─── Property 2.6: Deletion — lifecycle hooks reverse correctly ───
// **Validates: Requirements 3.6**

describe('Property 2: Preservation — Deletion Reversal', () => {
  it('deleting a transaction reverses balance adjustments', async () => {
    await fc.assert(
      fc.asyncProperty(transactionTypeArb, amountArb, async (type, amount) => {
        const { account } = await setupTestData();

        // Record initial balance
        const initialAccount = await prisma.account.findUnique({ where: { id: account.id } });
        const initialBalance = Number(initialAccount!.balance);

        // Create and then delete
        const createRes = await post('/transactions', {
          type,
          name: uniqueName('DEL_REV'),
          amount,
          date: new Date(Date.UTC(2026, 5, 15)).toISOString(),
          accountId: account.id,
        });
        expect(createRes.status).toBe(201);
        const created = (await createRes.json()) as Record<string, unknown>;

        const deleteRes = await del(`/transactions/${created['id']}`);
        expect(deleteRes.status).toBe(204);

        // Balance should be back to initial
        const finalAccount = await prisma.account.findUnique({ where: { id: account.id } });
        expect(Number(finalAccount!.balance)).toBeCloseTo(initialBalance, 1);

        // Transaction should not exist
        const dbRecord = await prisma.transaction.findUnique({
          where: { id: created['id'] as string },
        });
        expect(dbRecord).toBeNull();
      }),
      { numRuns: 5 },
    );
  });
});

// ─── Property 2.7: Cache invalidation keys are correct ───
// **Validates: Requirements 3.7**

describe('Property 2: Preservation — Cache Invalidation', () => {
  it('TRANSACTION_QUERY_KEYS contains all expected cache keys', async () => {
    // Verify the cache invalidation file content directly
    // (web module can't be imported from API test context)
    const fs = await import('node:fs');
    const path = await import('node:path');
    const projectRoot = path.resolve(__dirname, '../../../../../');
    const cacheFile = fs.readFileSync(
      path.join(projectRoot, 'apps/web/src/lib/cache-invalidation.ts'),
      'utf-8',
    );

    // Verify the expected keys are present
    const expectedKeys = [
      'transactions',
      'investments',
      'investment-history',
      'accounts',
      'dashboard',
      'debts',
    ];
    for (const key of expectedKeys) {
      expect(cacheFile).toContain(`'${key}'`);
    }

    // Verify the invalidation function exists
    expect(cacheFile).toContain('invalidateTransactionCaches');
  });
});

// ─── Property 2.8: Error handling for non-budget validation ───
// **Validates: Requirements 3.8**

describe('Property 2: Preservation — Error Handling', () => {
  it('validation errors for non-budget fields are unchanged', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(
          // Missing required name
          { type: 'EXPENSE', amount: 50, date: new Date(Date.UTC(2026, 5, 15)).toISOString() },
          // Negative amount
          {
            type: 'EXPENSE',
            name: 'test',
            amount: -1,
            date: new Date(Date.UTC(2026, 5, 15)).toISOString(),
          },
          // Amount too large
          {
            type: 'EXPENSE',
            name: 'test',
            amount: 9999999999,
            date: new Date(Date.UTC(2026, 5, 15)).toISOString(),
          },
        ),
        async (invalidPayload) => {
          const res = await post('/transactions', invalidPayload);
          // Should get a 400 or 422 validation error
          expect(res.status).toBeGreaterThanOrEqual(400);
          expect(res.status).toBeLessThan(500);
        },
      ),
      { numRuns: 3 },
    );
  });

  it('deleting a non-existent transaction returns 404', async () => {
    const res = await del('/transactions/non-existent-id-12345');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBeDefined();
  });

  it('updating a non-existent transaction returns 404', async () => {
    const res = await put('/transactions/non-existent-id-12345', {
      amount: 100,
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBeDefined();
  });

  it('transfer without toAccountId returns 400', async () => {
    const { account } = await setupTestData();
    const res = await post('/transactions', {
      type: 'TRANSFER',
      name: uniqueName('XFER_ERR'),
      amount: 50,
      date: new Date(Date.UTC(2026, 5, 15)).toISOString(),
      accountId: account.id,
    });
    expect(res.status).toBe(400);
  });

  it('transfer with same from/to account returns 400', async () => {
    const { account } = await setupTestData();
    const res = await post('/transactions', {
      type: 'TRANSFER',
      name: uniqueName('XFER_SAME'),
      amount: 50,
      date: new Date(Date.UTC(2026, 5, 15)).toISOString(),
      accountId: account.id,
      toAccountId: account.id,
    });
    expect(res.status).toBe(400);
  });

  it('deleting a transaction with children returns 409', async () => {
    const { account, budget } = await setupTestData();

    // Create parent transaction
    const parentRes = await post('/transactions', {
      type: 'EXPENSE',
      name: uniqueName('PARENT'),
      amount: 100,
      date: new Date(Date.UTC(2026, 5, 15)).toISOString(),
      accountId: account.id,
      budgetId: budget.id,
    });
    expect(parentRes.status).toBe(201);
    const parent = (await parentRes.json()) as Record<string, unknown>;
    const parentId = parent['id'] as string;

    // Create child transaction via children endpoint
    const childRes = await post(`/transactions/${parentId}/children`, {
      budgetId: budget.id,
      preTaxAmount: 50,
      note: 'child item',
    });
    expect(childRes.status).toBe(201);

    // Try to delete parent — should fail with 409
    const deleteRes = await del(`/transactions/${parentId}`);
    expect(deleteRes.status).toBe(409);
    const body = (await deleteRes.json()) as { error: string };
    expect(body.error).toContain('child');
  });
});
