/**
 * Integration tests for the rewards-as-child-account model (Rewards Phase 2a).
 *
 * A rewards account is an ordinary ledger account (type "Rewards") nested under a
 * card via parentAccountId. It is created through POST /accounts/:id/rewards-account
 * (never the generic create, which would orphan it). Earning is an INCOME row on
 * it; redeeming is a payment leg (an EXPENSE) funded from it — both flow through
 * the ledger gate, so the account's balance tracks openingBalance + SUM(tx) with
 * no bespoke rewards machinery.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '@budget-tracker/db';
import { post, del } from '../test/helpers.js';
import { ledgerCreate } from '../lib/lifecycle/index.js';

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    await prisma.$connect();
  }
});

const utc = (d: number) => new Date(Date.UTC(2026, 6, d));

async function makeCard(name = `__card_${Date.now()}_${Math.random()}`) {
  const res = await post('/accounts', { name, type: 'Credit Card' });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; name: string };
}

describe('POST /accounts/:id/rewards-account', () => {
  it('creates a Rewards account nested under the card, carrying the opening balance', async () => {
    const card = await makeCard();
    const res = await post(`/accounts/${card.id}/rewards-account`, { openingBalance: 27.91 });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;

    expect(body.type).toBe('Rewards');
    expect(body.parentAccountId).toBe(card.id);
    expect(body.name).toBe(`${card.name} Rewards`);
    expect(body.openingBalance).toBeCloseTo(27.91, 2);
    // No transactions yet, so balance == openingBalance.
    expect(body.balance).toBeCloseTo(27.91, 2);

    // Verify the write landed in the database.
    const row = await prisma.account.findUniqueOrThrow({ where: { id: body.id as string } });
    expect(row.type).toBe('Rewards');
    expect(row.parentAccountId).toBe(card.id);
    expect(row.openingBalance.toNumber()).toBeCloseTo(27.91, 2);
  });

  it('accepts a custom name and defaults the opening balance to 0', async () => {
    const card = await makeCard();
    const res = await post(`/accounts/${card.id}/rewards-account`, { name: 'Prime Points' });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.name).toBe('Prime Points');
    expect(body.openingBalance).toBeCloseTo(0, 2);
    expect(body.balance).toBeCloseTo(0, 2);
  });

  it('rejects a second rewards account for the same card (409)', async () => {
    const card = await makeCard();
    const first = await post(`/accounts/${card.id}/rewards-account`, {});
    expect(first.status).toBe(201);
    const second = await post(`/accounts/${card.id}/rewards-account`, {});
    expect(second.status).toBe(409);
  });

  it('returns 404 when the parent card does not exist', async () => {
    const res = await post('/accounts/nonexistent-id/rewards-account', {});
    expect(res.status).toBe(404);
  });

  it('refuses to nest a rewards account under another rewards account (400)', async () => {
    const card = await makeCard();
    const rewardsRes = await post(`/accounts/${card.id}/rewards-account`, {});
    const rewards = (await rewardsRes.json()) as { id: string };
    const res = await post(`/accounts/${rewards.id}/rewards-account`, {});
    expect(res.status).toBe(400);
  });

  it('blocks creating a Rewards account through the generic endpoint (400)', async () => {
    const res = await post('/accounts', { name: `__orphan_${Date.now()}`, type: 'Rewards' });
    expect(res.status).toBe(400);
  });
});

describe('rewards account behaves as an ordinary ledger account', () => {
  it('earn (INCOME) raises the balance and redeem (EXPENSE leg) lowers it', async () => {
    const card = await makeCard();
    const res = await post(`/accounts/${card.id}/rewards-account`, { openingBalance: 27.91 });
    const rewards = (await res.json()) as { id: string };

    // Earn: an INCOME row credits the rewards account.
    await ledgerCreate({
      type: 'INCOME',
      name: 'Rewards earned',
      amount: 10,
      date: utc(2),
      accountId: rewards.id,
      imported: false,
    });
    let row = await prisma.account.findUniqueOrThrow({ where: { id: rewards.id } });
    expect(row.balance.toNumber()).toBeCloseTo(37.91, 2);

    // Redeem: a leg (EXPENSE) funded from the rewards account debits it.
    await ledgerCreate({
      type: 'EXPENSE',
      name: 'Redeemed toward purchase',
      amount: 5,
      date: utc(3),
      accountId: rewards.id,
      imported: false,
    });
    row = await prisma.account.findUniqueOrThrow({ where: { id: rewards.id } });
    expect(row.balance.toNumber()).toBeCloseTo(32.91, 2);

    // Ledger invariant: openingBalance + signed sum of tx (INCOME +10, EXPENSE -5)
    // == balance. Confirms the running total came from the ledger, not a seed.
    expect(row.openingBalance.toNumber() + (10 - 5)).toBeCloseTo(row.balance.toNumber(), 2);
  });
});

describe('DELETE /accounts/:id with a rewards child account', () => {
  it('deletes a rewards-enabled card even after rewards were earned and redeemed', async () => {
    const card = await makeCard();
    const res = await post(`/accounts/${card.id}/rewards-account`, { openingBalance: 5 });
    const rewards = (await res.json()) as { id: string };

    // Earn + redeem — these rows reference the rewards child via
    // Transaction.accountId (onDelete: Restrict). The card is the child's parent
    // (CardRewards, onDelete: Cascade), so deleting the card cascade-deletes the
    // child; before the fix, the child's own rows blocked that cascade with an FK
    // violation that surfaced as a 500. The delete now clears them first.
    await ledgerCreate({
      type: 'INCOME',
      name: 'Rewards earned',
      amount: 10,
      date: utc(2),
      accountId: rewards.id,
      imported: false,
    });
    await ledgerCreate({
      type: 'EXPENSE',
      name: 'Redeemed toward purchase',
      amount: 4,
      date: utc(3),
      accountId: rewards.id,
      imported: false,
    });

    const delRes = await del(`/accounts/${card.id}`);
    expect(delRes.status).toBe(204);

    // Card gone, rewards child gone (cascade), and the child's own transactions
    // gone (cleared before the cascade so Restrict never fires).
    expect(await prisma.account.findUnique({ where: { id: card.id } })).toBeNull();
    expect(await prisma.account.findUnique({ where: { id: rewards.id } })).toBeNull();
    expect(await prisma.transaction.count({ where: { accountId: rewards.id } })).toBe(0);
  });
});
