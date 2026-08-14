/**
 * Integration tests for POST /reconciliations/:id/merge (reconcile-merge task 2).
 *
 * The acceptance fixture is the real Ticketmaster pair: a −$600.00 bank line
 * against two −$300.00 app rows in Recreation and Unplanned Gifts. After the
 * merge the ledger holds one −$600.00 row with two children carrying those two
 * budgets, the account balance is unchanged, and the row is matched.
 *
 * Every test reads the result back from the database.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { prisma } from '@budget-tracker/db';
import { post, get } from '../test/helpers.js';
import { createBudgetGroup, createBudget, createExpense } from '../test/helpers.js';
import * as lifecycle from '../lib/lifecycle/index.js';

const { ledgerCreate } = lifecycle;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    await prisma.$connect();
  }
});

// The global setup truncates every table in `beforeEach`; the merge endpoint
// substitutes the Uncategorized system budget for a null child budget (and would
// throw if it were missing), so recreate it fresh after each cleanup. Running
// after the global hook, this guarantees a Uncategorized budget for every test —
// which also makes the forced-failure test fail for the RIGHT reason (mid-merge),
// not because the endpoint bailed early on a missing system budget.
beforeEach(async () => {
  const existing = await prisma.budget.findFirst({
    where: { name: 'Uncategorized', isSystem: true },
  });
  if (!existing) {
    const group = await createBudgetGroup('__mrg_system');
    await prisma.budget.create({
      data: { name: 'Uncategorized', isSystem: true, groupId: group.id },
    });
  }
});

let n = 0;
async function makeAccount(balance = 0, openingBalance = balance) {
  return prisma.account.create({
    data: { name: `__mrg_${Date.now()}_${++n}`, type: 'CHECKING', balance, openingBalance },
  });
}

async function openSession(accountId: string, anchor = 0) {
  const res = await post('/reconciliations', {
    accountId,
    periodStart: '2026-02-01',
    periodEnd: '2026-02-28',
    statementEndingBalance: anchor,
  });
  return ((await res.json()) as { id: string }).id;
}

/** A statement row for the session; `amount` is the normalized (signed) figure. */
async function addStatementRow(sessionId: string, amount: number, postedDay = 8) {
  return prisma.statementRow.create({
    data: {
      sessionId,
      postedDate: new Date(Date.UTC(2026, 1, postedDay)),
      transactionDate: new Date(Date.UTC(2026, 1, postedDay - 3)),
      description: 'TM *JOURNEY',
      amount,
      rawLine: `raw-${Math.random()}`,
    },
  });
}

async function expenseOn(accountId: string, budgetId: string | null, amount: number, day = 5) {
  return ledgerCreate({
    type: 'EXPENSE',
    name: `orig-${++n}`,
    amount,
    date: new Date(Date.UTC(2026, 1, day)),
    accountId,
    ...(budgetId ? { budgetId } : {}),
  });
}

describe('POST /reconciliations/:id/merge', () => {
  it('the Ticketmaster fixture: two rows collapse to one −$600.00 row split across both budgets, no $0 category', async () => {
    const group = await createBudgetGroup();
    const recreation = await createBudget(group.id, 'Recreation');
    const gifts = await createBudget(group.id, 'Unplanned Gifts');

    const account = await makeAccount(1000);
    const a = await expenseOn(account.id, recreation.id, 419.4);
    const b = await expenseOn(account.id, gifts.id, 419.4);

    const balanceBefore = Number(
      (await prisma.account.findUniqueOrThrow({ where: { id: account.id } })).balance,
    );

    const sessionId = await openSession(account.id);
    const row = await addStatementRow(sessionId, -838.8);

    const res = await post(`/reconciliations/${sessionId}/merge`, {
      statementRowId: row.id,
      transactionIds: [a.id, b.id],
      name: 'Ticketmaster',
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { parentTransactionId: string; childCount: number };
    // One original's budget becomes the parent's own remainder; only the other
    // becomes a child — so the split is the two real budgets, never a $0 category.
    expect(body.childCount).toBe(1);

    // The parent mirrors the bank line and carries one of the two real budgets.
    const parent = await prisma.transaction.findUniqueOrThrow({
      where: { id: body.parentTransactionId },
    });
    expect(parent.type).toBe('EXPENSE');
    expect(Number(parent.amount)).toBe(838.8);
    expect(parent.date.toISOString().slice(0, 10)).toBe('2026-02-08');
    expect(parent.accountId).toBe(account.id);
    expect(parent.parentId).toBeNull();

    const children = await prisma.transaction.findMany({ where: { parentId: parent.id } });
    expect(children).toHaveLength(1);
    const child = children[0]!;
    expect(Number(child.amount)).toBe(419.4);
    expect(child.note).toContain('2026-02-05');

    // No $0 row and no Uncategorized: the parent's remainder (600.00 − 300.00 =
    // 300.00) and the child ($300.00) are exactly the two real budgets.
    const uncategorized = await prisma.budget.findFirstOrThrow({
      where: { name: 'Uncategorized', isSystem: true },
    });
    expect(parent.budgetId).not.toBe(uncategorized.id);
    expect(child.budgetId).not.toBe(uncategorized.id);
    expect(new Set([parent.budgetId, child.budgetId])).toEqual(new Set([recreation.id, gifts.id]));

    // The originals are gone, and the balance is exactly what it was.
    const survivors = await prisma.transaction.findMany({ where: { id: { in: [a.id, b.id] } } });
    expect(survivors).toHaveLength(0);
    const balanceAfter = Number(
      (await prisma.account.findUniqueOrThrow({ where: { id: account.id } })).balance,
    );
    expect(balanceAfter).toBe(balanceBefore);

    // The parent is matched to the statement row.
    const match = await prisma.reconciliationMatch.findFirst({
      where: { statementRowId: row.id, transactionId: parent.id },
    });
    expect(match).not.toBeNull();
  });

  it('re-running match after a merge succeeds (the applyDecisions re-match)', async () => {
    const group = await createBudgetGroup();
    const recreation = await createBudget(group.id, 'Recreation');
    const gifts = await createBudget(group.id, 'Unplanned Gifts');
    const account = await makeAccount(1000);
    const a = await expenseOn(account.id, recreation.id, 419.4);
    const b = await expenseOn(account.id, gifts.id, 419.4);
    const sessionId = await openSession(account.id);
    const row = await addStatementRow(sessionId, -838.8);

    const mergeRes = await post(`/reconciliations/${sessionId}/merge`, {
      statementRowId: row.id,
      transactionIds: [a.id, b.id],
      name: 'Ticketmaster',
    });
    expect(mergeRes.status).toBe(201);

    // applyDecisions runs the re-match right after a merge; it must not 500.
    const matchRes = await post(`/reconciliations/${sessionId}/match`, {});
    expect(matchRes.status).toBe(200);
  });

  it('a null-budget original lands its child in Uncategorized', async () => {
    const group = await createBudgetGroup();
    const budget = await createBudget(group.id);
    const account = await makeAccount(500);
    const a = await expenseOn(account.id, budget.id, 30);
    const b = await expenseOn(account.id, budget.id, 20);
    // Force one original to carry no budget (direct update — test-only).
    await prisma.transaction.update({ where: { id: b.id }, data: { budgetId: null } });

    const sessionId = await openSession(account.id);
    const row = await addStatementRow(sessionId, -50);
    const res = await post(`/reconciliations/${sessionId}/merge`, {
      statementRowId: row.id,
      transactionIds: [a.id, b.id],
      name: 'Merged',
    });
    expect(res.status).toBe(201);

    const uncategorized = await prisma.budget.findFirstOrThrow({
      where: { name: 'Uncategorized', isSystem: true },
    });
    const { parentTransactionId } = (await res.json()) as { parentTransactionId: string };
    const children = await prisma.transaction.findMany({
      where: { parentId: parentTransactionId },
    });
    const nullBudgetChild = children.find((ch) => Number(ch.amount) === 20);
    expect(nullBudgetChild?.budgetId).toBe(uncategorized.id);
  });

  it('rejects a $0 amount row with a specific reason', async () => {
    const group = await createBudgetGroup();
    const budget = await createBudget(group.id);
    const account = await makeAccount(100);
    const zero = await expenseOn(account.id, budget.id, 0);

    const sessionId = await openSession(account.id);
    const row = await addStatementRow(sessionId, 0);
    const res = await post(`/reconciliations/${sessionId}/merge`, {
      statementRowId: row.id,
      transactionIds: [zero.id],
      name: 'Merged',
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/zero amount/i);
  });

  it('refuses a set containing an income with a specific reason', async () => {
    const group = await createBudgetGroup();
    const budget = await createBudget(group.id);
    const account = await makeAccount(100);
    const exp = await expenseOn(account.id, budget.id, 40);
    const inc = await ledgerCreate({
      type: 'INCOME',
      name: 'paycheck',
      amount: 40,
      date: new Date(Date.UTC(2026, 1, 5)),
      accountId: account.id,
      budgetId: budget.id,
    });

    const sessionId = await openSession(account.id);
    const row = await addStatementRow(sessionId, -40);
    const res = await post(`/reconciliations/${sessionId}/merge`, {
      statementRowId: row.id,
      transactionIds: [exp.id, inc.id],
      name: 'Merged',
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/INCOME/);
  });

  it('refuses a mixed expense + refund set', async () => {
    const group = await createBudgetGroup();
    const budget = await createBudget(group.id);
    const account = await makeAccount(100);
    const exp = await expenseOn(account.id, budget.id, 60);
    const ref = await ledgerCreate({
      type: 'REFUND',
      name: 'refund',
      amount: 20,
      date: new Date(Date.UTC(2026, 1, 5)),
      accountId: account.id,
      budgetId: budget.id,
    });

    const sessionId = await openSession(account.id);
    const row = await addStatementRow(sessionId, -40);
    const res = await post(`/reconciliations/${sessionId}/merge`, {
      statementRowId: row.id,
      transactionIds: [exp.id, ref.id],
      name: 'Merged',
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/all expenses or all refunds/i);
  });

  it('refuses a transaction that is already a split child', async () => {
    const group = await createBudgetGroup();
    const budget = await createBudget(group.id);
    const account = await makeAccount(500);
    const parent = await expenseOn(account.id, budget.id, 100);
    // Split it: create a child directly (parentId set).
    const child = await prisma.transaction.create({
      data: {
        parentId: parent.id,
        type: 'EXPENSE',
        name: parent.name,
        amount: 100,
        netAmount: 100,
        date: parent.date,
        accountId: account.id,
        budgetId: budget.id,
      },
    });

    const sessionId = await openSession(account.id);
    const row = await addStatementRow(sessionId, -100);
    const res = await post(`/reconciliations/${sessionId}/merge`, {
      statementRowId: row.id,
      transactionIds: [child.id],
      name: 'Merged',
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/already part of a split/i);
  });

  it('rejects a set whose amounts do not sum to the statement line', async () => {
    const group = await createBudgetGroup();
    const budget = await createBudget(group.id);
    const account = await makeAccount(500);
    const a = await expenseOn(account.id, budget.id, 50);
    const b = await expenseOn(account.id, budget.id, 50);

    const sessionId = await openSession(account.id);
    const row = await addStatementRow(sessionId, -200); // sums to 100, not 200
    const res = await post(`/reconciliations/${sessionId}/merge`, {
      statementRowId: row.id,
      transactionIds: [a.id, b.id],
      name: 'Merged',
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(
      /does not match the statement/i,
    );
  });

  it('a mid-merge failure leaves zero parents, zero children, and every original intact', async () => {
    const group = await createBudgetGroup();
    const budget = await createBudget(group.id);
    const account = await makeAccount(1000);
    const a = await expenseOn(account.id, budget.id, 100);
    const b = await expenseOn(account.id, budget.id, 100);

    const balanceBefore = Number(
      (await prisma.account.findUniqueOrThrow({ where: { id: account.id } })).balance,
    );
    const countBefore = await prisma.transaction.count({ where: { accountId: account.id } });

    const sessionId = await openSession(account.id);
    const row = await addStatementRow(sessionId, -200);

    // Force the parent create to throw AFTER the originals have been deleted, so
    // the whole $transaction must roll back.
    const spy = vi.spyOn(lifecycle, 'ledgerCreate').mockRejectedValueOnce(new Error('boom'));
    try {
      const res = await post(`/reconciliations/${sessionId}/merge`, {
        statementRowId: row.id,
        transactionIds: [a.id, b.id],
        name: 'Merged',
      });
      expect(res.status).toBe(500);
      // The parent-create was reached (so the deletes had already run inside the
      // transaction) — proving the rollback below undoes real work, not a no-op.
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }

    // Everything is exactly as it was: both originals alive, no parent/children,
    // no match, balance unchanged.
    const survivors = await prisma.transaction.findMany({ where: { id: { in: [a.id, b.id] } } });
    expect(survivors).toHaveLength(2);
    const countAfter = await prisma.transaction.count({ where: { accountId: account.id } });
    expect(countAfter).toBe(countBefore);
    const matches = await prisma.reconciliationMatch.count({ where: { sessionId } });
    expect(matches).toBe(0);
    const balanceAfter = Number(
      (await prisma.account.findUniqueOrThrow({ where: { id: account.id } })).balance,
    );
    expect(balanceAfter).toBe(balanceBefore);
  });
});

describe('GET /reconciliations/:id — merge disclosure (Req 5)', () => {
  it('flags each candidate row that a merge would discard: recurring link and scheduled match', async () => {
    const group = await createBudgetGroup();
    const budget = await createBudget(group.id);
    const account = await makeAccount(1000);

    // (a) Linked to a recurring expense AND matched to a PENDING scheduled row —
    // the schedule-matcher hook pairs it on create.
    const rent = await createExpense(budget.id, { name: 'Rent' });
    await prisma.scheduledTransaction.create({
      data: {
        sourceType: 'EXPENSE',
        sourceId: rent.id,
        dueDate: new Date(Date.UTC(2026, 1, 5)),
        expectedAmount: 100,
        status: 'PENDING',
        expenseId: rent.id,
      },
    });
    const matched = await ledgerCreate({
      type: 'EXPENSE',
      name: 'Rent Payment',
      amount: 100,
      date: new Date(Date.UTC(2026, 1, 5)),
      accountId: account.id,
      budgetId: budget.id,
      expenseId: rent.id,
    });

    // (b) Linked to a recurring expense, but no scheduled row to match.
    const gym = await createExpense(budget.id, { name: 'Gym' });
    const linkedOnly = await ledgerCreate({
      type: 'EXPENSE',
      name: 'Gym',
      amount: 50,
      date: new Date(Date.UTC(2026, 1, 6)),
      accountId: account.id,
      budgetId: budget.id,
      expenseId: gym.id,
    });

    // (c) A plain one-off expense — nothing to disclose.
    const plain = await expenseOn(account.id, budget.id, 25, 7);

    const sessionId = await openSession(account.id);
    const res = await get(`/reconciliations/${sessionId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      appTransactions: { id: string; recurringLink: boolean; scheduledMatch: boolean }[];
    };
    const byId = new Map(body.appTransactions.map((t) => [t.id, t]));

    expect(byId.get(matched.id)).toMatchObject({ recurringLink: true, scheduledMatch: true });
    expect(byId.get(linkedOnly.id)).toMatchObject({ recurringLink: true, scheduledMatch: false });
    expect(byId.get(plain.id)).toMatchObject({ recurringLink: false, scheduledMatch: false });
  });
});
