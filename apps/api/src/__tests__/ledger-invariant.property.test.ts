/**
 * Property-based test for the ledger invariant (2026-07-18).
 *
 *     openingBalance + SUM(transactions) == balance
 *
 * This is the code-side counterpart to `scripts/check-ledger-integrity.sh`. The
 * script asserts the invariant against live data at a point in time; this asserts
 * that no *sequence* of ledger operations can break it in the first place.
 *
 * Why a property test rather than more examples: the bug this defends against was
 * never a single wrong operation. Account.balance is maintained incrementally by
 * the balance hook, while the sum of transactions is the independent ground truth
 * — and for months nothing compared the two. A drift only appears after a specific
 * interleaving (create, then edit the amount, then delete something earlier), which
 * is exactly the shape example-based tests miss and fast-check finds by shrinking.
 *
 * Scope note: covers the four types that move account balances directly — EXPENSE,
 * INCOME, REFUND, TRANSFER — plus amount edits and deletes. TRADE is deliberately
 * excluded here because it requires holding/custodian fixtures; its balance effect
 * is covered by the trade-holding hook tests. That is a real gap in this file, not
 * a claim of full coverage.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fc from 'fast-check';
import { prisma } from '@budget-tracker/db';
import { ledgerCreate, ledgerUpdate, ledgerDelete } from '../lib/lifecycle/index.js';

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    await prisma.$connect();
  }
});

// ─── Generators ───

/**
 * Amounts are generated as integer cents and divided, so every input is exactly
 * representable at 2dp. Generating dollars as doubles would inject float noise the
 * test would then be measuring instead of the invariant.
 */
const centsArb = fc.integer({ min: 1, max: 500_000 });

/** Day-of-month only; Date.UTC keeps this off the local-time and Invalid Date traps. */
const dayArb = fc.integer({ min: 1, max: 28 });

const opArb = fc.record({
  kind: fc.constantFrom('EXPENSE', 'INCOME', 'REFUND', 'TRANSFER', 'UPDATE', 'DELETE'),
  /** Which of the two accounts this operation acts on. */
  acct: fc.integer({ min: 0, max: 1 }),
  cents: centsArb,
  day: dayArb,
  /** Index into the live transaction list, taken modulo its length. */
  target: fc.nat({ max: 1000 }),
});

// ─── Invariant ───

/**
 * The signed sum of everything touching an account. Deliberately expressed as raw
 * SQL mirroring `scripts/check-ledger-integrity.sh` and the openingBalance backfill
 * migration — computing it with the same TypeScript helper the production code uses
 * would make the test agree with a bug rather than catch it.
 */
async function transactionSum(accountId: string): Promise<number> {
  const rows = await prisma.$queryRaw<{ total: string | null }[]>`
    SELECT SUM(
      CASE
        WHEN t.type IN ('INCOME', 'REFUND') THEN t."netAmount"
        WHEN t.type = 'EXPENSE' THEN -t."netAmount"
        WHEN t.type = 'TRANSFER' AND t."toAccountId" = ${accountId} THEN t."netAmount"
        WHEN t.type = 'TRANSFER' THEN -t."netAmount"
        ELSE 0
      END
    )::text AS total
    FROM "Transaction" t
    WHERE t."parentId" IS NULL
      AND (t."accountId" = ${accountId} OR (t."toAccountId" = ${accountId} AND t.type = 'TRANSFER'))
  `;
  return Number(rows[0]?.total ?? 0);
}

async function assertInvariant(accountId: string, label: string): Promise<void> {
  const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
  const sum = await transactionSum(accountId);
  const expected = Math.round((Number(account.openingBalance) + sum) * 100) / 100;
  expect(Number(account.balance), `ledger invariant broken on ${label}`).toBe(expected);
}

// ─── Fixture lifecycle ───

async function makeAccounts(openingA: number, openingB: number) {
  const tag = `__inv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const a = await prisma.account.create({
    data: { name: `${tag}_a`, type: 'CHECKING', balance: openingA, openingBalance: openingA },
  });
  const b = await prisma.account.create({
    data: { name: `${tag}_b`, type: 'CREDIT_CARD', balance: openingB, openingBalance: openingB },
  });
  return [a, b] as const;
}

async function dropAccounts(ids: string[]) {
  // Transaction.accountId is onDelete: Restrict — rows must go first.
  await prisma.transaction.deleteMany({
    where: { OR: [{ accountId: { in: ids } }, { toAccountId: { in: ids } }] },
  });
  await prisma.account.deleteMany({ where: { id: { in: ids } } });
}

// ─── Properties ───

describe('Ledger invariant: openingBalance + SUM(transactions) == balance', () => {
  it('survives arbitrary sequences of creates, amount edits and deletes', async () => {
    await fc.assert(
      fc.asyncProperty(
        centsArb,
        centsArb,
        fc.array(opArb, { minLength: 1, maxLength: 8 }),
        async (openA, openB, ops) => {
          const [a, b] = await makeAccounts(openA / 100, -(openB / 100));
          const live: string[] = [];

          try {
            for (const op of ops) {
              const amount = op.cents / 100;
              const date = new Date(Date.UTC(2026, 6, op.day));
              const source = op.acct === 0 ? a : b;

              if (op.kind === 'UPDATE' || op.kind === 'DELETE') {
                if (live.length === 0) continue;
                const idx = op.target % live.length;
                const id = live[idx]!;
                if (op.kind === 'UPDATE') {
                  await ledgerUpdate(id, { amount });
                } else {
                  await ledgerDelete(id);
                  live.splice(idx, 1);
                }
                continue;
              }

              const tx = await ledgerCreate({
                type: op.kind,
                name: `__inv_${op.kind.toLowerCase()}`,
                amount,
                date,
                accountId: source.id,
                // A transfer needs a counterparty; send it to the other account.
                ...(op.kind === 'TRANSFER' ? { toAccountId: (op.acct === 0 ? b : a).id } : {}),
              });
              live.push(tx.id);
            }

            await assertInvariant(a.id, 'account A');
            await assertInvariant(b.id, 'account B');
          } finally {
            await dropAccounts([a.id, b.id]);
          }
        },
      ),
      { numRuns: 25 },
    );
  }, 120_000);

  it('a $transaction of ledger ops that throws leaves every invariant exactly as before', async () => {
    // The composability guarantee (reconcile-merge task 1): a merge deletes N rows
    // and creates one inside a single `$transaction`, so a failure partway must undo
    // everything — including the balance the hook moves. This only holds because the
    // gate AND every hook take the transaction client; a hook writing through the
    // module-level `prisma` would escape the rollback and drift the balance.
    await fc.assert(
      fc.asyncProperty(
        centsArb,
        centsArb,
        fc.array(centsArb, { minLength: 1, maxLength: 4 }),
        fc.array(opArb, { minLength: 1, maxLength: 6 }),
        async (openA, openB, seeds, ops) => {
          const [a, b] = await makeAccounts(openA / 100, -(openB / 100));
          const live: string[] = [];

          try {
            // Commit a starting state the doomed transaction can also mutate.
            for (const cents of seeds) {
              const tx = await ledgerCreate({
                type: 'EXPENSE',
                name: '__inv_seed',
                amount: cents / 100,
                date: new Date(Date.UTC(2026, 6, 9)),
                accountId: a.id,
              });
              live.push(tx.id);
            }

            const whereBoth = {
              OR: [{ accountId: { in: [a.id, b.id] } }, { toAccountId: { in: [a.id, b.id] } }],
            };
            const beforeA = Number(
              (await prisma.account.findUniqueOrThrow({ where: { id: a.id } })).balance,
            );
            const beforeB = Number(
              (await prisma.account.findUniqueOrThrow({ where: { id: b.id } })).balance,
            );
            const beforeCount = await prisma.transaction.count({ where: whereBoth });

            // Run a batch of ledger ops through the transaction client, then throw.
            await expect(
              prisma.$transaction(async (txc) => {
                // A local mirror so an op never targets a row already deleted in this
                // batch (which would throw its own error before the forced one).
                const txnLive = [...live];
                for (const op of ops) {
                  const amount = op.cents / 100;
                  const date = new Date(Date.UTC(2026, 6, op.day));
                  const source = op.acct === 0 ? a : b;

                  if (op.kind === 'UPDATE' || op.kind === 'DELETE') {
                    if (txnLive.length === 0) continue;
                    const idx = op.target % txnLive.length;
                    const id = txnLive[idx]!;
                    if (op.kind === 'UPDATE') {
                      await ledgerUpdate(id, { amount }, txc);
                    } else {
                      await ledgerDelete(id, undefined, txc);
                      txnLive.splice(idx, 1);
                    }
                    continue;
                  }

                  const tx = await ledgerCreate(
                    {
                      type: op.kind,
                      name: `__inv_${op.kind.toLowerCase()}`,
                      amount,
                      date,
                      accountId: source.id,
                      ...(op.kind === 'TRANSFER'
                        ? { toAccountId: (op.acct === 0 ? b : a).id }
                        : {}),
                    },
                    txc,
                  );
                  txnLive.push(tx.id);
                }
                throw new Error('forced rollback');
              }),
            ).rejects.toThrow('forced rollback');

            // Nothing the doomed transaction did survived: balances, row count, and
            // the invariant are all exactly as they were before it ran.
            const afterA = Number(
              (await prisma.account.findUniqueOrThrow({ where: { id: a.id } })).balance,
            );
            const afterB = Number(
              (await prisma.account.findUniqueOrThrow({ where: { id: b.id } })).balance,
            );
            const afterCount = await prisma.transaction.count({ where: whereBoth });
            expect(afterA).toBe(beforeA);
            expect(afterB).toBe(beforeB);
            expect(afterCount).toBe(beforeCount);
            await assertInvariant(a.id, 'account A after rollback');
            await assertInvariant(b.id, 'account B after rollback');
          } finally {
            await dropAccounts([a.id, b.id]);
          }
        },
      ),
      { numRuns: 15 },
    );
  }, 120_000);

  it('holds when every transaction is deleted — balance returns to the opening', async () => {
    await fc.assert(
      fc.asyncProperty(
        centsArb,
        fc.array(centsArb, { minLength: 1, maxLength: 5 }),
        async (open, amounts) => {
          const opening = open / 100;
          const [a, b] = await makeAccounts(opening, 0);

          try {
            const ids: string[] = [];
            for (const cents of amounts) {
              const tx = await ledgerCreate({
                type: 'EXPENSE',
                name: '__inv_drain',
                amount: cents / 100,
                date: new Date(Date.UTC(2026, 6, 9)),
                accountId: a.id,
              });
              ids.push(tx.id);
            }

            for (const id of ids) await ledgerDelete(id);

            const after = await prisma.account.findUniqueOrThrow({ where: { id: a.id } });
            expect(Number(after.balance)).toBe(opening);
            await assertInvariant(a.id, 'drained account');
          } finally {
            await dropAccounts([a.id, b.id]);
          }
        },
      ),
      { numRuns: 10 },
    );
  }, 120_000);
});
