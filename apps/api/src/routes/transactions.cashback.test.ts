/**
 * Cash back is a rebate on spending, not money earned.
 *
 * It is a real column rather than a budget assignment because the two answer
 * different questions — a budget says which pot the money belongs to, this says
 * what kind of money it is. Budget could not carry it in any case: the
 * system-budget hook overwrites `budgetId` on every INCOME create, so the flag
 * would have had to survive a write it does not control.
 *
 * The flag is meaningful only on INCOME. Storing it elsewhere would create rows
 * nothing can interpret later, so the boundary refuses it rather than accepting
 * and ignoring it.
 */
import { describe, it, expect } from 'vitest';
import { get, post, put, createGroup, createCategory, createAccount } from '../test/helpers.js';
import { prisma } from '@budget-tracker/db';

async function setup() {
  const group = await createGroup();
  const cat = await createCategory(group.id);
  const acct = await createAccount('Cash Back Checking');
  return { cat, acct };
}

const INCOME = (acctId: string) => ({
  type: 'INCOME',
  name: 'Prime Visa cash back',
  amount: 42.17,
  date: '2026-08-08',
  accountId: acctId,
});

describe('Transaction cash back flag', () => {
  it('stores the flag on an INCOME transaction', async () => {
    const { acct } = await setup();

    const res = await post('/transactions', { ...INCOME(acct.id), isCashBack: true });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; isCashBack: boolean };
    expect(body.isCashBack).toBe(true);

    // Read back from the database — the response echoing the input proves
    // serialization, not that anything was written.
    const row = await prisma.transaction.findUniqueOrThrow({ where: { id: body.id } });
    expect(row.isCashBack).toBe(true);
  });

  it('defaults to false when the flag is not sent', async () => {
    const { acct } = await setup();

    const res = await post('/transactions', INCOME(acct.id));
    const body = (await res.json()) as { id: string; isCashBack: boolean };

    expect(body.isCashBack).toBe(false);
    const row = await prisma.transaction.findUniqueOrThrow({ where: { id: body.id } });
    expect(row.isCashBack).toBe(false);
  });

  it('refuses the flag on a non-INCOME transaction', async () => {
    const { acct } = await setup();

    const res = await post('/transactions', {
      type: 'EXPENSE',
      name: 'Groceries',
      amount: 60,
      date: '2026-08-08',
      accountId: acct.id,
      isCashBack: true,
    });

    // 400, not a silently-ignored field: accepting and dropping it would let the
    // caller believe something was recorded that never was.
    expect(res.status).toBe(400);
  });

  it('still accepts an explicit false on a non-INCOME transaction', async () => {
    const { acct } = await setup();

    // Only a TRUE flag is meaningless off INCOME. The form clears the field when
    // the type changes, so `false` arrives on every expense and must not 400.
    const res = await post('/transactions', {
      type: 'EXPENSE',
      name: 'Groceries',
      amount: 60,
      date: '2026-08-08',
      accountId: acct.id,
      isCashBack: false,
    });

    expect(res.status).toBe(201);
  });

  it('survives an unrelated edit rather than being reset', async () => {
    const { acct } = await setup();
    const created = (await (
      await post('/transactions', { ...INCOME(acct.id), isCashBack: true })
    ).json()) as { id: string };

    // The flag is not part of this update at all. A partial update that quietly
    // dropped it would silently unmark rows on any ordinary rename.
    const res = await put(`/transactions/${created.id}`, { name: 'Chase cash back' });
    expect(res.status).toBe(200);

    const row = await prisma.transaction.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.name).toBe('Chase cash back');
    expect(row.isCashBack).toBe(true);
  });

  it('can be cleared through an update', async () => {
    const { acct } = await setup();
    const created = (await (
      await post('/transactions', { ...INCOME(acct.id), isCashBack: true })
    ).json()) as { id: string };

    await put(`/transactions/${created.id}`, { isCashBack: false });

    const row = await prisma.transaction.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.isCashBack).toBe(false);
  });

  it('is carried on the list response, not just the create response', async () => {
    const { acct } = await setup();
    const created = (await (
      await post('/transactions', { ...INCOME(acct.id), isCashBack: true })
    ).json()) as { id: string };

    const body = (await (await get('/transactions')).json()) as {
      transactions: { id: string; isCashBack: boolean }[];
    };
    const found = body.transactions.find((t) => t.id === created.id);
    expect(found?.isCashBack).toBe(true);
  });
});
