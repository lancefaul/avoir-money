/**
 * POST /purchases — the create-group path.
 *
 * The property that matters: a split writes one balance-visible leg per account
 * (so each account moves by exactly its share and still reconciles) plus a
 * balance-neutral Anchor that carries the budget and touches no balance. Account
 * and budget stay independent — the legs carry the system Payment allocation,
 * never the purchase's budget.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '@budget-tracker/db';
import { get, post, put, del } from '../test/helpers.js';
import { ledgerCreate } from '../lib/lifecycle/index.js';
import { NOT_PAYMENT_LEG } from '../lib/purchase-group.js';

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    await prisma.$connect();
  }
});

let n = 0;
async function makeAccount(balance: number): Promise<{ id: string }> {
  return prisma.account.create({
    data: {
      name: `__purch_${Date.now()}_${++n}`,
      type: 'CHECKING',
      balance,
      openingBalance: balance,
    },
    select: { id: true },
  });
}

async function makeBudget(name: string, isSystem = false): Promise<{ id: string }> {
  const group = await prisma.budgetGroup.create({ data: { name: `G_${++n}`, color: 'fern50' } });
  return prisma.budget.create({
    data: { name, groupId: group.id, isSystem },
    select: { id: true },
  });
}

const balanceOf = async (id: string): Promise<number> =>
  Number((await prisma.account.findUniqueOrThrow({ where: { id } })).balance);

interface Result {
  purchaseGroupId: string | null;
  transactionIds: string[];
}

describe('POST /purchases', () => {
  it('single payment creates one ordinary transaction, no group', async () => {
    const account = await makeAccount(100);
    const budget = await makeBudget('Food');

    const res = await post('/purchases', {
      name: 'Coffee',
      date: '2026-07-25',
      amount: 5,
      budgetId: budget.id,
      payments: [{ accountId: account.id, amount: 5 }],
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Result;
    expect(body.purchaseGroupId).toBeNull();
    expect(body.transactionIds).toHaveLength(1);

    const tx = await prisma.transaction.findUniqueOrThrow({
      where: { id: body.transactionIds[0]! },
    });
    expect(tx.accountId).toBe(account.id);
    expect(tx.purchaseGroupId).toBeNull();
    expect(Number(tx.amount)).toBe(5);
    expect(await balanceOf(account.id)).toBe(95);
  });

  it('multi-account split creates an Anchor + legs; each account moves by its leg', async () => {
    const card = await makeAccount(0);
    const gift = await makeAccount(50);
    const budget = await makeBudget('Groceries');
    const payment = await makeBudget('Payment', true);

    const res = await post('/purchases', {
      name: 'Groceries',
      date: '2026-07-25',
      amount: 100,
      budgetId: budget.id,
      payments: [
        { accountId: card.id, amount: 60 },
        { accountId: gift.id, amount: 40 },
      ],
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Result;
    expect(body.purchaseGroupId).not.toBeNull();
    expect(body.transactionIds).toHaveLength(3); // anchor + 2 legs

    const rows = await prisma.transaction.findMany({
      where: { purchaseGroupId: body.purchaseGroupId },
    });
    expect(rows).toHaveLength(3);

    // The Anchor: no account (balance-neutral), the total, the purchase's budget.
    const anchor = rows.find((r) => r.accountId === null);
    expect(anchor).toBeDefined();
    expect(Number(anchor!.amount)).toBe(100);
    expect(anchor!.budgetId).toBe(budget.id);

    // The legs: each on its account, carrying Payment — NOT the purchase budget.
    const legs = rows.filter((r) => r.accountId !== null);
    expect(legs).toHaveLength(2);
    expect(legs.every((l) => l.budgetId === payment.id)).toBe(true);
    expect(legs.every((l) => l.purchaseGroupId === body.purchaseGroupId)).toBe(true);

    // Each account moved by exactly its leg; the Anchor moved nothing.
    expect(await balanceOf(card.id)).toBe(-60);
    expect(await balanceOf(gift.id)).toBe(10); // 50 − 40

    // openingBalance + SUM(tx) == balance holds for both funding accounts.
    for (const acct of [card, gift]) {
      const a = await prisma.account.findUniqueOrThrow({ where: { id: acct.id } });
      const txs = await prisma.transaction.findMany({
        where: { accountId: acct.id, parentId: null },
        select: { netAmount: true },
      });
      const sum = txs.reduce((s, t) => s - Number(t.netAmount), 0); // all EXPENSE legs
      expect(Number(a.openingBalance) + sum).toBeCloseTo(Number(a.balance), 2);
    }
  });

  it('an unfiltered spend sum counts a split once (Anchor), excluding the legs', async () => {
    const card = await makeAccount(0);
    const gift = await makeAccount(0);

    // A split: Anchor (100) + legs (60, 40).
    await post('/purchases', {
      name: 'Split',
      date: '2026-07-25',
      amount: 100,
      payments: [
        { accountId: card.id, amount: 60 },
        { accountId: gift.id, amount: 40 },
      ],
    });
    // Plus an ordinary expense.
    await ledgerCreate({
      type: 'EXPENSE',
      name: 'Plain',
      amount: 5,
      date: new Date(Date.UTC(2026, 6, 25)),
      accountId: card.id,
    });

    // NOT_PAYMENT_LEG is what a by-neither-account-nor-budget sum must use.
    const counted = await prisma.transaction.findMany({
      where: { type: 'EXPENSE', ...NOT_PAYMENT_LEG },
      select: { amount: true, accountId: true, purchaseGroupId: true },
    });
    const total = counted.reduce((s, t) => s + Number(t.amount), 0);
    // Anchor (100) + plain (5) = 105 — not 100 + 60 + 40 + 5 = 205.
    expect(total).toBe(105);
    // No payment leg slipped through.
    expect(counted.some((t) => t.purchaseGroupId !== null && t.accountId !== null)).toBe(false);
  });

  it('GET /transactions counts a split once unfiltered, and counts the leg per-account', async () => {
    const card = await makeAccount(0);
    const gift = await makeAccount(0);

    // Split: Anchor (100) + legs (card 60, gift 40).
    await post('/purchases', {
      name: 'Split Totals',
      date: '2026-07-25',
      amount: 100,
      payments: [
        { accountId: card.id, amount: 60 },
        { accountId: gift.id, amount: 40 },
      ],
    });
    // Plus an ordinary expense on the card.
    await ledgerCreate({
      type: 'EXPENSE',
      name: 'Plain',
      amount: 5,
      date: new Date(Date.UTC(2026, 6, 25)),
      accountId: card.id,
    });

    // Unfiltered: the split counts once (via its Anchor), not once per leg. Before
    // the fix these were 205 / 4 — the Anchor and both legs all summed.
    const all = (await (await get('/transactions?skipGenerate=true')).json()) as {
      totalSpent: number;
      totalCount: number;
    };
    // Anchor (100) + plain (5) = 105, not 100 + 60 + 40 + 5 = 205.
    expect(all.totalSpent).toBe(105);
    // Anchor + plain = 2 rows; the two legs are excluded.
    expect(all.totalCount).toBe(2);

    // Account-filtered: the null-account Anchor is absent, and the card's leg is a
    // real spend on that account, so it IS counted (no leg filter applied here).
    const cardView = (await (
      await get(`/transactions?accountId=${card.id}&skipGenerate=true`)
    ).json()) as { totalSpent: number; totalCount: number };
    // Card leg (60) + plain (5) = 65.
    expect(cardView.totalSpent).toBe(65);
    expect(cardView.totalCount).toBe(2);
  });

  it('rejects a split whose legs do not sum to the net amount', async () => {
    const card = await makeAccount(0);
    const gift = await makeAccount(0);
    const res = await post('/purchases', {
      name: 'x',
      date: '2026-07-25',
      amount: 100,
      payments: [
        { accountId: card.id, amount: 60 },
        { accountId: gift.id, amount: 30 }, // 90 ≠ 100
      ],
    });
    expect(res.status).toBe(400);
  });

  it('404s when a funding account does not exist', async () => {
    const res = await post('/purchases', {
      name: 'x',
      date: '2026-07-25',
      amount: 10,
      payments: [{ accountId: 'does_not_exist', amount: 10 }],
    });
    expect(res.status).toBe(404);
  });

  it('deletes a whole group and reverses every account balance', async () => {
    const card = await makeAccount(100);
    const gift = await makeAccount(100);
    const res = await post('/purchases', {
      name: 'G',
      date: '2026-07-25',
      amount: 100,
      payments: [
        { accountId: card.id, amount: 60 },
        { accountId: gift.id, amount: 40 },
      ],
    });
    const { purchaseGroupId } = (await res.json()) as Result;
    expect(await balanceOf(card.id)).toBe(40);
    expect(await balanceOf(gift.id)).toBe(60);

    const res2 = await del(`/purchases/${purchaseGroupId}`);
    expect(res2.status).toBe(200);
    expect(await prisma.transaction.count({ where: { purchaseGroupId } })).toBe(0);
    // Every balance restored.
    expect(await balanceOf(card.id)).toBe(100);
    expect(await balanceOf(gift.id)).toBe(100);
  });

  it('re-splits the payment, reversing the old legs and applying the new', async () => {
    const card = await makeAccount(0);
    const gift = await makeAccount(0);
    const bank = await makeAccount(0);
    const res = await post('/purchases', {
      name: 'G',
      date: '2026-07-25',
      amount: 100,
      payments: [
        { accountId: card.id, amount: 60 },
        { accountId: gift.id, amount: 40 },
      ],
    });
    const { purchaseGroupId } = (await res.json()) as Result;

    // Re-split: 30 card + 70 bank (still sums to 100); gift drops out.
    const upd = await put(`/purchases/${purchaseGroupId}/payments`, {
      payments: [
        { accountId: card.id, amount: 30 },
        { accountId: bank.id, amount: 70 },
      ],
    });
    expect(upd.status).toBe(200);

    const legs = await prisma.transaction.findMany({
      where: { purchaseGroupId, accountId: { not: null } },
    });
    expect(legs).toHaveLength(2);
    expect(await balanceOf(card.id)).toBe(-30); // was -60, now -30
    expect(await balanceOf(gift.id)).toBe(0); // old -40 leg reversed
    expect(await balanceOf(bank.id)).toBe(-70);
  });

  it('re-splitting the payment leaves the Anchor budget untouched, and editing the budget leaves the legs untouched', async () => {
    const card = await makeAccount(0);
    const gift = await makeAccount(0);
    const groceries = await makeBudget('Groceries');
    const household = await makeBudget('Household');
    await makeBudget('Payment', true);
    const res = await post('/purchases', {
      name: 'G',
      date: '2026-07-25',
      amount: 100,
      budgetId: groceries.id,
      payments: [
        { accountId: card.id, amount: 60 },
        { accountId: gift.id, amount: 40 },
      ],
    });
    const { purchaseGroupId } = (await res.json()) as Result;
    const anchor = await prisma.transaction.findFirstOrThrow({
      where: { purchaseGroupId, accountId: null },
    });

    // (1) Re-split → the Anchor's budget is unchanged.
    await put(`/purchases/${purchaseGroupId}/payments`, {
      payments: [
        { accountId: card.id, amount: 25 },
        { accountId: gift.id, amount: 75 },
      ],
    });
    const anchorAfterResplit = await prisma.transaction.findUniqueOrThrow({
      where: { id: anchor.id },
    });
    expect(anchorAfterResplit.budgetId).toBe(groceries.id);

    // (2) Change the Anchor's budget via the ordinary transaction update → the legs
    // (their ids and Payment budget) are unchanged.
    const legsBefore = (
      await prisma.transaction.findMany({
        where: { purchaseGroupId, accountId: { not: null } },
        select: { id: true, budgetId: true },
      })
    )
      .map((l) => `${l.id}:${l.budgetId}`)
      .sort();

    await put(`/transactions/${anchor.id}`, { budgetId: household.id });

    const anchorAfterBudget = await prisma.transaction.findUniqueOrThrow({
      where: { id: anchor.id },
    });
    expect(anchorAfterBudget.budgetId).toBe(household.id);
    const legsAfter = (
      await prisma.transaction.findMany({
        where: { purchaseGroupId, accountId: { not: null } },
        select: { id: true, budgetId: true },
      })
    )
      .map((l) => `${l.id}:${l.budgetId}`)
      .sort();
    expect(legsAfter).toEqual(legsBefore);
  });

  it('refuses a re-split that does not sum to the net amount', async () => {
    const card = await makeAccount(0);
    const gift = await makeAccount(0);
    const res = await post('/purchases', {
      name: 'G',
      date: '2026-07-25',
      amount: 100,
      payments: [
        { accountId: card.id, amount: 60 },
        { accountId: gift.id, amount: 40 },
      ],
    });
    const { purchaseGroupId } = (await res.json()) as Result;
    const upd = await put(`/purchases/${purchaseGroupId}/payments`, {
      payments: [
        { accountId: card.id, amount: 30 },
        { accountId: gift.id, amount: 30 }, // 60 ≠ 100
      ],
    });
    expect(upd.status).toBe(400);
  });

  it('404s deleting a group that does not exist', async () => {
    const res = await del('/purchases/does_not_exist');
    expect(res.status).toBe(404);
  });

  // ─── re-split rejections: the swap must be all-or-nothing ───

  it('rejects a re-split with fewer than 2 legs, leaving the existing legs untouched', async () => {
    const card = await makeAccount(0);
    const gift = await makeAccount(0);
    const res = await post('/purchases', {
      name: 'G',
      date: '2026-07-25',
      amount: 100,
      payments: [
        { accountId: card.id, amount: 60 },
        { accountId: gift.id, amount: 40 },
      ],
    });
    const { purchaseGroupId } = (await res.json()) as Result;

    const legIdsBefore = (
      await prisma.transaction.findMany({
        where: { purchaseGroupId, accountId: { not: null } },
        select: { id: true },
      })
    )
      .map((l) => l.id)
      .sort();

    // Collapsing a group to one payment is a delete-then-create, not an edit —
    // the schema's .min(2) forbids it.
    const upd = await put(`/purchases/${purchaseGroupId}/payments`, {
      payments: [{ accountId: card.id, amount: 100 }],
    });
    expect(upd.status).toBe(400);

    // A rejected re-split must not have touched the ledger: same leg rows (read
    // back by id), same balances. This is the "no account left counting a
    // removed leg" guarantee for the validation-failure path.
    const legIdsAfter = (
      await prisma.transaction.findMany({
        where: { purchaseGroupId, accountId: { not: null } },
        select: { id: true },
      })
    )
      .map((l) => l.id)
      .sort();
    expect(legIdsAfter).toEqual(legIdsBefore);
    expect(await balanceOf(card.id)).toBe(-60);
    expect(await balanceOf(gift.id)).toBe(-40);
  });

  it('rejects a re-split that funds the same account twice', async () => {
    const card = await makeAccount(0);
    const gift = await makeAccount(0);
    const res = await post('/purchases', {
      name: 'G',
      date: '2026-07-25',
      amount: 100,
      payments: [
        { accountId: card.id, amount: 60 },
        { accountId: gift.id, amount: 40 },
      ],
    });
    const { purchaseGroupId } = (await res.json()) as Result;
    const upd = await put(`/purchases/${purchaseGroupId}/payments`, {
      payments: [
        { accountId: card.id, amount: 50 },
        { accountId: card.id, amount: 50 }, // same account twice
      ],
    });
    expect(upd.status).toBe(400);
  });

  it('404s re-splitting a group that does not exist', async () => {
    const card = await makeAccount(0);
    const gift = await makeAccount(0);
    const upd = await put('/purchases/does_not_exist/payments', {
      payments: [
        { accountId: card.id, amount: 50 },
        { accountId: gift.id, amount: 50 },
      ],
    });
    expect(upd.status).toBe(404);
  });

  it('404s a re-split whose new funding account does not exist, without mutating', async () => {
    const card = await makeAccount(0);
    const gift = await makeAccount(0);
    const res = await post('/purchases', {
      name: 'G',
      date: '2026-07-25',
      amount: 100,
      payments: [
        { accountId: card.id, amount: 60 },
        { accountId: gift.id, amount: 40 },
      ],
    });
    const { purchaseGroupId } = (await res.json()) as Result;
    const upd = await put(`/purchases/${purchaseGroupId}/payments`, {
      payments: [
        { accountId: card.id, amount: 50 },
        { accountId: 'does_not_exist', amount: 50 },
      ],
    });
    expect(upd.status).toBe(404);
    // Rejected before the atomic swap: original legs and balances intact.
    expect(await balanceOf(card.id)).toBe(-60);
    expect(await balanceOf(gift.id)).toBe(-40);
  });

  it('re-split removes the old leg rows and persists exactly the new legs', async () => {
    const card = await makeAccount(0);
    const gift = await makeAccount(0);
    const bank = await makeAccount(0);
    const res = await post('/purchases', {
      name: 'G',
      date: '2026-07-25',
      amount: 100,
      payments: [
        { accountId: card.id, amount: 60 },
        { accountId: gift.id, amount: 40 },
      ],
    });
    const { purchaseGroupId } = (await res.json()) as Result;
    const oldLegIds = (
      await prisma.transaction.findMany({
        where: { purchaseGroupId, accountId: { not: null } },
        select: { id: true },
      })
    ).map((l) => l.id);

    const upd = await put(`/purchases/${purchaseGroupId}/payments`, {
      payments: [
        { accountId: card.id, amount: 30 },
        { accountId: bank.id, amount: 70 },
      ],
    });
    expect(upd.status).toBe(200);

    // The old leg rows are gone from the DB — an atomic swap, not an in-place edit.
    const survivingOld = await prisma.transaction.count({ where: { id: { in: oldLegIds } } });
    expect(survivingOld).toBe(0);

    // Exactly the new legs remain, on the new accounts, summing to the net amount.
    const legs = await prisma.transaction.findMany({
      where: { purchaseGroupId, accountId: { not: null } },
      select: { accountId: true, netAmount: true },
    });
    const byAccount = Object.fromEntries(legs.map((l) => [l.accountId, Number(l.netAmount)]));
    expect(byAccount).toEqual({ [card.id]: 30, [bank.id]: 70 });
    expect(await balanceOf(gift.id)).toBe(0); // dropped-out account fully reversed
  });

  // ─── create rejections ───

  it('rejects a split that funds the same account twice', async () => {
    const card = await makeAccount(0);
    const res = await post('/purchases', {
      name: 'x',
      date: '2026-07-25',
      amount: 100,
      payments: [
        { accountId: card.id, amount: 60 },
        { accountId: card.id, amount: 40 }, // same account twice
      ],
    });
    expect(res.status).toBe(400);
  });
});
