/**
 * Property-based test for balance engine Bitcoin skip (DB-backed).
 * Feature: expanded-bitcoin-features, Property 4: Balance Engine Skips Bitcoin Transactions
 *
 * **Validates: Requirements 1.6, 2.6, 3.6, 5.5**
 *
 * For any Bitcoin-denominated transaction (EXPENSE, INCOME, or REFUND with
 * accountId null), creating or deleting the transaction SHALL NOT change
 * any Account balance in the system.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { prisma } from '@budget-tracker/db';
import { applyTransactionToBalances } from '../balance.js';

// ─── Helpers ───

/** Create a test account with a known balance. */
async function createTestAccount(balance: number) {
  return prisma.account.create({
    data: {
      name: `PBT_ACCT_${Date.now()}_${Math.random()}`,
      type: 'CHECKING',
      balance,
    },
  });
}

/** Read the current balance of an account. */
async function getBalance(id: string): Promise<number> {
  const acct = await prisma.account.findUnique({ where: { id } });
  return Number(acct!.balance);
}

// ─── Generators ───

/** Random positive USD amount in [0.01, 50000]. */
const amountArb = fc.double({ min: 0.01, max: 50000, noNaN: true, noDefaultInfinity: true });

/** Initial account balance in [0, 100000]. */
const balanceArb = fc.double({ min: 0, max: 100000, noNaN: true, noDefaultInfinity: true });

/** Bitcoin-eligible transaction types. */
const btcTxTypeArb = fc.constantFrom('EXPENSE' as const, 'INCOME' as const, 'REFUND' as const);

/** Multiplier: apply (1) or reverse (-1). */
const multiplierArb = fc.constantFrom(1 as const, -1 as const);

// ─── Property 4: Balance Engine Skips Bitcoin Transactions ───

describe('Feature: expanded-bitcoin-features, Property 4: Balance Engine Skips Bitcoin Transactions', () => {
  /**
   * **Validates: Requirements 1.6, 2.6, 3.6, 5.5**
   *
   * For any Bitcoin-denominated transaction (EXPENSE, INCOME, or REFUND)
   * with accountId null and any amount, calling applyTransactionToBalances
   * SHALL NOT change any Account balance in the system.
   */
  it('null accountId leaves all Account balances unchanged', async () => {
    await fc.assert(
      fc.asyncProperty(
        balanceArb,
        amountArb,
        btcTxTypeArb,
        multiplierArb,
        async (initialBalance, amount, txType, multiplier) => {
          // Create a real account that could be affected if the guard fails
          const account = await createTestAccount(initialBalance);

          const balanceBefore = await getBalance(account.id);

          // Call the balance engine with null accountId (bitcoin transaction)
          await applyTransactionToBalances(
            {
              type: txType,
              amount,
              accountId: null,
              toAccountId: null,
            },
            multiplier,
          );

          // Verify the account balance did NOT change
          const balanceAfter = await getBalance(account.id);
          expect(balanceAfter).toBe(balanceBefore);
        },
      ),
      { numRuns: 20 },
    );
  });
});
