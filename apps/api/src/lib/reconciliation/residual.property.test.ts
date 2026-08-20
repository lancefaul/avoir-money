/**
 * Property-based tests for residual arithmetic.
 *
 * The residual is what the whole reconciliation design rests on: a session may
 * not close while it is non-zero, and that rule is the mechanism that forces a
 * transaction correction to be paired with the opening correction that was
 * compensating for it. If the arithmetic drifts, the guarantee is worthless.
 *
 * Amounts are generated as integer cents so every input is exactly representable
 * at 2dp; dates are fixed UTC midnights rather than `fc.date()`, per QUALITY.md.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fc from 'fast-check';
import { prisma } from '@budget-tracker/db';
import { ledgerCreate } from '../lifecycle/index.js';
import { computeResidual, transactionSumThrough, RESIDUAL_EPSILON } from './residual.js';

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    await prisma.$connect();
  }
});

const PERIOD_START = new Date(Date.UTC(2026, 5, 1));
const PERIOD_END = new Date(Date.UTC(2026, 5, 30));
const utc = (d: number) => new Date(Date.UTC(2026, 5, d));

/** Integer cents → dollars, so no generated amount carries float noise. */
const centsArb = fc.integer({ min: 1, max: 500_000 });

async function makeSession(openingBalance: number, anchor: number) {
  const account = await prisma.account.create({
    data: {
      name: `__res_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'CHECKING',
      balance: openingBalance,
      openingBalance,
    },
  });
  const session = await prisma.reconciliationSession.create({
    data: {
      accountId: account.id,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      statementEndingBalance: anchor,
    },
  });
  return { account, session };
}

async function cleanup(accountId: string) {
  await prisma.reconciliationSession.deleteMany({ where: { accountId } });
  await prisma.transaction.deleteMany({
    where: { OR: [{ accountId }, { toAccountId: accountId }] },
  });
  await prisma.account.deleteMany({ where: { id: accountId } });
}

describe('residual is zero exactly when the anchor equals the expected balance', () => {
  it('holds for an arbitrary opening and set of expenses', async () => {
    await fc.assert(
      fc.asyncProperty(centsArb, fc.array(centsArb, { maxLength: 6 }), async (open, amounts) => {
        const opening = open / 100;
        // Anchor set to exactly what the app will believe.
        const spend = amounts.reduce((s, c) => s + c, 0) / 100;
        const anchor = Math.round((opening - spend) * 100) / 100;
        const { account, session } = await makeSession(opening, anchor);

        try {
          for (const c of amounts) {
            await ledgerCreate({
              type: 'EXPENSE',
              name: '__res_expense',
              amount: c / 100,
              date: utc(10),
              accountId: account.id,
            });
          }

          const r = await computeResidual(session.id);
          expect(r).not.toBeNull();
          expect(r!.residual).toBe(0);
          expect(r!.isBalanced).toBe(true);
        } finally {
          await cleanup(account.id);
        }
      }),
      { numRuns: 15 },
    );
  }, 120_000);
});

describe('a correction of Δ moves the residual by exactly Δ', () => {
  it('holds when a transaction amount is edited', async () => {
    await fc.assert(
      fc.asyncProperty(centsArb, centsArb, centsArb, async (open, before, after) => {
        const opening = open / 100;
        const { account, session } = await makeSession(opening, opening);

        try {
          const tx = await ledgerCreate({
            type: 'EXPENSE',
            name: '__res_edit',
            amount: before / 100,
            date: utc(12),
            accountId: account.id,
          });

          const first = await computeResidual(session.id);

          // Reducing an expense by Δ raises the transaction sum by Δ, which
          // lowers the residual by Δ.
          const delta = Math.round(((before - after) / 100) * 100) / 100;
          await prisma.transaction.update({
            where: { id: tx.id },
            data: { amount: after / 100, netAmount: after / 100 },
          });

          const second = await computeResidual(session.id);
          expect(second!.residual).toBeCloseTo(
            Math.round((first!.residual - delta) * 100) / 100,
            2,
          );
        } finally {
          await cleanup(account.id);
        }
      }),
      { numRuns: 15 },
    );
  }, 120_000);

  it('holds when the opening balance is adjusted', async () => {
    await fc.assert(
      fc.asyncProperty(centsArb, centsArb, async (open, shift) => {
        const opening = open / 100;
        const { account, session } = await makeSession(opening, opening);

        try {
          const first = await computeResidual(session.id);

          // Raising the opening by Δ raises the expected balance by Δ, which
          // lowers the residual by Δ. This is the pairing the close rule forces.
          const delta = shift / 100;
          await prisma.account.update({
            where: { id: account.id },
            data: { openingBalance: Math.round((opening + delta) * 100) / 100 },
          });

          const second = await computeResidual(session.id);
          expect(second!.residual).toBeCloseTo(
            Math.round((first!.residual - delta) * 100) / 100,
            2,
          );
        } finally {
          await cleanup(account.id);
        }
      }),
      { numRuns: 15 },
    );
  }, 120_000);
});

describe('monetary safety', () => {
  it('always returns figures rounded to cents', async () => {
    await fc.assert(
      fc.asyncProperty(
        centsArb,
        centsArb,
        fc.array(centsArb, { maxLength: 5 }),
        async (open, anchor, amounts) => {
          const { account, session } = await makeSession(open / 100, anchor / 100);

          try {
            for (const c of amounts) {
              await ledgerCreate({
                type: 'EXPENSE',
                name: '__res_round',
                amount: c / 100,
                date: utc(9),
                accountId: account.id,
              });
            }

            const r = await computeResidual(session.id);
            for (const v of [
              r!.openingBalance,
              r!.transactionSum,
              r!.expectedBalance,
              r!.statementEndingBalance,
              r!.residual,
            ]) {
              expect(Number.isFinite(v)).toBe(true);
              expect(Math.round(v * 100) / 100).toBe(v);
            }
          } finally {
            await cleanup(account.id);
          }
        },
      ),
      { numRuns: 12 },
    );
  }, 120_000);
});

describe('period boundary', () => {
  it('excludes transactions dated after the period end', async () => {
    const { account, session } = await makeSession(1000, 1000);
    try {
      // Inside the period.
      await ledgerCreate({
        type: 'EXPENSE',
        name: '__res_inside',
        amount: 100,
        date: utc(15),
        accountId: account.id,
      });
      // After the period end — must not count toward this statement.
      await ledgerCreate({
        type: 'EXPENSE',
        name: '__res_after',
        amount: 250,
        date: new Date(Date.UTC(2026, 6, 5)),
        accountId: account.id,
      });

      const r = await computeResidual(session.id);
      expect(r!.transactionSum).toBe(-100);
      expect(r!.expectedBalance).toBe(900);
      expect(r!.residual).toBe(100); // anchor 1000 − expected 900
      // Reported separately so the screen can explain the gap, and NEVER
      // folded into the residual — see the next test.
      expect(r!.activityAfterPeriodEnd).toBe(-250);
    } finally {
      await cleanup(account.id);
    }
  });

  /**
   * The Prime Visa case, 2026-07-20: a statement exported through the 17th
   * against an ending balance read on the 20th. The nineteen rows in between
   * summed to exactly the difference the screen was calling "unexplained".
   *
   * Reporting the tail is the fix. Subtracting it would NOT be: an error inside
   * the period could then be cancelled by an equal and opposite one outside it,
   * and both would disappear from the only number that is supposed to catch
   * them. That is the silent absorption that hid a reversed a four-figure payment
   * for four months.
   */
  it('reports later activity without letting it reduce the residual', async () => {
    const { account, session } = await makeSession(0, -1811.4);
    try {
      await ledgerCreate({
        type: 'EXPENSE',
        name: '__res_in_period',
        amount: 1327.5,
        date: utc(15),
        accountId: account.id,
      });
      await ledgerCreate({
        type: 'EXPENSE',
        name: '__res_after_period',
        amount: 483.9,
        date: new Date(Date.UTC(2026, 6, 5)),
        accountId: account.id,
      });

      const r = await computeResidual(session.id);
      expect(r!.expectedBalance).toBe(-1327.5);
      expect(r!.activityAfterPeriodEnd).toBe(-483.9);
      // The anchor is a LATER balance than the period covers, so the residual
      // stands at exactly the later activity — and stays there.
      expect(r!.residual).toBe(-483.9);
      expect(r!.isBalanced).toBe(false);
    } finally {
      await cleanup(account.id);
    }
  });

  it('reports zero later activity when everything falls inside the period', async () => {
    const { account, session } = await makeSession(200, 150);
    try {
      await ledgerCreate({
        type: 'EXPENSE',
        name: '__res_only_inside',
        amount: 50,
        date: utc(10),
        accountId: account.id,
      });
      const r = await computeResidual(session.id);
      expect(r!.activityAfterPeriodEnd).toBe(0);
      expect(r!.isBalanced).toBe(true);
    } finally {
      await cleanup(account.id);
    }
  });

  it('includes a transaction dated exactly on the period end', async () => {
    const { account, session } = await makeSession(500, 500);
    try {
      await ledgerCreate({
        type: 'EXPENSE',
        name: '__res_boundary',
        amount: 40,
        date: PERIOD_END,
        accountId: account.id,
      });
      const r = await computeResidual(session.id);
      expect(r!.transactionSum).toBe(-40);
      // And NOT also in the tail. The two sums split the timeline at the same
      // instant, so a row on the boundary belongs to exactly one of them —
      // `<=` and `>` — or it is reported twice.
      expect(r!.activityAfterPeriodEnd).toBe(0);
    } finally {
      await cleanup(account.id);
    }
  });

  it('counts an inbound transfer toward the destination account', async () => {
    const { account, session } = await makeSession(0, 0);
    const source = await prisma.account.create({
      data: {
        name: `__res_src_${Date.now()}`,
        type: 'CHECKING',
        balance: 1000,
        openingBalance: 1000,
      },
    });
    try {
      await ledgerCreate({
        type: 'TRANSFER',
        name: '__res_transfer',
        amount: 300,
        date: utc(20),
        accountId: source.id,
        toAccountId: account.id,
      });
      const r = await computeResidual(session.id);
      expect(r!.transactionSum).toBe(300);
      expect(r!.residual).toBe(-300);
    } finally {
      await cleanup(account.id);
      await cleanup(source.id);
    }
  });
});

describe('edge cases', () => {
  it('returns null for a session that does not exist', async () => {
    expect(await computeResidual('does-not-exist')).toBeNull();
  });

  it('reports zero transaction sum for an account with no transactions', async () => {
    const { account, session } = await makeSession(250, 250);
    try {
      expect(await transactionSumThrough(account.id, PERIOD_END)).toBe(0);
      const r = await computeResidual(session.id);
      expect(r!.residual).toBe(0);
      expect(r!.isBalanced).toBe(true);
    } finally {
      await cleanup(account.id);
    }
  });

  it('treats a sub-cent difference as balanced', async () => {
    const { account, session } = await makeSession(100, 100);
    try {
      const r = await computeResidual(session.id);
      expect(Math.abs(r!.residual)).toBeLessThan(RESIDUAL_EPSILON);
      expect(r!.isBalanced).toBe(true);
    } finally {
      await cleanup(account.id);
    }
  });
});
