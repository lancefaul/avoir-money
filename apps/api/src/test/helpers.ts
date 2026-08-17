/**
 * Test helpers — shared factory functions and request helpers.
 */
import app from '../app.js';
import { prisma } from '@budget-tracker/db';

let counter = 0;
function uid(prefix = '') {
  return `${prefix}${++counter}_${Date.now()}`;
}

// ─── Request helper ───

export async function req(method: string, path: string, body?: unknown) {
  const init: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env['API_KEY'] ?? 'budget-tracker-dev-key'}`,
    },
  };
  if (body) init.body = JSON.stringify(body);
  return app.request(`/api/v1${path}`, init);
}

export async function get(path: string) {
  return req('GET', path);
}
export async function post(path: string, body: unknown) {
  return req('POST', path, body);
}
export async function put(path: string, body: unknown) {
  return req('PUT', path, body);
}
export async function del(path: string) {
  return req('DELETE', path);
}
export async function patch(path: string, body: unknown) {
  return req('PATCH', path, body);
}

// ─── Factory functions ───

export async function createBudgetGroup(name?: string, color = '#ff0000') {
  return prisma.budgetGroup.create({ data: { name: name ?? uid('GRP_'), color } });
}

export async function createBudget(groupId: string, name?: string) {
  return prisma.budget.create({ data: { name: name ?? uid('BDG_'), groupId, isCustom: false } });
}

export async function createAccount(
  name?: string,
  type: 'CHECKING' | 'SAVINGS' | 'CREDIT_CARD' = 'CHECKING',
) {
  return prisma.account.create({ data: { name: name ?? uid('ACCT_'), type } });
}

export async function createIncome(budgetId: string, overrides: Record<string, unknown> = {}) {
  return prisma.income.create({
    data: { name: uid('INC_'), amount: 5000, frequency: 'BIWEEKLY', budgetId, ...overrides },
  });
}

export async function createExpense(budgetId: string, overrides: Record<string, unknown> = {}) {
  return prisma.expense.create({
    data: {
      name: uid('EXP_'),
      amount: 100,
      frequency: 'MONTHLY',
      budgetId,
      isAutomatic: false,
      ...overrides,
    },
  });
}

export async function createPaySchedule(overrides: Record<string, unknown> = {}) {
  return prisma.paySchedule.create({
    data: {
      name: uid('SCHED_'),
      type: 'BIWEEKLY',
      anchorDate: new Date('2026-03-20'),
      isDefault: true,
      ...overrides,
    },
  });
}

export async function createPayPeriod(scheduleId: string, overrides: Record<string, unknown> = {}) {
  return prisma.payPeriod.create({
    data: {
      scheduleId,
      startDate: new Date('2026-03-20'),
      endDate: new Date('2026-04-02'),
      payDate: new Date('2026-03-20'),
      year: 2026,
      periodNum: ++counter,
      ...overrides,
    },
  });
}

export async function createTransaction(
  accountId: string,
  overrides: Record<string, unknown> = {},
) {
  // rewardsApplied was retired (2c) — drop it from overrides so a stray legacy
  // key never reaches the create. netAmount tracks amount 1:1 now.
  const { rewardsApplied: _rewardsApplied, ...rest } = overrides;
  const amount = (rest.amount as number) ?? 50;
  const netAmount = (rest.netAmount as number) ?? amount;
  return prisma.transaction.create({
    data: {
      name: uid('TXN_'),
      amount,
      netAmount,
      type: 'EXPENSE',
      date: new Date(Date.UTC(2026, 5, 15)),
      accountId,
      ...rest,
      // Ensure netAmount from our calculation takes precedence unless explicitly overridden
      ...(rest.netAmount === undefined ? { netAmount } : {}),
    },
  });
}

export async function createWallet(overrides: Record<string, unknown> = {}) {
  return prisma.wallet.create({
    data: { name: uid('WALLET_'), ...overrides },
  });
}

export async function createCustodian(overrides: Record<string, unknown> = {}) {
  return prisma.custodian.create({
    data: { name: uid('CUST_'), ...overrides },
  });
}

export async function createHolding(overrides: Record<string, unknown> = {}) {
  return prisma.investmentHolding.create({
    data: {
      name: uid('HOLDING_'),
      type: 'BITCOIN',
      quantity: 1.0,
      costBasis: 50000,
      ...overrides,
    },
  });
}

export async function createHealthcareYear(overrides: Record<string, unknown> = {}) {
  return prisma.healthcareYear.create({
    data: {
      year: 2026,
      employer: 'TEST_EMPLOYER',
      medicalPremium: 500,
      medicalDeductible: 3000,
      medicalOOPM: 6000,
      dentalPremium: 50,
      visionPremium: 25,
      ...overrides,
    },
  });
}

export async function createDebt(overrides: Record<string, unknown> = {}) {
  return prisma.debt.create({
    data: {
      name: uid('DEBT_'),
      type: 'MORTGAGE',
      originalBalance: 200000,
      currentBalance: 200000,
      apr: 6.5,
      minimumPayment: 1500,
      frequency: 'MONTHLY',
      startDate: new Date(Date.UTC(2026, 0, 1)),
      ...overrides,
    },
  });
}

// ─── Backward-compatible aliases (Category → Budget rename) ───

/** @deprecated Use createBudgetGroup instead */
export const createGroup = createBudgetGroup;
/** @deprecated Use createBudget instead */
export const createCategory = createBudget;
