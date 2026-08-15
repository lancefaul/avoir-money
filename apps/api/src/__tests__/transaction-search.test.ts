/**
 * Searching by the figure on the statement.
 *
 * Anyone reconciling works from the bank's numbers, and on a rewards card the
 * bank's number is the NET: a $40.00 basket with $15.00 of rewards is charged
 * $25.00. Searching `amount` alone found nothing for $25.00, so the transaction
 * that produced the charge was unreachable from the only figure the user had.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '@budget-tracker/db';
import { get } from '../test/helpers.js';
import { ledgerCreate } from '../lib/lifecycle/index.js';

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    await prisma.$connect();
  }
});

let n = 0;
const makeAccount = () =>
  prisma.account.create({
    data: { name: `__search_${Date.now()}_${++n}`, type: 'CREDIT_CARD', balance: 0 },
  });

async function seed() {
  const account = await makeAccount();
  // Paid in full — gross and net agree.
  const plain = await ledgerCreate({
    accountId: account.id,
    date: new Date(Date.UTC(2026, 1, 13)),
    name: 'Amazon Plain',
    amount: 25.0,
    type: 'EXPENSE',
  });
  // A row whose charged figure (netAmount 25.00) differs from its sticker
  // (amount 40.00) — e.g. a pre-retirement rewards purchase. Built directly
  // since the rewardsApplied input that produced this divergence is retired; the
  // search must still reach such a row from the bank's net figure.
  const rewarded = await prisma.transaction.create({
    data: {
      accountId: account.id,
      date: new Date(Date.UTC(2026, 1, 13)),
      name: 'Amazon Rewarded',
      amount: 40.0,
      netAmount: 25.0,
      type: 'EXPENSE',
    },
  });
  return { account, plain, rewarded };
}

describe('searching a transaction by amount', () => {
  it('finds a row by what the bank charged, not only what it cost', async () => {
    const { account, rewarded } = await seed();
    const res = await get(`/transactions?accountId=${account.id}&search=25.00`);
    const body = (await res.json()) as { transactions: { id: string }[] };

    expect(res.status).toBe(200);
    expect(body.transactions.map((t) => t.id)).toContain(rewarded.id);
  });

  it('still finds a row by its purchase price', async () => {
    const { account, rewarded } = await seed();
    const res = await get(`/transactions?accountId=${account.id}&search=40.00`);
    const body = (await res.json()) as { transactions: { id: string }[] };
    expect(body.transactions.map((t) => t.id)).toContain(rewarded.id);
  });

  it('returns both rows that reach the same charge by different routes', async () => {
    // The pair that started this: one paid in full at 25.00, one netting to
    // 25.00 after rewards. Searching the bank's figure must surface both.
    const { account, plain, rewarded } = await seed();
    const res = await get(`/transactions?accountId=${account.id}&search=25.00`);
    const body = (await res.json()) as { transactions: { id: string }[] };
    const ids = body.transactions.map((t) => t.id);

    expect(ids).toContain(plain.id);
    expect(ids).toContain(rewarded.id);
  });

  it('keeps the whole-number range behaviour', async () => {
    // "25" finds 25.00–25.99 on either figure, not an exact match.
    const { account, plain } = await seed();
    const res = await get(`/transactions?accountId=${account.id}&search=25`);
    const body = (await res.json()) as { transactions: { id: string }[] };
    expect(body.transactions.map((t) => t.id)).toContain(plain.id);
  });
});
