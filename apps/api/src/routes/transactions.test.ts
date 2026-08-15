import { describe, it, expect } from 'vitest';
import {
  get,
  post,
  put,
  del,
  createGroup,
  createCategory,
  createExpense,
  createIncome,
  createAccount,
  createTransaction,
  createPaySchedule,
  createPayPeriod,
} from '../test/helpers.js';
import { prisma } from '@budget-tracker/db';

describe('Transactions API', () => {
  async function setup() {
    const group = await createGroup();
    const cat = await createCategory(group.id);
    const acct = await createAccount('Primary');
    const acct2 = await createAccount('Secondary');
    const expense = await createExpense(cat.id);
    const income = await createIncome(cat.id);
    return { cat, acct, acct2, expense, income };
  }

  describe('CRUD', () => {
    it('creates an expense transaction', async () => {
      const { expense, acct } = await setup();
      const res = await post('/transactions', {
        type: 'EXPENSE',
        name: 'Mortgage',
        amount: 100,
        date: '2026-03-20',
        expenseId: expense.id,
        accountId: acct.id,
      });
      expect(res.status).toBe(201);
      const body: any = await res.json();
      expect(body.type).toBe('EXPENSE');
      expect(body.name).toBe('Mortgage');
      expect(body.amount).toBe(100);
    });

    it('creates an income transaction', async () => {
      const { income, acct } = await setup();
      const res = await post('/transactions', {
        type: 'INCOME',
        name: 'Paycheck',
        amount: 5000,
        date: '2026-03-20',
        incomeId: income.id,
        accountId: acct.id,
      });
      expect(res.status).toBe(201);
      expect(((await res.json()) as any).name).toBe('Paycheck');
    });

    it('auto-names from linked expense', async () => {
      const { expense, acct } = await setup();
      const res = await post('/transactions', {
        type: 'EXPENSE',
        name: 'auto',
        amount: 100,
        date: '2026-03-20',
        expenseId: expense.id,
        accountId: acct.id,
      });
      expect(res.status).toBe(201);
    });

    it('creates a transfer', async () => {
      const { acct, acct2 } = await setup();
      const res = await post('/transactions', {
        type: 'TRANSFER',
        name: 'Move funds',
        amount: 500,
        date: '2026-03-20',
        accountId: acct.id,
        toAccountId: acct2.id,
      });
      expect(res.status).toBe(201);
      expect(((await res.json()) as any).toAccountId).toBe(acct2.id);
    });

    it('lists transactions', async () => {
      const { acct } = await setup();
      // Get baseline count
      const baselineRes: any = await (await get('/transactions')).json();
      const baseline = baselineRes.transactions.length;
      await post('/transactions', {
        type: 'EXPENSE',
        name: 'A',
        amount: 100,
        date: '2026-03-20',
        accountId: acct.id,
      });
      await post('/transactions', {
        type: 'EXPENSE',
        name: 'B',
        amount: 200,
        date: '2026-03-21',
        accountId: acct.id,
      });
      const res: any = await (await get('/transactions')).json();
      expect(res.transactions.length).toBe(baseline + 2);
    });

    it('updates transaction', async () => {
      const { acct } = await setup();
      const create = await post('/transactions', {
        type: 'EXPENSE',
        name: 'Old',
        amount: 100,
        date: '2026-03-20',
        accountId: acct.id,
      });
      const { id } = (await create.json()) as any;
      const res = await put(`/transactions/${id}`, { amount: 999 });
      expect(res.status).toBe(200);
      expect(((await res.json()) as any).amount).toBe(999);
    });

    it('deletes transaction', async () => {
      const { acct } = await setup();
      const create = await post('/transactions', {
        type: 'EXPENSE',
        name: 'Del',
        amount: 100,
        date: '2026-03-20',
        accountId: acct.id,
      });
      const { id } = (await create.json()) as any;
      expect((await del(`/transactions/${id}`)).status).toBe(204);
    });
  });

  describe('validation', () => {
    it('rejects transfer without toAccountId', async () => {
      const { acct } = await setup();
      const res = await post('/transactions', {
        type: 'TRANSFER',
        name: 'Bad',
        amount: 100,
        date: '2026-03-20',
        accountId: acct.id,
      });
      expect(res.status).toBe(400);
    });

    it('rejects transfer with same accounts', async () => {
      const { acct } = await setup();
      const res = await post('/transactions', {
        type: 'TRANSFER',
        name: 'Bad',
        amount: 100,
        date: '2026-03-20',
        accountId: acct.id,
        toAccountId: acct.id,
      });
      expect(res.status).toBe(400);
    });
  });

  describe('filtering', () => {
    it('filters by date range', async () => {
      const { acct } = await setup();
      // Get baseline for March
      const baselineRes: any = await (
        await get('/transactions?dateFrom=2026-03-01&dateTo=2026-03-31')
      ).json();
      const baselineMar = baselineRes.transactions.length;
      await post('/transactions', {
        type: 'EXPENSE',
        name: 'A',
        amount: 100,
        date: '2026-03-01',
        accountId: acct.id,
      });
      await post('/transactions', {
        type: 'EXPENSE',
        name: 'B',
        amount: 200,
        date: '2026-03-15',
        accountId: acct.id,
      });
      await post('/transactions', {
        type: 'EXPENSE',
        name: 'C',
        amount: 300,
        date: '2026-04-01',
        accountId: acct.id,
      });
      const res: any = await (
        await get('/transactions?dateFrom=2026-03-01&dateTo=2026-03-31')
      ).json();
      expect(res.transactions.length).toBe(baselineMar + 2);
    });
  });
});

describe('Transactions API — schedule-based anticipations', () => {
  async function setupWithSchedule() {
    const group = await createGroup();
    const cat = await createCategory(group.id);
    const acct = await createAccount('Primary');
    const expense = await createExpense(cat.id, {
      name: 'Rent',
      amount: 1200,
      frequency: 'MONTHLY',
      dueDay: 1,
    });
    const income = await createIncome(cat.id, {
      name: 'Salary',
      amount: 5000,
      frequency: 'BIWEEKLY',
    });
    return { group, cat, acct, expense, income };
  }

  it('returns PENDING schedule rows in anticipations array (Req 12.1)', async () => {
    const { expense, income, cat } = await setupWithSchedule();

    // The schedule generator runs on GET /transactions and creates PENDING rows
    // for the expense (dueDay=1) and income. We just need to verify anticipations appear.
    const res = await get('/transactions');
    expect(res.status).toBe(200);
    const body: any = await res.json();

    expect(body.anticipations).toBeDefined();
    expect(Array.isArray(body.anticipations)).toBe(true);

    const expAnticipation = body.anticipations.find((a: any) => a.sourceId === expense.id);
    expect(expAnticipation).toBeDefined();
    expect(expAnticipation.sourceType).toBe('expense');
    expect(expAnticipation.name).toBe('Rent');
    expect(expAnticipation.amount).toBe(1200);
    expect(expAnticipation.budgetId).toBe(cat.id);
    expect(expAnticipation.isAutomatic).toBe(false);
    expect(expAnticipation.frequency).toBe('MONTHLY');

    const incAnticipation = body.anticipations.find((a: any) => a.sourceId === income.id);
    expect(incAnticipation).toBeDefined();
    expect(incAnticipation.sourceType).toBe('income');
    expect(incAnticipation.name).toBe('Salary');
    expect(incAnticipation.amount).toBe(5000);
  });

  it('excludes PARTIAL schedule rows from anticipations (route filters to DUE/OVERDUE only)', async () => {
    const { expense } = await setupWithSchedule();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dueDate = new Date(
      Date.UTC(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate()),
    );

    await prisma.scheduledTransaction.create({
      data: {
        sourceType: 'EXPENSE',
        sourceId: expense.id,
        dueDate,
        expectedAmount: 1200,
        actualAmount: 600,
        status: 'PARTIAL',
        expenseId: expense.id,
        incomeId: null,
      },
    });

    const res = await get('/transactions');
    const body: any = await res.json();

    // PARTIAL rows are filtered out (route only includes DUE and OVERDUE)
    const partial = (body.anticipations ?? []).find(
      (a: any) => a.sourceId === expense.id && a.status === 'PARTIAL',
    );
    expect(partial).toBeUndefined();
  });

  /**
   * Snoozing hid a row from this page with no way to get it back. The row was
   * never deleted — it simply was not returned — so undoing an accidental
   * snooze meant finding it somewhere else entirely.
   */
  describe('showSnoozed', () => {
    /** A snooze that is still in effect: due yesterday, silenced until tomorrow. */
    async function snoozedRow(expenseId: string) {
      const now = new Date();
      const day = (offset: number) => {
        const d = new Date(now);
        d.setDate(d.getDate() + offset);
        return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
      };
      return prisma.scheduledTransaction.create({
        data: {
          sourceType: 'EXPENSE',
          sourceId: expenseId,
          dueDate: day(-1),
          expectedAmount: 1200,
          status: 'SNOOZED',
          snoozedUntil: day(1),
          expenseId,
          incomeId: null,
        },
      });
    }

    it('omits snoozed anticipations by default — a snooze is a deliberate "not now"', async () => {
      const { expense } = await setupWithSchedule();
      await snoozedRow(expense.id);

      const body: any = await (await get('/transactions')).json();
      const snoozed = (body.anticipations ?? []).filter((a: any) => a.status === 'SNOOZED');
      expect(snoozed).toHaveLength(0);
    });

    it('returns them, marked SNOOZED, when asked for', async () => {
      const { expense } = await setupWithSchedule();
      const row = await snoozedRow(expense.id);

      const body: any = await (await get('/transactions?showSnoozed=true')).json();
      const found = (body.anticipations ?? []).find((a: any) => a.id === row.id);
      // Carried as SNOOZED rather than folded into DUE, so the row can be shown
      // as silenced instead of reappearing as ordinary work.
      expect(found?.status).toBe('SNOOZED');
    });

    it('treats the literal string "false" as false', async () => {
      // `z.coerce.boolean()` would read "false" as true, since a non-empty
      // string is truthy. Any param that is ever sent as false needs the
      // explicit parse this schema uses.
      const { expense } = await setupWithSchedule();
      await snoozedRow(expense.id);

      const body: any = await (await get('/transactions?showSnoozed=false')).json();
      expect((body.anticipations ?? []).filter((a: any) => a.status === 'SNOOZED')).toHaveLength(0);
    });
  });

  describe('showAnticipations', () => {
    it('includes anticipations by default', async () => {
      await setupWithSchedule();
      const body: any = await (await get('/transactions')).json();
      expect(body.anticipations).toBeDefined();
      expect(body.anticipations.length).toBeGreaterThan(0);
    });

    it('omits them entirely when turned off', async () => {
      await setupWithSchedule();
      const body: any = await (await get('/transactions?showAnticipations=false')).json();
      // Undefined rather than empty: the work is skipped, not filtered after.
      expect(body.anticipations).toBeUndefined();
    });

    it('still returns real transactions when anticipations are off', async () => {
      // The toggle must hide upcoming rows only — never actual ledger rows.
      const { acct } = await setupWithSchedule();
      await createTransaction(acct.id, { name: 'Real row', amount: 25 });

      const body: any = await (await get('/transactions?showAnticipations=false')).json();
      expect(body.transactions.some((t: any) => t.name === 'Real row')).toBe(true);
    });
  });

  it('excludes PAID and SKIPPED schedule rows from anticipations (Req 12.1)', async () => {
    const { expense, income } = await setupWithSchedule();
    const today = new Date();
    const dueDate = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));

    await prisma.scheduledTransaction.createMany({
      data: [
        {
          sourceType: 'EXPENSE',
          sourceId: expense.id,
          dueDate,
          expectedAmount: 1200,
          status: 'PAID',
          expenseId: expense.id,
          incomeId: null,
        },
        {
          sourceType: 'INCOME',
          sourceId: income.id,
          dueDate,
          expectedAmount: 5000,
          status: 'SKIPPED',
          expenseId: null,
          incomeId: income.id,
        },
      ],
    });

    const res = await get('/transactions');
    const body: any = await res.json();

    // PAID and SKIPPED rows should not appear in anticipations
    const paidOrSkipped = (body.anticipations ?? []).filter(
      (a: any) =>
        (a.sourceId === expense.id || a.sourceId === income.id) &&
        new Date(a.occurrenceDate).getTime() === dueDate.getTime(),
    );
    expect(paidOrSkipped).toHaveLength(0);
  });

  it('maps AnticipationSchema shape for backward compatibility (Req 12.2)', async () => {
    const { expense, cat } = await setupWithSchedule();
    const today = new Date();
    const dueDate = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));

    await prisma.scheduledTransaction.create({
      data: {
        sourceType: 'EXPENSE',
        sourceId: expense.id,
        dueDate,
        expectedAmount: 1200,
        status: 'PENDING',
        expenseId: expense.id,
        incomeId: null,
      },
    });

    const res = await get('/transactions');
    const body: any = await res.json();
    const ant = body.anticipations.find((a: any) => a.sourceId === expense.id);

    // Verify all AnticipationSchema fields are present
    expect(ant).toHaveProperty('id');
    expect(ant).toHaveProperty('sourceType');
    expect(ant).toHaveProperty('sourceId');
    expect(ant).toHaveProperty('name');
    expect(ant).toHaveProperty('amount');
    expect(ant).toHaveProperty('occurrenceDate');
    expect(ant).toHaveProperty('status');
    expect(ant).toHaveProperty('budgetId');
    expect(ant).toHaveProperty('accountId');
    expect(ant).toHaveProperty('isAutomatic');
    expect(ant).toHaveProperty('frequency');

    // Verify the id is a real ScheduledTransaction CUID
    expect(ant.id).toBeTruthy();
    expect(ant.id).not.toMatch(/^ant_/); // Not a synthetic ID
  });

  it('does not return anticipations on paginated requests (cursor present)', async () => {
    const { expense, acct } = await setupWithSchedule();
    const today = new Date();
    const dueDate = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));

    await prisma.scheduledTransaction.create({
      data: {
        sourceType: 'EXPENSE',
        sourceId: expense.id,
        dueDate,
        expectedAmount: 1200,
        status: 'PENDING',
        expenseId: expense.id,
        incomeId: null,
      },
    });

    // Create a transaction to use as cursor
    const createRes = await post('/transactions', {
      type: 'EXPENSE',
      name: 'Test',
      amount: 50,
      date: '2026-03-20',
      accountId: acct.id,
    });
    const { id } = (await createRes.json()) as any;

    const res = await get(`/transactions?cursor=${id}`);
    const body: any = await res.json();
    expect(body.anticipations).toBeUndefined();
  });

  it('filters out active SNOOZED rows from anticipations', async () => {
    const { expense } = await setupWithSchedule();
    const today = new Date();
    const dueDate = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
    const tomorrow = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate() + 1));

    await prisma.scheduledTransaction.create({
      data: {
        sourceType: 'EXPENSE',
        sourceId: expense.id,
        dueDate,
        expectedAmount: 1200,
        status: 'SNOOZED',
        snoozedUntil: tomorrow,
        expenseId: expense.id,
        incomeId: null,
      },
    });

    const res = await get('/transactions');
    const body: any = await res.json();

    // Active snooze for today's dueDate should be filtered out (displayStatus = SNOOZED, not DUE/OVERDUE)
    const snoozedAnt = (body.anticipations ?? []).find(
      (a: any) =>
        a.sourceId === expense.id && new Date(a.occurrenceDate).getTime() === dueDate.getTime(),
    );
    expect(snoozedAnt).toBeUndefined();
  });
});

// ─── Bulk delete (DELETE /imported) ───

describe('Transactions API — DELETE /imported (bulk delete)', () => {
  it('deletes all imported transactions and returns count', async () => {
    const group = await createGroup();
    const cat = await createCategory(group.id);
    const acct = await createAccount('BulkDel');

    // Create imported transactions
    await createTransaction(acct.id, {
      name: 'Imported1',
      imported: true,
      date: new Date(Date.UTC(2026, 2, 10)),
    });
    await createTransaction(acct.id, {
      name: 'Imported2',
      imported: true,
      date: new Date(Date.UTC(2026, 2, 11)),
    });
    // Create a non-imported transaction that should survive
    await createTransaction(acct.id, {
      name: 'Manual',
      imported: false,
      date: new Date(Date.UTC(2026, 2, 12)),
    });

    const res = await del('/transactions/imported?confirm=true');
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.deleted).toBe(2);

    // Verify non-imported transaction still exists
    const remaining = await prisma.transaction.findMany({ where: { accountId: acct.id } });
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.name).toBe('Manual');
  });

  it('returns 400 without confirm=true query parameter', async () => {
    const res = await del('/transactions/imported');
    expect(res.status).toBe(400);
    const body: any = await res.json();
    expect(body.error).toContain('confirm=true');
  });

  it('returns deleted: 0 when no imported transactions exist', async () => {
    const acct = await createAccount('NoImports');
    await createTransaction(acct.id, { name: 'Manual', imported: false });

    const res = await del('/transactions/imported?confirm=true');
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.deleted).toBe(0);
  });

  it('recalculates account balances after bulk delete', async () => {
    const acct = await createAccount('BalRecalc');

    // Create an imported expense and a manual income
    await createTransaction(acct.id, {
      name: 'ImportedExp',
      type: 'EXPENSE',
      amount: 100,
      imported: true,
      date: new Date(Date.UTC(2026, 2, 10)),
    });
    await createTransaction(acct.id, {
      name: 'ManualInc',
      type: 'INCOME',
      amount: 500,
      imported: false,
      date: new Date(Date.UTC(2026, 2, 11)),
    });

    await del('/transactions/imported?confirm=true');

    // After deleting imported, balance should reflect only the manual income
    const account = await prisma.account.findUnique({ where: { id: acct.id } });
    expect(Number(account!.balance)).toBe(500);
  });

  it('stores a 2-decimal balance after bulk delete (no float drift)', async () => {
    const acct = await createAccount('BalRound');

    // Amounts chosen so raw IEEE-754 accumulation (+0.01 +0.05 -0.03) drifts
    // to a stored 0.03000000000000001 in EVERY one of the six possible
    // summation orders. Two constraints matter here:
    // 1. The recalc query has no orderBy, so row order is unspecified — with
    //    e.g. 0.1/0.2/0.05, four of six orders happen to produce an exact
    //    result and the test would pass even without rounding.
    // 2. Prisma's number→Decimal write path keeps ~16 significant digits, so
    //    the drift must survive that rounding (0.020000000000000004 does not —
    //    it stores as exactly 0.02).
    await createTransaction(acct.id, {
      name: 'RoundInc1',
      type: 'INCOME',
      amount: 0.01,
      imported: false,
      date: new Date(Date.UTC(2026, 2, 10)),
    });
    await createTransaction(acct.id, {
      name: 'RoundInc2',
      type: 'INCOME',
      amount: 0.05,
      imported: false,
      date: new Date(Date.UTC(2026, 2, 11)),
    });
    await createTransaction(acct.id, {
      name: 'RoundExp',
      type: 'EXPENSE',
      amount: 0.03,
      imported: false,
      date: new Date(Date.UTC(2026, 2, 12)),
    });
    await createTransaction(acct.id, {
      name: 'RoundImported',
      type: 'EXPENSE',
      amount: 1,
      imported: true,
      date: new Date(Date.UTC(2026, 2, 13)),
    });

    await del('/transactions/imported?confirm=true');

    const account = await prisma.account.findUnique({ where: { id: acct.id } });
    expect(account!.balance.toString()).toBe('0.03');
  });
});

// ─── Filter tests ───

describe('Transactions API — filters', () => {
  async function setupFilters() {
    const group = await createGroup();
    const cat = await createCategory(group.id);
    const acct = await createAccount('FilterAcct');
    const expense = await createExpense(cat.id);
    const income = await createIncome(cat.id);
    return { group, cat, acct, expense, income };
  }

  describe('GET /transactions with type filter', () => {
    it('returns only transactions matching the specified type', async () => {
      const { acct, expense, income } = await setupFilters();

      await post('/transactions', {
        type: 'EXPENSE',
        name: 'Exp1',
        amount: 100,
        date: '2026-04-01',
        accountId: acct.id,
        expenseId: expense.id,
      });
      await post('/transactions', {
        type: 'INCOME',
        name: 'Inc1',
        amount: 200,
        date: '2026-04-01',
        accountId: acct.id,
        incomeId: income.id,
      });
      await post('/transactions', {
        type: 'EXPENSE',
        name: 'Exp2',
        amount: 150,
        date: '2026-04-02',
        accountId: acct.id,
      });

      const res = await get('/transactions?type=EXPENSE&skipGenerate=true');
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.transactions.length).toBeGreaterThanOrEqual(2);
      expect(body.transactions.every((t: any) => t.type === 'EXPENSE')).toBe(true);
    });

    it('returns only INCOME transactions when type=INCOME', async () => {
      const { acct, income } = await setupFilters();

      await post('/transactions', {
        type: 'EXPENSE',
        name: 'Exp',
        amount: 100,
        date: '2026-04-01',
        accountId: acct.id,
      });
      await post('/transactions', {
        type: 'INCOME',
        name: 'Inc',
        amount: 500,
        date: '2026-04-01',
        accountId: acct.id,
        incomeId: income.id,
      });

      const res = await get('/transactions?type=INCOME&skipGenerate=true');
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.transactions.length).toBeGreaterThanOrEqual(1);
      expect(body.transactions.every((t: any) => t.type === 'INCOME')).toBe(true);
    });
  });

  describe('GET /transactions with purchaseGroupId filter', () => {
    it('returns only the Anchor and legs of the given purchase group', async () => {
      const { cat, acct } = await setupFilters();
      const acct2 = await createAccount('FilterAcct2');

      // A split purchase → a balance-neutral Anchor (no account, carries the
      // budget) + one balance-visible leg per funding account, all sharing a
      // purchaseGroupId. This is what "Manage purchase" deep-links to.
      const purchaseRes = await post('/purchases', {
        name: 'Split Groceries',
        date: '2026-04-10',
        amount: 90,
        budgetId: cat.id,
        payments: [
          { accountId: acct.id, amount: 50 },
          { accountId: acct2.id, amount: 40 },
        ],
      });
      expect(purchaseRes.status).toBe(201);
      const { purchaseGroupId } = (await purchaseRes.json()) as { purchaseGroupId: string | null };
      expect(purchaseGroupId).not.toBeNull();

      // An unrelated transaction that must NOT appear in the filtered list.
      await post('/transactions', {
        type: 'EXPENSE',
        name: 'Unrelated',
        amount: 25,
        date: '2026-04-10',
        accountId: acct.id,
      });

      const res = await get(`/transactions?purchaseGroupId=${purchaseGroupId}&skipGenerate=true`);
      expect(res.status).toBe(200);
      const body: any = await res.json();
      // Anchor + two legs = 3 top-level rows, all in the group, nothing else.
      expect(body.transactions).toHaveLength(3);
      expect(body.transactions.every((t: any) => t.purchaseGroupId === purchaseGroupId)).toBe(true);
      expect(body.transactions.some((t: any) => t.name === 'Unrelated')).toBe(false);
      // Exactly one balance-neutral Anchor (no account) and two legs (with accounts).
      expect(body.transactions.filter((t: any) => t.accountId === null)).toHaveLength(1);
      expect(body.transactions.filter((t: any) => t.accountId !== null)).toHaveLength(2);
    });
  });

  describe('GET /transactions with dateFrom and dateTo filters', () => {
    it('returns only transactions within the specified date range', async () => {
      const { acct } = await setupFilters();

      await post('/transactions', {
        type: 'EXPENSE',
        name: 'Before',
        amount: 10,
        date: '2026-05-01',
        accountId: acct.id,
      });
      await post('/transactions', {
        type: 'EXPENSE',
        name: 'InRange1',
        amount: 20,
        date: '2026-06-10',
        accountId: acct.id,
      });
      await post('/transactions', {
        type: 'EXPENSE',
        name: 'InRange2',
        amount: 30,
        date: '2026-06-20',
        accountId: acct.id,
      });
      await post('/transactions', {
        type: 'EXPENSE',
        name: 'After',
        amount: 40,
        date: '2026-07-15',
        accountId: acct.id,
      });

      const res = await get(
        '/transactions?dateFrom=2026-06-01&dateTo=2026-06-30&skipGenerate=true',
      );
      expect(res.status).toBe(200);
      const body: any = await res.json();

      const names = body.transactions.map((t: any) => t.name);
      expect(names).toContain('InRange1');
      expect(names).toContain('InRange2');
      expect(names).not.toContain('Before');
      expect(names).not.toContain('After');
    });

    it('includes transactions on the boundary dates', async () => {
      const { acct } = await setupFilters();

      await post('/transactions', {
        type: 'EXPENSE',
        name: 'OnStart',
        amount: 10,
        date: '2026-08-01',
        accountId: acct.id,
      });
      await post('/transactions', {
        type: 'EXPENSE',
        name: 'OnEnd',
        amount: 20,
        date: '2026-08-31',
        accountId: acct.id,
      });
      await post('/transactions', {
        type: 'EXPENSE',
        name: 'Outside',
        amount: 30,
        date: '2026-09-01',
        accountId: acct.id,
      });

      const res = await get(
        '/transactions?dateFrom=2026-08-01&dateTo=2026-08-31&skipGenerate=true',
      );
      expect(res.status).toBe(200);
      const body: any = await res.json();

      const names = body.transactions.map((t: any) => t.name);
      expect(names).toContain('OnStart');
      expect(names).toContain('OnEnd');
      expect(names).not.toContain('Outside');
    });
  });

  describe('GET /transactions with payPeriodId filter', () => {
    it('returns only transactions in the specified pay period', async () => {
      const { acct } = await setupFilters();
      const schedule = await createPaySchedule({ isDefault: false });
      const period = await createPayPeriod(schedule.id, {
        startDate: new Date(Date.UTC(2026, 3, 1)),
        endDate: new Date(Date.UTC(2026, 3, 14)),
        payDate: new Date(Date.UTC(2026, 3, 1)),
      });

      // Create a transaction assigned to this pay period
      const txInPeriod = await createTransaction(acct.id, {
        name: 'InPeriod',
        date: new Date(Date.UTC(2026, 3, 5)),
        payPeriodId: period.id,
      });
      // Create a transaction NOT in this pay period
      const txOutside = await createTransaction(acct.id, {
        name: 'OutsidePeriod',
        date: new Date(Date.UTC(2026, 3, 20)),
      });

      const res = await get(`/transactions?payPeriodId=${period.id}&skipGenerate=true`);
      expect(res.status).toBe(200);
      const body: any = await res.json();

      const ids = body.transactions.map((t: any) => t.id);
      expect(ids).toContain(txInPeriod.id);
      expect(ids).not.toContain(txOutside.id);
    });
  });

  describe('GET /transactions with expenseId or incomeId filter', () => {
    it('returns only transactions linked to the specified expense', async () => {
      const { acct, expense } = await setupFilters();

      const linkedRes = await post('/transactions', {
        type: 'EXPENSE',
        name: 'Linked',
        amount: 100,
        date: '2026-04-10',
        accountId: acct.id,
        expenseId: expense.id,
      });
      const linked: any = await linkedRes.json();

      const unlinkedRes = await post('/transactions', {
        type: 'EXPENSE',
        name: 'Unlinked',
        amount: 200,
        date: '2026-04-11',
        accountId: acct.id,
      });
      const unlinked: any = await unlinkedRes.json();

      const res = await get(`/transactions?expenseId=${expense.id}&skipGenerate=true`);
      expect(res.status).toBe(200);
      const body: any = await res.json();

      const ids = body.transactions.map((t: any) => t.id);
      expect(ids).toContain(linked.id);
      expect(ids).not.toContain(unlinked.id);
    });

    it('returns only transactions linked to the specified income', async () => {
      const { acct, income } = await setupFilters();

      const linkedRes = await post('/transactions', {
        type: 'INCOME',
        name: 'LinkedInc',
        amount: 500,
        date: '2026-04-10',
        accountId: acct.id,
        incomeId: income.id,
      });
      const linked: any = await linkedRes.json();

      const unlinkedRes = await post('/transactions', {
        type: 'EXPENSE',
        name: 'UnlinkedExp',
        amount: 100,
        date: '2026-04-11',
        accountId: acct.id,
      });
      const unlinked: any = await unlinkedRes.json();

      const res = await get(`/transactions?incomeId=${income.id}&skipGenerate=true`);
      expect(res.status).toBe(200);
      const body: any = await res.json();

      const ids = body.transactions.map((t: any) => t.id);
      expect(ids).toContain(linked.id);
      expect(ids).not.toContain(unlinked.id);
    });
  });
});
