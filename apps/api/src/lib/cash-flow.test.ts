/**
 * Unit Tests for Cash Flow Timing Functions
 *
 * Example-based tests for classifyExpense and computeCashFlowSummary.
 * Property-based tests live in cash-flow.property.test.ts.
 *
 * Feature: cash-flow-timing
 * Requirements: 1.1, 1.2, 1.3, 1.4, 8.5, 8.6
 */
import { describe, it, expect } from 'vitest';
import { prisma } from '@budget-tracker/db';
import {
  classifyExpense,
  computeCashFlowSummary,
  findPreviousPeriod,
  sumPreviousPeriodCreditExpenses,
  sumCreditCardPayments,
  sumPreviousPeriodBankBalanceByType,
  sumPreviousPeriodCreditBalance,
  sumAdHocCashSpending,
} from './cash-flow.js';
import type { CashFlowInput } from './cash-flow.js';
import {
  createPaySchedule,
  createPayPeriod,
  createTransaction,
  createBudgetGroup,
  createBudget,
  createExpense,
} from '../test/helpers.js';

// ─── classifyExpense ───

describe('classifyExpense', () => {
  it('classifies "Checking" as cash', () => {
    expect(classifyExpense('Checking')).toBe('cash');
  });

  it('classifies "Savings" as cash', () => {
    expect(classifyExpense('Savings')).toBe('cash');
  });

  it('classifies "Credit Card" as credit', () => {
    expect(classifyExpense('Credit Card')).toBe('credit');
  });

  it('classifies "Gift Card" as cash', () => {
    expect(classifyExpense('Gift Card')).toBe('cash');
  });

  it('classifies "HSA" as excluded — trapped cash, on neither card', () => {
    expect(classifyExpense('HSA')).toBe('excluded');
  });

  it('classifies "Rewards" as excluded — a rewards account is not spendable cash', () => {
    expect(classifyExpense('Rewards')).toBe('excluded');
  });

  it('classifies null (unlinked expense) as cash', () => {
    expect(classifyExpense(null)).toBe('cash');
  });
});

// ─── computeCashFlowSummary ───

describe('computeCashFlowSummary', () => {
  it('computes correct summary for mixed cash and credit expenses', () => {
    const input: CashFlowInput = {
      expenseItems: [
        { expenseType: 'cash', amount: 100, isPaid: true },
        { expenseType: 'cash', amount: 200, isPaid: false },
        { expenseType: 'cash', amount: 50, isPaid: true },
        { expenseType: 'credit', amount: 300, isPaid: false },
        { expenseType: 'credit', amount: 150, isPaid: true },
      ],
      previousPeriodCreditTotal: 400,
      previousPeriodBankBalance: 5000,
      creditCardPayments: 250,
    };

    const summary = computeCashFlowSummary(input);

    expect(summary.cashExpenses).toBe(350); // 100 + 200 + 50
    expect(summary.creditExpenses).toBe(450); // 300 + 150
    expect(summary.previousPeriodCreditExpenses).toBe(400);
    expect(summary.previousPeriodBankBalance).toBe(5000);
    expect(summary.cashNeeded).toBe(750); // 350 + 400
    expect(summary.creditCardPayments).toBe(250);
  });

  it('counts an excluded (HSA) item toward neither cash nor credit', () => {
    const input: CashFlowInput = {
      expenseItems: [
        { expenseType: 'cash', amount: 100, isPaid: true },
        { expenseType: 'credit', amount: 300, isPaid: false },
        { expenseType: 'excluded', amount: 999, isPaid: true }, // HSA — trapped
      ],
      previousPeriodCreditTotal: 0,
      previousPeriodBankBalance: 0,
      creditCardPayments: 0,
    };

    const summary = computeCashFlowSummary(input);

    expect(summary.cashExpenses).toBe(100); // the 999 HSA is not here
    expect(summary.creditExpenses).toBe(300); // nor here
  });

  it('returns zeros for an empty expense list', () => {
    const input: CashFlowInput = {
      expenseItems: [],
      previousPeriodCreditTotal: 0,
      previousPeriodBankBalance: 0,
      creditCardPayments: 0,
    };

    const summary = computeCashFlowSummary(input);

    expect(summary.cashExpenses).toBe(0);
    expect(summary.creditExpenses).toBe(0);
    expect(summary.previousPeriodCreditExpenses).toBe(0);
    expect(summary.previousPeriodBankBalance).toBe(0);
    expect(summary.cashNeeded).toBe(0);
    expect(summary.creditCardPayments).toBe(0);
  });

  it('handles all-cash expenses', () => {
    const input: CashFlowInput = {
      expenseItems: [
        { expenseType: 'cash', amount: 500, isPaid: true },
        { expenseType: 'cash', amount: 300, isPaid: false },
      ],
      previousPeriodCreditTotal: 100,
      previousPeriodBankBalance: 2500,
      creditCardPayments: 0,
    };

    const summary = computeCashFlowSummary(input);

    expect(summary.cashExpenses).toBe(800);
    expect(summary.creditExpenses).toBe(0);
    expect(summary.previousPeriodCreditExpenses).toBe(100);
    expect(summary.cashNeeded).toBe(900); // 800 + 100
    expect(summary.creditCardPayments).toBe(0);
  });

  it('handles all-credit expenses', () => {
    const input: CashFlowInput = {
      expenseItems: [
        { expenseType: 'credit', amount: 250, isPaid: true },
        { expenseType: 'credit', amount: 750, isPaid: false },
      ],
      previousPeriodCreditTotal: 600,
      previousPeriodBankBalance: 1200,
      creditCardPayments: 500,
    };

    const summary = computeCashFlowSummary(input);

    expect(summary.cashExpenses).toBe(0);
    expect(summary.creditExpenses).toBe(1000); // 250 + 750
    expect(summary.previousPeriodCreditExpenses).toBe(600);
    expect(summary.cashNeeded).toBe(600); // 0 + 600
    expect(summary.creditCardPayments).toBe(500);
  });

  it('cashExpenses + creditExpenses equals total of all expense amounts (backward compatibility)', () => {
    const input: CashFlowInput = {
      expenseItems: [
        { expenseType: 'cash', amount: 120, isPaid: true },
        { expenseType: 'credit', amount: 80, isPaid: false },
        { expenseType: 'cash', amount: 200, isPaid: true },
        { expenseType: 'credit', amount: 100, isPaid: false },
      ],
      previousPeriodCreditTotal: 300,
      previousPeriodBankBalance: 3000,
      creditCardPayments: 150,
    };

    const summary = computeCashFlowSummary(input);
    const totalExpenses = input.expenseItems.reduce((sum, item) => sum + item.amount, 0);

    expect(summary.cashExpenses + summary.creditExpenses).toBe(totalExpenses);
    expect(totalExpenses).toBe(500); // 120 + 80 + 200 + 100
  });
});

// ─── findPreviousPeriod (DB helper) ───

describe('findPreviousPeriod', () => {
  it('returns the pay period with the highest end date before the given start date', async () => {
    const schedule = await createPaySchedule();

    // Create three periods: oldest, middle, newest
    const oldest = await createPayPeriod(schedule.id, {
      startDate: new Date(Date.UTC(2026, 0, 1)),
      endDate: new Date(Date.UTC(2026, 0, 14)),
      payDate: new Date(Date.UTC(2026, 0, 1)),
    });
    const middle = await createPayPeriod(schedule.id, {
      startDate: new Date(Date.UTC(2026, 0, 15)),
      endDate: new Date(Date.UTC(2026, 0, 28)),
      payDate: new Date(Date.UTC(2026, 0, 15)),
    });
    // Current period starts Feb 1 — previous should be "middle"
    await createPayPeriod(schedule.id, {
      startDate: new Date(Date.UTC(2026, 1, 1)),
      endDate: new Date(Date.UTC(2026, 1, 14)),
      payDate: new Date(Date.UTC(2026, 1, 1)),
    });

    const result = await findPreviousPeriod(schedule.id, new Date(Date.UTC(2026, 1, 1)));

    expect(result).not.toBeNull();
    expect(result!.id).toBe(middle.id);
    // Verify it picked the one with the highest endDate before the start
    expect(result!.endDate.getTime()).toBeGreaterThan(oldest.endDate.getTime());
  });

  it('returns null when no previous period exists', async () => {
    const schedule = await createPaySchedule();

    // Only one period — the "current" one
    await createPayPeriod(schedule.id, {
      startDate: new Date(Date.UTC(2026, 0, 1)),
      endDate: new Date(Date.UTC(2026, 0, 14)),
      payDate: new Date(Date.UTC(2026, 0, 1)),
    });

    const result = await findPreviousPeriod(schedule.id, new Date(Date.UTC(2026, 0, 1)));

    expect(result).toBeNull();
  });
});

// ─── sumPreviousPeriodCreditExpenses (DB helper) ───

describe('sumPreviousPeriodCreditExpenses', () => {
  it('sums EXPENSE transactions on credit card accounts, subtracts REFUNDs, adds unpaid scheduled credit expenses', async () => {
    // Create accounts: one credit card, one checking
    const creditAccount = await prisma.account.create({
      data: { name: 'Test CC', type: 'Credit Card' },
    });
    const checkingAccount = await prisma.account.create({
      data: { name: 'Test Checking', type: 'Checking' },
    });

    // Create a pay schedule and previous period
    const schedule = await createPaySchedule();
    const previousPeriod = await createPayPeriod(schedule.id, {
      startDate: new Date(Date.UTC(2026, 0, 1)),
      endDate: new Date(Date.UTC(2026, 0, 14)),
      payDate: new Date(Date.UTC(2026, 0, 1)),
    });

    // Create EXPENSE transactions on the credit card within the period
    await createTransaction(creditAccount.id, {
      type: 'EXPENSE',
      amount: 100,
      netAmount: 100,
      date: new Date(Date.UTC(2026, 0, 5)),
    });
    await createTransaction(creditAccount.id, {
      type: 'EXPENSE',
      amount: 200,
      netAmount: 200,
      date: new Date(Date.UTC(2026, 0, 10)),
    });

    // Create a REFUND on the credit card within the period
    await createTransaction(creditAccount.id, {
      type: 'REFUND',
      amount: 50,
      netAmount: 50,
      date: new Date(Date.UTC(2026, 0, 8)),
    });

    // Create an EXPENSE on checking (should NOT be counted)
    await createTransaction(checkingAccount.id, {
      type: 'EXPENSE',
      amount: 999,
      netAmount: 999,
      date: new Date(Date.UTC(2026, 0, 7)),
    });

    // Create an unpaid scheduled credit expense within the period
    const group = await createBudgetGroup();
    const budget = await createBudget(group.id);
    const expense = await createExpense(budget.id, {
      accountId: creditAccount.id,
      frequency: 'MONTHLY',
      amount: 75,
      dueDay: 12,
      startDate: new Date(Date.UTC(2025, 0, 1)),
    });

    // Build account type map
    const accountTypeMap = new Map<string, string>([
      [creditAccount.id, 'Credit Card'],
      [checkingAccount.id, 'Checking'],
    ]);

    const result = await sumPreviousPeriodCreditExpenses(previousPeriod, accountTypeMap);

    // EXPENSE total: 100 + 200 = 300
    // REFUND total: 50
    // Net actual: 300 - 50 = 250
    // Plus scheduled credit expense: 75
    // Total: 250 + 75 = 325
    expect(result).toBe(325);
  });

  it('returns 0 when account type map has no credit card accounts', async () => {
    const checkingAccount = await prisma.account.create({
      data: { name: 'Test Checking', type: 'Checking' },
    });

    const schedule = await createPaySchedule();
    const previousPeriod = await createPayPeriod(schedule.id, {
      startDate: new Date(Date.UTC(2026, 0, 1)),
      endDate: new Date(Date.UTC(2026, 0, 14)),
      payDate: new Date(Date.UTC(2026, 0, 1)),
    });

    // Create a transaction (should not matter since no CC accounts)
    await createTransaction(checkingAccount.id, {
      type: 'EXPENSE',
      amount: 500,
      netAmount: 500,
      date: new Date(Date.UTC(2026, 0, 5)),
    });

    const accountTypeMap = new Map<string, string>([[checkingAccount.id, 'Checking']]);

    const result = await sumPreviousPeriodCreditExpenses(previousPeriod, accountTypeMap);

    expect(result).toBe(0);
  });
});

// ─── sumCreditCardPayments (DB helper) ───

describe('sumCreditCardPayments', () => {
  it('sums TRANSFER transactions to credit card accounts within date range', async () => {
    const creditAccount = await prisma.account.create({
      data: { name: 'Test CC', type: 'Credit Card' },
    });
    const checkingAccount = await prisma.account.create({
      data: { name: 'Test Checking', type: 'Checking' },
    });

    const periodStart = new Date(Date.UTC(2026, 0, 1));
    const periodEnd = new Date(Date.UTC(2026, 0, 14));

    // Transfer TO credit card (should be counted)
    await createTransaction(checkingAccount.id, {
      type: 'TRANSFER',
      amount: 500,
      date: new Date(Date.UTC(2026, 0, 5)),
      toAccountId: creditAccount.id,
    });
    await createTransaction(checkingAccount.id, {
      type: 'TRANSFER',
      amount: 300,
      date: new Date(Date.UTC(2026, 0, 10)),
      toAccountId: creditAccount.id,
    });

    // Transfer TO checking (should NOT be counted)
    await createTransaction(creditAccount.id, {
      type: 'TRANSFER',
      amount: 100,
      date: new Date(Date.UTC(2026, 0, 7)),
      toAccountId: checkingAccount.id,
    });

    const result = await sumCreditCardPayments(periodStart, periodEnd);

    // Only transfers TO credit card: 500 + 300 = 800
    expect(result).toBe(800);
  });

  it('returns 0 when no credit card transfers exist in range', async () => {
    const checkingAccount = await prisma.account.create({
      data: { name: 'Test Checking', type: 'Checking' },
    });
    const savingsAccount = await prisma.account.create({
      data: { name: 'Test Savings', type: 'Savings' },
    });

    const periodStart = new Date(Date.UTC(2026, 0, 1));
    const periodEnd = new Date(Date.UTC(2026, 0, 14));

    // Transfer between non-credit-card accounts
    await createTransaction(checkingAccount.id, {
      type: 'TRANSFER',
      amount: 1000,
      date: new Date(Date.UTC(2026, 0, 5)),
      toAccountId: savingsAccount.id,
    });

    const result = await sumCreditCardPayments(periodStart, periodEnd);

    expect(result).toBe(0);
  });
});

// ─── sumPreviousPeriodBankBalanceByType (DB helper) ───
//
// Computed live — openingBalance + every signed transaction dated on or
// before the period's end — not from a frozen snapshot. See the function's
// own comment in cash-flow.ts for why a frozen snapshot is the wrong shape:
// it freezes whatever the ledger looked like the instant it was first read
// and never revisits it, so an incomplete import or an in-flight correction
// sticks wrong forever. These tests build the balance from real transactions
// instead of a pre-inserted snapshot row, and pin the two properties that
// make "live" safe rather than dangerous: a correction dated within the
// period is picked up automatically, and a transaction dated AFTER the
// period end (this period's own spending) never moves it.

describe('sumPreviousPeriodBankBalanceByType', () => {
  const periodStart = new Date(Date.UTC(2026, 0, 1));
  const periodEnd = new Date(Date.UTC(2026, 0, 14));

  it('splits balance-as-of-period-end into Checking and Savings, ignoring Credit Card', async () => {
    const checkingAccount = await prisma.account.create({
      data: { name: 'Test Checking', type: 'Checking', openingBalance: 1000 },
    });
    const savingsAccount = await prisma.account.create({
      data: { name: 'Test Savings', type: 'Savings', openingBalance: 5000 },
    });
    const creditAccount = await prisma.account.create({
      data: { name: 'Test CC', type: 'Credit Card', openingBalance: -500 },
    });

    const schedule = await createPaySchedule();
    const previousPeriod = await createPayPeriod(schedule.id, {
      startDate: periodStart,
      endDate: periodEnd,
      payDate: periodStart,
    });

    // Checking: 1000 opening + 500 income, dated within the period, = 1500.
    await createTransaction(checkingAccount.id, {
      type: 'INCOME',
      amount: 500,
      netAmount: 500,
      date: new Date(Date.UTC(2026, 0, 5)),
    });
    // Savings: 5000 opening + 200 income = 5200.
    await createTransaction(savingsAccount.id, {
      type: 'INCOME',
      amount: 200,
      netAmount: 200,
      date: new Date(Date.UTC(2026, 0, 5)),
    });
    // Credit card has its own real activity too — proves it's excluded by
    // TYPE, not merely because it happens to have no transactions.
    await createTransaction(creditAccount.id, {
      type: 'EXPENSE',
      amount: 300,
      netAmount: 300,
      date: new Date(Date.UTC(2026, 0, 5)),
    });

    const result = await sumPreviousPeriodBankBalanceByType(previousPeriod);

    expect(result).toEqual({ checking: 1500, savings: 5200 });
  });

  it('returns zeroes when there are no Checking or Savings accounts', async () => {
    const schedule = await createPaySchedule();
    const previousPeriod = await createPayPeriod(schedule.id, {
      startDate: periodStart,
      endDate: periodEnd,
      payDate: periodStart,
    });

    const result = await sumPreviousPeriodBankBalanceByType(previousPeriod);

    expect(result).toEqual({ checking: 0, savings: 0 });
  });

  it('returns zeroes when only a Credit Card account exists', async () => {
    const creditAccount = await prisma.account.create({
      data: { name: 'Test CC', type: 'Credit Card', openingBalance: -1000 },
    });

    const schedule = await createPaySchedule();
    const previousPeriod = await createPayPeriod(schedule.id, {
      startDate: periodStart,
      endDate: periodEnd,
      payDate: periodStart,
    });

    await createTransaction(creditAccount.id, {
      type: 'EXPENSE',
      amount: 200,
      netAmount: 200,
      date: new Date(Date.UTC(2026, 0, 5)),
    });

    const result = await sumPreviousPeriodBankBalanceByType(previousPeriod);

    expect(result).toEqual({ checking: 0, savings: 0 });
  });

  it('picks up a transaction added after the period rolled over — no manual fix required', async () => {
    // The exact bug this replaces: a frozen snapshot never sees data added or
    // corrected later. This proves the live version does, automatically.
    const checkingAccount = await prisma.account.create({
      data: { name: 'Late Checking', type: 'Checking', openingBalance: 0 },
    });
    const schedule = await createPaySchedule();
    const previousPeriod = await createPayPeriod(schedule.id, {
      startDate: periodStart,
      endDate: periodEnd,
      payDate: periodStart,
    });

    expect(await sumPreviousPeriodBankBalanceByType(previousPeriod)).toEqual({
      checking: 0,
      savings: 0,
    });

    // A transaction dated inside the already-closed period is entered later
    // (e.g. re-entered after data loss) — no separate "refresh" step exists
    // or is needed.
    await createTransaction(checkingAccount.id, {
      type: 'INCOME',
      amount: 250,
      netAmount: 250,
      date: new Date(Date.UTC(2026, 0, 10)),
    });

    expect(await sumPreviousPeriodBankBalanceByType(previousPeriod)).toEqual({
      checking: 250,
      savings: 0,
    });
  });

  it('ignores a transaction dated after the period end — current-period spending never moves it', async () => {
    const checkingAccount = await prisma.account.create({
      data: { name: 'Current Checking', type: 'Checking', openingBalance: 1000 },
    });
    const schedule = await createPaySchedule();
    const previousPeriod = await createPayPeriod(schedule.id, {
      startDate: periodStart,
      endDate: periodEnd,
      payDate: periodStart,
    });

    // Dated the day AFTER periodEnd — this period's own activity, not the
    // previous period's closing balance.
    await createTransaction(checkingAccount.id, {
      type: 'EXPENSE',
      amount: 400,
      netAmount: 400,
      date: new Date(Date.UTC(2026, 0, 15)),
    });

    const result = await sumPreviousPeriodBankBalanceByType(previousPeriod);

    expect(result).toEqual({ checking: 1000, savings: 0 });
  });
});

// ─── sumPreviousPeriodCreditBalance (DB helper) ───

describe('sumPreviousPeriodCreditBalance', () => {
  const periodStart = new Date(Date.UTC(2026, 0, 1));
  const periodEnd = new Date(Date.UTC(2026, 0, 14));

  it('sums the absolute balance owed across all Credit Card accounts as of period end', async () => {
    const cardA = await prisma.account.create({
      data: { name: 'Card A', type: 'Credit Card', openingBalance: 0 },
    });
    const cardB = await prisma.account.create({
      data: { name: 'Card B', type: 'Credit Card', openingBalance: -1000 },
    });
    const checking = await prisma.account.create({
      data: { name: 'Ignored Checking', type: 'Checking', openingBalance: 5000 },
    });

    const schedule = await createPaySchedule();
    const previousPeriod = await createPayPeriod(schedule.id, {
      startDate: periodStart,
      endDate: periodEnd,
      payDate: periodStart,
    });

    // Card A: 0 opening − 200 expense = −200 owed.
    await createTransaction(cardA.id, {
      type: 'EXPENSE',
      amount: 200,
      netAmount: 200,
      date: new Date(Date.UTC(2026, 0, 5)),
    });
    // Card B: −1000 opening − 50 expense = −1050 owed.
    await createTransaction(cardB.id, {
      type: 'EXPENSE',
      amount: 50,
      netAmount: 50,
      date: new Date(Date.UTC(2026, 0, 6)),
    });
    // Unrelated Checking activity must not leak into the credit total.
    await createTransaction(checking.id, {
      type: 'EXPENSE',
      amount: 9999,
      netAmount: 9999,
      date: new Date(Date.UTC(2026, 0, 5)),
    });

    const result = await sumPreviousPeriodCreditBalance(previousPeriod);

    // |−200| + |−1050| = 1250.
    expect(result).toBe(1250);
  });

  it('returns 0 when there are no Credit Card accounts', async () => {
    const schedule = await createPaySchedule();
    const previousPeriod = await createPayPeriod(schedule.id, {
      startDate: periodStart,
      endDate: periodEnd,
      payDate: periodStart,
    });

    const result = await sumPreviousPeriodCreditBalance(previousPeriod);

    expect(result).toBe(0);
  });

  it('picks up a transaction added after the period rolled over — no manual fix required', async () => {
    // The exact scenario that motivated this rewrite: historical data lost
    // and re-entered after the period had already closed. The old
    // BalanceSnapshot-based version would have frozen at the first (wrong)
    // read and never seen this; the live version reflects it immediately.
    const card = await prisma.account.create({
      data: { name: 'Recovered Card', type: 'Credit Card', openingBalance: 0 },
    });
    const schedule = await createPaySchedule();
    const previousPeriod = await createPayPeriod(schedule.id, {
      startDate: periodStart,
      endDate: periodEnd,
      payDate: periodStart,
    });

    expect(await sumPreviousPeriodCreditBalance(previousPeriod)).toBe(0);

    await createTransaction(card.id, {
      type: 'EXPENSE',
      amount: 3486.58,
      netAmount: 3486.58,
      date: new Date(Date.UTC(2026, 0, 10)),
    });

    expect(await sumPreviousPeriodCreditBalance(previousPeriod)).toBe(3486.58);
  });

  it('ignores a payoff dated after the period end — paying off the card this period never lowers it', async () => {
    const card = await prisma.account.create({
      data: { name: 'Paid-off Card', type: 'Credit Card', openingBalance: 0 },
    });
    const checking = await prisma.account.create({
      data: { name: 'Payer Checking', type: 'Checking', openingBalance: 1000 },
    });
    const schedule = await createPaySchedule();
    const previousPeriod = await createPayPeriod(schedule.id, {
      startDate: periodStart,
      endDate: periodEnd,
      payDate: periodStart,
    });

    // Owed as of period end.
    await createTransaction(card.id, {
      type: 'EXPENSE',
      amount: 500,
      netAmount: 500,
      date: new Date(Date.UTC(2026, 0, 10)),
    });
    // Paid off the day AFTER period end — this period's payment, dated into
    // the NEXT period, must not retroactively shrink the previous balance.
    await createTransaction(checking.id, {
      type: 'TRANSFER',
      amount: 500,
      date: new Date(Date.UTC(2026, 0, 15)),
      toAccountId: card.id,
    });

    const result = await sumPreviousPeriodCreditBalance(previousPeriod);

    expect(result).toBe(500);
  });
});

// ─── sumAdHocCashSpending (DB helper) ───

describe('sumAdHocCashSpending', () => {
  it('nets ad-hoc cash EXPENSE minus REFUND, excluding linked bills and credit spend', async () => {
    const checking = await prisma.account.create({
      data: { name: 'AdHoc Checking', type: 'Checking' },
    });
    const credit = await prisma.account.create({
      data: { name: 'AdHoc CC', type: 'Credit Card' },
    });
    const group = await createBudgetGroup();
    const budget = await createBudget(group.id);
    const linkedExpense = await createExpense(budget.id, { accountId: checking.id });

    const periodStart = new Date(Date.UTC(2026, 2, 1));
    const periodEnd = new Date(Date.UTC(2026, 2, 14));
    const inPeriod = new Date(Date.UTC(2026, 2, 7));

    // Ad-hoc cash purchases (no expenseId) — counted.
    await createTransaction(checking.id, { type: 'EXPENSE', amount: 85, date: inPeriod });
    await createTransaction(checking.id, { type: 'EXPENSE', amount: 40, date: inPeriod });
    // Ad-hoc refund — subtracted.
    await createTransaction(checking.id, { type: 'REFUND', amount: 10, date: inPeriod });
    // Linked to a recurring bill (expenseId set) — shown as its own paid line, NOT ad-hoc.
    await createTransaction(checking.id, {
      type: 'EXPENSE',
      amount: 500,
      date: inPeriod,
      expenseId: linkedExpense.id,
    });
    // Credit-card spend — not cash, excluded.
    await createTransaction(credit.id, { type: 'EXPENSE', amount: 999, date: inPeriod });
    // Outside the period — excluded.
    await createTransaction(checking.id, {
      type: 'EXPENSE',
      amount: 700,
      date: new Date(Date.UTC(2026, 1, 20)),
    });

    const accountTypeMap = new Map<string, string>([
      [checking.id, 'Checking'],
      [credit.id, 'Credit Card'],
    ]);

    const result = await sumAdHocCashSpending(periodStart, periodEnd, accountTypeMap);

    // 85 + 40 − 10 = 115
    expect(result).toBe(115);
  });

  it('excludes HSA spending — an HSA holds trapped cash, not spendable cash', async () => {
    const checking = await prisma.account.create({
      data: { name: 'HSA-case Checking', type: 'Checking' },
    });
    const hsa = await prisma.account.create({ data: { name: 'HSA-case HSA', type: 'HSA' } });

    const periodStart = new Date(Date.UTC(2026, 2, 1));
    const periodEnd = new Date(Date.UTC(2026, 2, 14));
    const inPeriod = new Date(Date.UTC(2026, 2, 7));

    await createTransaction(checking.id, { type: 'EXPENSE', amount: 30, date: inPeriod });
    // HSA purchase — trapped cash (medical only), must NOT count as cash spending.
    await createTransaction(hsa.id, { type: 'EXPENSE', amount: 200, date: inPeriod });

    const accountTypeMap = new Map<string, string>([
      [checking.id, 'Checking'],
      [hsa.id, 'HSA'],
    ]);

    const result = await sumAdHocCashSpending(periodStart, periodEnd, accountTypeMap);

    // Only the checking purchase (30); the HSA's 200 is excluded.
    expect(result).toBe(30);
  });

  it('returns 0 when there are no cash accounts', async () => {
    const result = await sumAdHocCashSpending(
      new Date(Date.UTC(2026, 2, 1)),
      new Date(Date.UTC(2026, 2, 14)),
      new Map<string, string>([['cc-only', 'Credit Card']]),
    );
    expect(result).toBe(0);
  });
});
