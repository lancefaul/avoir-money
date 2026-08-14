/**
 * Cross-field rules on the UPDATE path.
 *
 * They lived only in `CreateTransactionSchema`'s `superRefine`, and
 * `UpdateTransactionSchema` is a `.partial()` carrying no refinement — so every
 * one of them was enforced on create and silently skipped on update. An update
 * could strip a TRADE's funding account or mark an EXPENSE as cash back. None
 * of it was reachable from the UI, because the form clears each field on type
 * change, which is exactly why it went unnoticed.
 *
 * The rules are now one shared function evaluated by both paths, against the
 * FINAL state: the stored row merged with the incoming changes. That merge is
 * the whole design — a partial update may not send `type` at all, and refining
 * the partial directly would evaluate every rule against `undefined` and pass
 * everything.
 */
import { describe, it, expect } from 'vitest';
import { prisma } from '@budget-tracker/db';
import {
  get,
  post,
  put,
  createGroup,
  createCategory,
  createAccount,
  createCustodian,
} from '../test/helpers.js';

async function setup() {
  const group = await createGroup();
  const cat = await createCategory(group.id);
  const acct = await createAccount('Crossfield Checking');
  return { cat, acct };
}

async function makeTrade(acctId: string, custodianId: string) {
  const res = await post('/transactions', {
    type: 'TRADE',
    name: 'Buy AAPL',
    amount: 100,
    date: '2026-08-08',
    accountId: acctId,
    tradeMetadata: {
      direction: 'BUY',
      assetType: 'Stock',
      ticker: 'AAPL',
      unitPrice: 100,
      quantity: 1,
      custodianId,
    },
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string };
}

async function makeIncome(acctId: string) {
  const res = await post('/transactions', {
    type: 'INCOME',
    name: 'Cash back',
    amount: 25,
    date: '2026-08-08',
    accountId: acctId,
    isCashBack: true,
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string };
}

describe('cross-field rules are enforced on update', () => {
  it('refuses to strip a TRADE of its funding account', async () => {
    // The headline case. The funding-account rule exists because NULL-account
    // trades already slipped in once — cash that was never debited — and an
    // update could put them straight back.
    const { acct } = await setup();
    const cust = await createCustodian();
    const trade = await makeTrade(acct.id, cust.id);

    const res = await put(`/transactions/${trade.id}`, { accountId: null });

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/funding account/i);

    // And the stored row is untouched, not half-applied.
    const row = await prisma.transaction.findUniqueOrThrow({ where: { id: trade.id } });
    expect(row.accountId).toBe(acct.id);
  });

  it('refuses to mark an EXPENSE as cash back', async () => {
    const { acct } = await setup();
    const created = (await (
      await post('/transactions', {
        type: 'EXPENSE',
        name: 'Groceries',
        amount: 60,
        date: '2026-08-08',
        accountId: acct.id,
      })
    ).json()) as { id: string };

    const res = await put(`/transactions/${created.id}`, { isCashBack: true });

    expect(res.status).toBe(400);
    const row = await prisma.transaction.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.isCashBack).toBe(false);
  });

  it('refuses to retype a cash-back INCOME into an EXPENSE, leaving the flag stranded', async () => {
    // The subtle direction: the flag is untouched by the request, and the type
    // change alone is what makes it meaningless. Only merging stored state with
    // the change catches this — the body on its own looks innocuous.
    const { acct } = await setup();
    const income = await makeIncome(acct.id);

    const res = await put(`/transactions/${income.id}`, { type: 'EXPENSE' });

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/cash back/i);
  });

  it('refuses to retype a TRADE into an EXPENSE, leaving its trade metadata stranded', async () => {
    // Same shape: the stored tradeDetail is what makes the new type invalid,
    // and it is never mentioned in the request.
    const { acct } = await setup();
    const cust = await createCustodian();
    const trade = await makeTrade(acct.id, cust.id);

    const res = await put(`/transactions/${trade.id}`, { type: 'EXPENSE' });

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/trade metadata/i);
  });

  it('still allows an ordinary edit that breaks no rule', async () => {
    // The rules must not make normal updates fail. A rename touches none of the
    // cross-field state and has to keep working.
    const { acct } = await setup();
    const cust = await createCustodian();
    const trade = await makeTrade(acct.id, cust.id);

    const res = await put(`/transactions/${trade.id}`, { name: 'Buy AAPL (renamed)' });

    expect(res.status).toBe(200);
    const row = await prisma.transaction.findUniqueOrThrow({ where: { id: trade.id } });
    expect(row.name).toBe('Buy AAPL (renamed)');
    // Unchanged fields survive the merge rather than being read as absent.
    expect(row.accountId).toBe(acct.id);
  });

  it('allows moving a TRADE between funding accounts', async () => {
    // `accountId` present and truthy is fine; only stripping it is refused.
    const { acct } = await setup();
    const other = await createAccount('Crossfield Savings');
    const cust = await createCustodian();
    const trade = await makeTrade(acct.id, cust.id);

    const res = await put(`/transactions/${trade.id}`, { accountId: other.id });

    expect(res.status).toBe(200);
    const row = await prisma.transaction.findUniqueOrThrow({ where: { id: trade.id } });
    expect(row.accountId).toBe(other.id);
  });

  it('reports the offending field, not just a message', async () => {
    const { acct } = await setup();
    const cust = await createCustodian();
    const trade = await makeTrade(acct.id, cust.id);

    const res = await put(`/transactions/${trade.id}`, { accountId: null });
    const body = (await res.json()) as { details?: Array<{ field: string }> };

    expect(body.details?.map((d) => d.field)).toContain('accountId');
  });

  it('leaves the list endpoint working after a refused update', async () => {
    // A rejected update must not leave the row in a state the reader chokes on.
    const { acct } = await setup();
    const cust = await createCustodian();
    const trade = await makeTrade(acct.id, cust.id);
    await put(`/transactions/${trade.id}`, { accountId: null });

    expect((await get('/transactions')).status).toBe(200);
  });
});
