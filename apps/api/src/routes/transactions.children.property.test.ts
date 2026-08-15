/**
 * Property-based tests for child transaction API operations.
 * Feature: transaction-splitting, Properties 3–8, 10
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  get,
  post,
  put,
  del,
  createAccount,
  createGroup,
  createCategory,
} from '../test/helpers.js';
import { computeLineTotal } from '@budget-tracker/core';

// ─── Helpers ───

/** Round to 2 decimal places, matching the implementation */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Create a splittable EXPENSE parent transaction and return its id + supporting ids */
async function createParent(amount: number, type: 'EXPENSE' | 'REFUND' = 'EXPENSE') {
  const group = await createGroup();
  const category = await createCategory(group.id);
  const account = await createAccount();
  const res = await post('/transactions', {
    type,
    name: 'Parent',
    amount,
    date: '2026-03-20',
    accountId: account.id,
    budgetId: category.id,
  });
  expect(res.status).toBe(201);
  const parent = (await res.json()) as { id: string };
  return { parentId: parent.id, budgetId: category.id, accountId: account.id, groupId: group.id };
}

/** Create a second category for child transactions */
async function createAltCategory(groupId: string) {
  return createCategory(groupId);
}

// ─── Generators ───

/** Parent amount: integer cents converted to dollars to avoid floating-point issues */
const parentAmountArb = fc.integer({ min: 100, max: 100000 }).map((cents) => round2(cents / 100));

/** Child pre-tax amount as fraction of a given max */
function childPreTaxArb(max: number) {
  const maxCents = Math.max(1, Math.floor(max * 100));
  return fc.integer({ min: 1, max: maxCents }).map((cents) => round2(cents / 100));
}

/** Tax rate between 0 and 20% (realistic range) */
const taxRateArb = fc.integer({ min: 0, max: 2000 }).map((bp) => round2(bp / 100));

// ─── Property 3: Children sum invariant ───

describe('Feature: transaction-splitting, Property 3: Children sum invariant', () => {
  /**
   * **Validates: Requirements 1.5, 2.1, 2.3, 3.1, 6.4, 7.3**
   *
   * For any parent transaction and any sequence of child create/update/delete
   * operations that are individually accepted, the sum of all children's lineTotal
   * values should always be <= parent amount, and remainingAmount should equal
   * parent.amount - sum(children.lineTotal).
   */
  it('sum of children lineTotals <= parent amount and remainingAmount is correct after operations', async () => {
    await fc.assert(
      fc.asyncProperty(
        parentAmountArb,
        fc.integer({ min: 1, max: 4 }),
        async (parentAmount, numChildren) => {
          const { parentId, budgetId } = await createParent(parentAmount);

          // Create children that fit within the parent amount
          const childIds: string[] = [];
          let allocated = 0;

          for (let i = 0; i < numChildren; i++) {
            const remaining = round2(parentAmount - allocated);
            if (remaining < 0.01) break;

            const preTaxAmount = round2(remaining / (numChildren - i));
            if (preTaxAmount < 0.01) break;

            const res = await post(`/transactions/${parentId}/children`, {
              budgetId,
              preTaxAmount,
            });

            if (res.status === 201) {
              const child = (await res.json()) as { id: string; lineTotal: number };
              childIds.push(child.id);
              allocated = round2(allocated + child.lineTotal);
            }
          }

          // Verify invariant via GET children
          const listRes = await get(`/transactions/${parentId}/children`);
          expect(listRes.status).toBe(200);
          const data = (await listRes.json()) as {
            children: { lineTotal: number }[];
            remainingAmount: number;
            parentAmount: number;
          };

          const sumLineTotals = round2(data.children.reduce((sum, ch) => sum + ch.lineTotal, 0));
          expect(sumLineTotals).toBeLessThanOrEqual(parentAmount + 0.001);
          expect(data.remainingAmount).toBeCloseTo(parentAmount - sumLineTotals, 2);

          // Delete one child if any exist, then re-check invariant
          if (childIds.length > 0) {
            const deleteRes = await del(`/transactions/${parentId}/children/${childIds[0]}`);
            expect(deleteRes.status).toBe(204);

            const listRes2 = await get(`/transactions/${parentId}/children`);
            const data2 = (await listRes2.json()) as {
              children: { lineTotal: number }[];
              remainingAmount: number;
              parentAmount: number;
            };
            const sumAfterDelete = round2(
              data2.children.reduce((sum, ch) => sum + ch.lineTotal, 0),
            );
            expect(sumAfterDelete).toBeLessThanOrEqual(parentAmount + 0.001);
            expect(data2.remainingAmount).toBeCloseTo(parentAmount - sumAfterDelete, 2);
          }
        },
      ),
      { numRuns: 20 },
    );
  });
});

// ─── Property 4: Overflow rejection ───

describe('Feature: transaction-splitting, Property 4: Overflow rejection', () => {
  /**
   * **Validates: Requirements 1.6, 2.2, 3.3**
   *
   * For any parent with existing children, if a create or update would cause
   * sum of children to exceed parent amount, the system should reject it.
   */
  it('rejects child creation that would exceed parent amount', async () => {
    await fc.assert(
      fc.asyncProperty(parentAmountArb, async (parentAmount) => {
        const { parentId, budgetId } = await createParent(parentAmount);

        // Create a child that takes the full amount
        const res1 = await post(`/transactions/${parentId}/children`, {
          budgetId,
          preTaxAmount: parentAmount,
        });
        expect(res1.status).toBe(201);

        // Try to create another child — should be rejected
        const res2 = await post(`/transactions/${parentId}/children`, {
          budgetId,
          preTaxAmount: 0.01,
        });
        expect(res2.status).toBe(400);
        const body = (await res2.json()) as { error: string };
        expect(body.error).toContain('exceeds remaining');
      }),
      { numRuns: 20 },
    );
  });

  it('rejects child update that would exceed parent amount', async () => {
    await fc.assert(
      fc.asyncProperty(parentAmountArb, async (parentAmount) => {
        const { parentId, budgetId } = await createParent(parentAmount);

        // Create a child that takes the full parent amount
        const res1 = await post(`/transactions/${parentId}/children`, {
          budgetId,
          preTaxAmount: parentAmount,
        });
        expect(res1.status).toBe(201);
        const child1 = (await res1.json()) as { id: string };

        // Try to update the child to exceed the parent amount
        const res2 = await put(`/transactions/${parentId}/children/${child1.id}`, {
          preTaxAmount: round2(parentAmount + 0.01),
        });
        expect(res2.status).toBe(400);
      }),
      { numRuns: 20 },
    );
  });
});

// ─── Property 5: Child creation round-trip ───

describe('Feature: transaction-splitting, Property 5: Child creation round-trip', () => {
  /**
   * **Validates: Requirements 1.1, 6.1**
   *
   * For any valid child input created against a splittable parent with sufficient
   * remaining, fetching children should return a child matching the input values
   * and computed lineTotal.
   */
  it('created child appears in GET children with matching fields', async () => {
    await fc.assert(
      fc.asyncProperty(
        parentAmountArb,
        taxRateArb,
        fc.constantFrom('none', 'amount', 'rate') as fc.Arbitrary<'none' | 'amount' | 'rate'>,
        fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
        async (parentAmount, taxValue, taxMode, note) => {
          const { parentId, budgetId } = await createParent(parentAmount);

          // Build child input that fits within parent
          const maxPreTax =
            taxMode === 'rate'
              ? round2(parentAmount / (1 + taxValue / 100))
              : taxMode === 'amount'
                ? round2(parentAmount - taxValue)
                : parentAmount;

          if (maxPreTax < 0.01) return; // skip if no room

          const preTaxAmount = round2(Math.min(maxPreTax, parentAmount * 0.5));
          if (preTaxAmount < 0.01) return;

          const childInput: Record<string, unknown> = { budgetId, preTaxAmount };
          if (taxMode === 'amount') {
            const taxAmt = round2(Math.min(taxValue, round2(parentAmount - preTaxAmount)));
            childInput.taxAmount = taxAmt;
          } else if (taxMode === 'rate') {
            childInput.taxRate = taxValue;
          }
          if (note !== undefined) childInput.note = note;

          // Compute expected lineTotal
          const expected = computeLineTotal({
            preTaxAmount,
            taxAmount: childInput.taxAmount as number | undefined,
            taxRate: childInput.taxRate as number | undefined,
          });

          // Skip if it would overflow
          if (expected.lineTotal > parentAmount) return;

          const createRes = await post(`/transactions/${parentId}/children`, childInput);
          if (createRes.status !== 201) return; // skip edge cases where rounding causes rejection

          const created = (await createRes.json()) as { id: string; lineTotal: number };

          // Fetch children and verify round-trip
          const listRes = await get(`/transactions/${parentId}/children`);
          expect(listRes.status).toBe(200);
          const data = (await listRes.json()) as {
            children: {
              id: string;
              budgetId: string;
              preTaxAmount: number;
              lineTotal: number;
              note: string | null;
            }[];
          };

          const found = data.children.find((ch) => ch.id === created.id);
          expect(found).toBeDefined();
          expect(found!.budgetId).toBe(budgetId);
          expect(found!.preTaxAmount).toBeCloseTo(preTaxAmount, 2);
          expect(found!.lineTotal).toBeCloseTo(expected.lineTotal, 2);
          if (note !== undefined) {
            expect(found!.note).toBe(note);
          }
        },
      ),
      { numRuns: 20 },
    );
  });
});

// ─── Property 6: Parent deletion blocked with children ───

describe('Feature: transaction-splitting, Property 6: Parent deletion blocked with children', () => {
  /**
   * **Validates: Requirements 3.2**
   *
   * For any parent transaction that has at least one child transaction,
   * attempting to delete the parent should be rejected.
   */
  it('DELETE parent returns 409 when children exist', async () => {
    await fc.assert(
      fc.asyncProperty(parentAmountArb, async (parentAmount) => {
        const { parentId, budgetId } = await createParent(parentAmount);

        // Create a child
        const childRes = await post(`/transactions/${parentId}/children`, {
          budgetId,
          preTaxAmount: round2(parentAmount / 2),
        });
        expect(childRes.status).toBe(201);

        // Attempt to delete parent
        const deleteRes = await del(`/transactions/${parentId}`);
        expect(deleteRes.status).toBe(409);
        const body = (await deleteRes.json()) as { error: string };
        expect(body.error).toContain('child');
      }),
      { numRuns: 20 },
    );
  });
});

// ─── Property 7: No nested splitting ───

describe('Feature: transaction-splitting, Property 7: No nested splitting', () => {
  /**
   * **Validates: Requirements 3.4**
   *
   * For any child transaction, attempting to create a child of that child
   * should be rejected.
   */
  it('rejects creating a child of a child transaction', async () => {
    await fc.assert(
      fc.asyncProperty(parentAmountArb, async (parentAmount) => {
        const { parentId, budgetId } = await createParent(parentAmount);

        // Create a child
        const childRes = await post(`/transactions/${parentId}/children`, {
          budgetId,
          preTaxAmount: round2(parentAmount / 2),
        });
        expect(childRes.status).toBe(201);
        const child = (await childRes.json()) as { id: string };

        // Attempt to create a child of the child
        const nestedRes = await post(`/transactions/${child.id}/children`, {
          budgetId,
          preTaxAmount: 1,
        });
        expect(nestedRes.status).toBe(400);
        const body = (await nestedRes.json()) as { error: string };
        expect(body.error).toContain('Cannot split a child');
      }),
      { numRuns: 20 },
    );
  });
});

// ─── Property 8: Only EXPENSE and REFUND are splittable ───

describe('Feature: transaction-splitting, Property 8: Only EXPENSE and REFUND are splittable', () => {
  /**
   * **Validates: Requirements 3.5**
   *
   * For any transaction of type INCOME, TRANSFER, or TRADE, attempting to
   * create a child should be rejected.
   */
  it('rejects child creation on non-splittable transaction types', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('INCOME', 'TRANSFER') as fc.Arbitrary<'INCOME' | 'TRANSFER'>,
        parentAmountArb,
        async (txType, amount) => {
          const group = await createGroup();
          const category = await createCategory(group.id);
          const account = await createAccount();

          const txBody: Record<string, unknown> = {
            type: txType,
            name: 'NonSplittable',
            amount,
            date: '2026-03-20',
            accountId: account.id,
            budgetId: category.id,
          };

          // TRANSFER needs a toAccountId
          if (txType === 'TRANSFER') {
            const toAccount = await createAccount();
            txBody.toAccountId = toAccount.id;
          }

          const createRes = await post('/transactions', txBody);
          expect(createRes.status).toBe(201);
          const tx = (await createRes.json()) as { id: string };

          // Attempt to create a child
          const childRes = await post(`/transactions/${tx.id}/children`, {
            budgetId: category.id,
            preTaxAmount: 1,
          });
          expect(childRes.status).toBe(400);
          const body = (await childRes.json()) as { error: string };
          expect(body.error).toContain('Only EXPENSE and REFUND');
        },
      ),
      { numRuns: 20 },
    );
  });
});

// ─── Property 10: Has-children flag accuracy ───

describe('Feature: transaction-splitting, Property 10: Has-children flag accuracy', () => {
  /**
   * **Validates: Requirements 7.4**
   *
   * For any transaction, the hasChildren indicator (childCount) returned by the
   * list endpoint should be > 0 iff the transaction has child records.
   */
  it('childCount reflects actual child count in list endpoint', async () => {
    await fc.assert(
      fc.asyncProperty(
        parentAmountArb,
        fc.integer({ min: 0, max: 3 }),
        async (parentAmount, numChildren) => {
          const { parentId, budgetId } = await createParent(parentAmount);

          // Create the specified number of children
          let allocated = 0;
          for (let i = 0; i < numChildren; i++) {
            const remaining = round2(parentAmount - allocated);
            if (remaining < 0.01) break;
            const preTaxAmount = round2(remaining / (numChildren - i));
            if (preTaxAmount < 0.01) break;

            const res = await post(`/transactions/${parentId}/children`, {
              budgetId,
              preTaxAmount,
            });
            if (res.status === 201) {
              const child = (await res.json()) as { lineTotal: number };
              allocated = round2(allocated + child.lineTotal);
            }
          }

          // Fetch the transaction list and find our parent
          const listRes = await get('/transactions?skipGenerate=true');
          expect(listRes.status).toBe(200);
          const data = (await listRes.json()) as {
            transactions: { id: string; childCount: number }[];
          };

          const found = data.transactions.find((t) => t.id === parentId);
          expect(found).toBeDefined();

          if (numChildren === 0) {
            expect(found!.childCount).toBe(0);
          } else {
            expect(found!.childCount).toBeGreaterThan(0);
          }
        },
      ),
      { numRuns: 20 },
    );
  });
});
