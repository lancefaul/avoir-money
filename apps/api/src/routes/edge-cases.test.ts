/**
 * Edge-case branch tests for route handlers between 80–100% coverage.
 * Task 14.2: Each test exercises a specific uncovered code path.
 */
import { describe, it, expect } from 'vitest';
import { prisma } from '@budget-tracker/db';
import {
  get,
  post,
  put,
  del,
  createBudgetGroup,
  createBudget,
  createAccount,
  createExpense,
  createIncome,
  createTransaction,
  createPaySchedule,
  createPayPeriod,
  createDebt,
} from '../test/helpers.js';

// ─── Expenses: filtering ───────────────────────────────────────────────────

describe('Expenses — additional filtering', () => {
  async function setup() {
    const group = await createBudgetGroup();
    const budget = await createBudget(group.id);
    return { group, budget };
  }

  it('filters by archived=true', async () => {
    const { budget } = await setup();
    const expense = await createExpense(budget.id, { name: 'Active' });
    const archivedExpense = await createExpense(budget.id, { name: 'Archived' });
    await post(`/expenses/${archivedExpense.id}/archive`, {});

    const res = await get('/expenses?archived=true');
    expect(res.status).toBe(200);
    const body: any = await res.json();
    const names = body.map((e: any) => e.name);
    expect(names).toContain('Archived');
    expect(names).not.toContain('Active');
  });

  it('filters by frequency', async () => {
    const { budget } = await setup();
    await createExpense(budget.id, { name: 'Monthly', frequency: 'MONTHLY' });
    await createExpense(budget.id, { name: 'Weekly', frequency: 'WEEKLY' });

    const res = await get('/expenses?frequency=WEEKLY');
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.length).toBe(1);
    expect(body[0].name).toBe('Weekly');
  });

  it('filters by budgetId', async () => {
    const group = await createBudgetGroup();
    const budget1 = await createBudget(group.id, 'Budget1');
    const budget2 = await createBudget(group.id, 'Budget2');
    await createExpense(budget1.id, { name: 'InBudget1' });
    await createExpense(budget2.id, { name: 'InBudget2' });

    const res = await get(`/expenses?budgetId=${budget1.id}`);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.length).toBe(1);
    expect(body[0].name).toBe('InBudget1');
  });
});

// ─── Expenses: linked debt on create ───────────────────────────────────────

describe('Expenses — linked debt on create', () => {
  it('creates expense with linkedDebtId', async () => {
    const group = await createBudgetGroup();
    const budget = await createBudget(group.id);
    const debt = await createDebt();

    const res = await post('/expenses', {
      name: 'Mortgage Payment',
      amount: 1200,
      frequency: 'MONTHLY',
      budgetId: budget.id,
      linkedDebtId: debt.id,
    });
    expect(res.status).toBe(201);
    const body: any = await res.json();
    expect(body.linkedDebtId).toBe(debt.id);
  });

  it('returns 404 when linkedDebtId does not exist', async () => {
    const group = await createBudgetGroup();
    const budget = await createBudget(group.id);

    const res = await post('/expenses', {
      name: 'Bad Link',
      amount: 100,
      frequency: 'MONTHLY',
      budgetId: budget.id,
      linkedDebtId: 'nonexistent-debt-id',
    });
    expect(res.status).toBe(404);
  });
});

// ─── Income: additional filtering ──────────────────────────────────────────

describe('Income — additional filtering', () => {
  it('filters by budgetId', async () => {
    const group = await createBudgetGroup();
    const budget1 = await createBudget(group.id, 'B1');
    const budget2 = await createBudget(group.id, 'B2');
    await createIncome(budget1.id, { name: 'Inc1' });
    await createIncome(budget2.id, { name: 'Inc2' });

    const res = await get(`/income?budgetId=${budget1.id}`);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.length).toBe(1);
    expect(body[0].name).toBe('Inc1');
  });

  it('filters by archived=true', async () => {
    const group = await createBudgetGroup();
    const budget = await createBudget(group.id);
    await createIncome(budget.id, { name: 'Active' });
    const archived = await createIncome(budget.id, { name: 'Archived' });
    await post(`/income/${archived.id}/archive`, {});

    const res = await get('/income?archived=true');
    expect(res.status).toBe(200);
    const body: any = await res.json();
    const names = body.map((i: any) => i.name);
    expect(names).toContain('Archived');
    expect(names).not.toContain('Active');
  });
});

// ─── Income: resume with resumeDate ────────────────────────────────────────

describe('Income — resume with resumeDate', () => {
  it('resumes with a specific resumeDate', async () => {
    const group = await createBudgetGroup();
    const budget = await createBudget(group.id);
    const income = await createIncome(budget.id);

    // Pause first
    await post(`/income/${income.id}/pause`, { indefinite: true });

    // Resume with a specific date
    const res = await post(`/income/${income.id}/resume`, {
      resumeDate: '2026-07-01T00:00:00.000Z',
    });
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.pausedUntil).toBeNull();
    expect(body.startDate).not.toBeNull();
  });
});

// ─── Expenses: resume with resumeDate ──────────────────────────────────────

describe('Expenses — resume with resumeDate', () => {
  it('resumes with a specific resumeDate', async () => {
    const group = await createBudgetGroup();
    const budget = await createBudget(group.id);
    const expense = await createExpense(budget.id);

    // Pause first
    await post(`/expenses/${expense.id}/pause`, { indefinite: true });

    // Resume with a specific date
    const res = await post(`/expenses/${expense.id}/resume`, {
      resumeDate: '2026-07-01T00:00:00.000Z',
    });
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.pausedUntil).toBeNull();
  });
});

// ─── Transactions: search filter ───────────────────────────────────────────

describe('Transactions — search filter', () => {
  it('filters by search text (name match)', async () => {
    const acct = await createAccount();
    await createTransaction(acct.id, {
      name: 'Grocery Store',
      date: new Date(Date.UTC(2026, 7, 1)),
    });
    await createTransaction(acct.id, { name: 'Gas Station', date: new Date(Date.UTC(2026, 7, 2)) });

    const res = await get('/transactions?search=Grocery&skipGenerate=true');
    expect(res.status).toBe(200);
    const body: any = await res.json();
    const names = body.transactions.map((t: any) => t.name);
    expect(names).toContain('Grocery Store');
    expect(names).not.toContain('Gas Station');
  });

  it('filters by numeric search (amount match)', async () => {
    const acct = await createAccount();
    await createTransaction(acct.id, {
      name: 'Exact Amount',
      amount: 42.5,
      date: new Date(Date.UTC(2026, 7, 3)),
    });
    await createTransaction(acct.id, {
      name: 'Other Amount',
      amount: 99.99,
      date: new Date(Date.UTC(2026, 7, 4)),
    });

    const res = await get('/transactions?search=42.5&skipGenerate=true');
    expect(res.status).toBe(200);
    const body: any = await res.json();
    const names = body.transactions.map((t: any) => t.name);
    expect(names).toContain('Exact Amount');
  });
});

// ─── Transactions: accountId filter ────────────────────────────────────────

describe('Transactions — accountId filter', () => {
  it('returns transactions for a specific account', async () => {
    const acct1 = await createAccount('Acct1');
    const acct2 = await createAccount('Acct2');
    await createTransaction(acct1.id, { name: 'FromAcct1', date: new Date(Date.UTC(2026, 7, 5)) });
    await createTransaction(acct2.id, { name: 'FromAcct2', date: new Date(Date.UTC(2026, 7, 6)) });

    const res = await get(`/transactions?accountId=${acct1.id}&skipGenerate=true`);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    const names = body.transactions.map((t: any) => t.name);
    expect(names).toContain('FromAcct1');
    expect(names).not.toContain('FromAcct2');
  });
});

// ─── Transactions: linkedToRecurring filter ────────────────────────────────

describe('Transactions — linkedToRecurring filter', () => {
  it('returns only linked transactions when linkedToRecurring=true', async () => {
    const group = await createBudgetGroup();
    const budget = await createBudget(group.id);
    const acct = await createAccount();
    const expense = await createExpense(budget.id);

    const linkedRes = await post('/transactions', {
      type: 'EXPENSE',
      name: 'Linked',
      amount: 100,
      date: '2026-08-10',
      accountId: acct.id,
      expenseId: expense.id,
    });
    const linked: any = await linkedRes.json();

    await createTransaction(acct.id, { name: 'Unlinked', date: new Date(Date.UTC(2026, 7, 11)) });

    const res = await get('/transactions?linkedToRecurring=true&skipGenerate=true');
    expect(res.status).toBe(200);
    const body: any = await res.json();
    const ids = body.transactions.map((t: any) => t.id);
    expect(ids).toContain(linked.id);
  });

  // Note: linkedToRecurring=false via query string is coerced to true by z.coerce.boolean()
  // (Boolean("false") === true in JS). The false branch is only reachable programmatically.
  // We verify the true branch works correctly instead.
});

// ─── Transactions: combined search + accountId filter ──────────────────────

describe('Transactions — combined search + accountId filter', () => {
  it('applies both search and accountId filters together', async () => {
    const acct1 = await createAccount('CombAcct1');
    const acct2 = await createAccount('CombAcct2');
    await createTransaction(acct1.id, {
      name: 'Target Match',
      date: new Date(Date.UTC(2026, 8, 1)),
    });
    await createTransaction(acct1.id, { name: 'Other Item', date: new Date(Date.UTC(2026, 8, 2)) });
    await createTransaction(acct2.id, {
      name: 'Target Match',
      date: new Date(Date.UTC(2026, 8, 3)),
    });

    const res = await get(`/transactions?search=Target&accountId=${acct1.id}&skipGenerate=true`);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    // Should only return the transaction in acct1 matching "Target"
    expect(body.transactions.length).toBeGreaterThanOrEqual(1);
    const names = body.transactions.map((t: any) => t.name);
    expect(names).toContain('Target Match');
    expect(names).not.toContain('Other Item');
  });
});

// ─── Transactions: delete with children (409) ──────────────────────────────

describe('Transactions — delete with children', () => {
  it('returns 409 when deleting a transaction that has children', async () => {
    const acct = await createAccount();
    const parent = await createTransaction(acct.id, { name: 'Parent', amount: 100 });
    await createTransaction(acct.id, { name: 'Child', amount: 50, parentId: parent.id });

    const res = await del(`/transactions/${parent.id}`);
    expect(res.status).toBe(409);
    const body: any = await res.json();
    expect(body.error).toContain('child');
  });
});

// ─── Transactions: update amount below children sum (400) ──────────────────

describe('Transactions — update amount below children sum', () => {
  it('returns 400 when reducing amount below allocated children total', async () => {
    const acct = await createAccount();
    const parent = await createTransaction(acct.id, { name: 'Parent', amount: 100 });
    await createTransaction(acct.id, { name: 'Child', amount: 80, parentId: parent.id });

    const res = await put(`/transactions/${parent.id}`, { amount: 50 });
    expect(res.status).toBe(400);
    const body: any = await res.json();
    expect(body.error).toContain('children');
  });
});

// ─── Transactions: auto-set budgetId from linked expense ───────────────────

describe('Transactions — auto-set budgetId from linked expense', () => {
  it('auto-sets budgetId from linked expense when not provided', async () => {
    const group = await createBudgetGroup();
    const budget = await createBudget(group.id);
    const acct = await createAccount();
    const expense = await createExpense(budget.id, { name: 'Rent' });

    const res = await post('/transactions', {
      type: 'EXPENSE',
      name: 'Rent Payment',
      amount: 1200,
      date: '2026-08-15',
      accountId: acct.id,
      expenseId: expense.id,
      // budgetId intentionally omitted — should be auto-set from expense
    });
    expect(res.status).toBe(201);
    const body: any = await res.json();
    expect(body.budgetId).toBe(budget.id);
  });
});

// ─── Transactions: clear toAccountId on type change from TRANSFER ──────────

describe('Transactions — clear toAccountId on type change from TRANSFER', () => {
  it('clears toAccountId when type changes away from TRANSFER', async () => {
    const acct1 = await createAccount('From');
    const acct2 = await createAccount('To');

    const createRes = await post('/transactions', {
      type: 'TRANSFER',
      name: 'Transfer',
      amount: 500,
      date: '2026-08-20',
      accountId: acct1.id,
      toAccountId: acct2.id,
    });
    expect(createRes.status).toBe(201);
    const { id } = (await createRes.json()) as any;

    const updateRes = await put(`/transactions/${id}`, { type: 'EXPENSE' });
    expect(updateRes.status).toBe(200);
    const body: any = await updateRes.json();
    expect(body.toAccountId).toBeNull();
  });
});

// ─── Budgets: system budget protection ─────────────────────────────────────

describe('Budgets — system budget protection', () => {
  async function createSystemBudget() {
    const group = await createBudgetGroup();
    return prisma.budget.create({
      data: { name: 'Income', groupId: group.id, isCustom: false, isSystem: true },
    });
  }

  it('returns 403 when deleting a system budget', async () => {
    const sysBudget = await createSystemBudget();
    const res = await del(`/budgets/${sysBudget.id}?mode=hard`);
    expect(res.status).toBe(403);
    const body: any = await res.json();
    expect(body.error).toContain('System');
  });

  it('returns 403 when reassigning a system budget', async () => {
    const sysBudget = await createSystemBudget();
    const group = await createBudgetGroup();
    const target = await createBudget(group.id, 'Target');

    const res = await post(`/budgets/${sysBudget.id}/reassign`, {
      targetBudgetId: target.id,
    });
    expect(res.status).toBe(403);
    const body: any = await res.json();
    expect(body.error).toContain('System');
  });
});

// ─── Budgets: groupId filter ───────────────────────────────────────────────

describe('Budgets — groupId filter', () => {
  it('filters budgets by groupId', async () => {
    const group1 = await createBudgetGroup('Group1');
    const group2 = await createBudgetGroup('Group2');
    await createBudget(group1.id, 'InGroup1');
    await createBudget(group2.id, 'InGroup2');

    const res = await get(`/budgets?groupId=${group1.id}`);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.length).toBe(1);
    expect(body[0].name).toBe('InGroup1');
  });
});

// ─── Budget Groups: update 404 and delete 404 ─────────────────────────────

describe('Budget Groups — error paths', () => {
  it('returns 404 when updating a nonexistent group', async () => {
    const res = await put('/budgets/groups/nonexistent', { color: '#000000' });
    expect(res.status).toBe(404);
  });

  it('returns 404 when deleting a nonexistent group', async () => {
    const res = await del('/budgets/groups/nonexistent');
    expect(res.status).toBe(404);
  });
});

// ─── Goals: error paths ────────────────────────────────────────────────────

describe('Goals — error paths', () => {
  it('returns 404 when updating a nonexistent goal', async () => {
    const res = await put('/goals/nonexistent', { name: 'Nope' });
    expect(res.status).toBe(404);
  });

  it('returns 404 when deleting a nonexistent goal', async () => {
    const res = await del('/goals/nonexistent');
    expect(res.status).toBe(404);
  });
});

// ─── Expenses: update with linked debt change ──────────────────────────────

describe('Expenses — update with linked debt', () => {
  it('updates linkedDebtId on expense update', async () => {
    const group = await createBudgetGroup();
    const budget = await createBudget(group.id);
    const debt1 = await createDebt({ name: 'Debt1' });
    const debt2 = await createDebt({ name: 'Debt2' });

    // Create expense linked to debt1
    const createRes = await post('/expenses', {
      name: 'Payment',
      amount: 500,
      frequency: 'MONTHLY',
      budgetId: budget.id,
      linkedDebtId: debt1.id,
    });
    expect(createRes.status).toBe(201);
    const { id } = (await createRes.json()) as any;

    // Update to link to debt2
    const updateRes = await put(`/expenses/${id}`, { linkedDebtId: debt2.id });
    expect(updateRes.status).toBe(200);
    const body: any = await updateRes.json();
    expect(body.linkedDebtId).toBe(debt2.id);

    // Verify debt1 is unlinked
    const dbDebt1 = await prisma.debt.findUnique({ where: { id: debt1.id } });
    expect(dbDebt1!.linkedExpenseId).toBeNull();
  });
});

// ─── Transactions: update budgetId cascades to linked expense ──────────────

describe('Transactions — update budgetId cascades to expense', () => {
  it('updates linked expense budgetId when transaction budgetId changes', async () => {
    const group = await createBudgetGroup();
    const budget1 = await createBudget(group.id, 'OldBudget');
    const budget2 = await createBudget(group.id, 'NewBudget');
    const acct = await createAccount();
    const expense = await createExpense(budget1.id);

    const createRes = await post('/transactions', {
      type: 'EXPENSE',
      name: 'Test',
      amount: 100,
      date: '2026-09-01',
      accountId: acct.id,
      expenseId: expense.id,
    });
    expect(createRes.status).toBe(201);
    const { id } = (await createRes.json()) as any;

    // Update transaction budgetId
    const updateRes = await put(`/transactions/${id}`, { budgetId: budget2.id });
    expect(updateRes.status).toBe(200);

    // Verify expense budgetId was updated too
    const dbExpense = await prisma.expense.findUnique({ where: { id: expense.id } });
    expect(dbExpense!.budgetId).toBe(budget2.id);
  });
});
