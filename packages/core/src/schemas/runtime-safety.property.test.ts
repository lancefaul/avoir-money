import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { z } from 'zod';

// ─── Schema imports ───
import {
  IncomeResponseSchema,
  IncomeListResponseSchema,
  ExpenseResponseSchema,
  ExpenseListResponseSchema,
  TransactionResponseSchema,
  TransactionListResponseSchema,
  AccountResponseSchema,
  AccountListResponseSchema,
  BudgetItemResponseSchema,
  BudgetItemListResponseSchema,
  DebtResponseSchema,
  DebtListResponseSchema,
  BudgetGoalResponseSchema,
  BudgetGoalListResponseSchema,
  InvestmentHoldingResponseSchema,
  InvestmentHoldingListResponseSchema,
  CustodianResponseSchema,
  CustodianListResponseSchema,
  WalletResponseSchema,
  WalletListResponseSchema,
  UtilityReadingResponseSchema,
  UtilityReadingListResponseSchema,
  PayScheduleResponseSchema,
  PayPeriodResponseSchema,
  CurrentPeriodResponseSchema,
  YTDResponseSchema,
  TrendsResponseSchema,
  BudgetBreakdownResponseSchema,
  GoalProgressResponseSchema,
  BudgetGroupResponseSchema,
} from './index.js';

// ─── Shared arbitraries ───

const arbId = fc.uuid();
// Use integer timestamps to avoid Invalid Date (NaN) from fc.date()
const arbDate = fc.integer({ min: 946684800000, max: 4102444800000 }).map((ts) => new Date(ts));
const arbMoney = fc.double({ min: 0, max: 999_999, noNaN: true, noDefaultInfinity: true });
const arbSignedMoney = fc.double({
  min: -999_999,
  max: 999_999,
  noNaN: true,
  noDefaultInfinity: true,
});
const arbPosAmount = fc.double({ min: 0.01, max: 999_999, noNaN: true, noDefaultInfinity: true });
const arbName = fc.string({ minLength: 1, maxLength: 50 });
const arbNullableString = fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: null });
const arbNullableUrl = fc.option(fc.webUrl(), { nil: null });
const arbNullableDate = fc.option(arbDate, { nil: null });
const arbNullableId = fc.option(fc.uuid(), { nil: null });
const arbNullableMoney = fc.option(arbMoney, { nil: null });

// ─── Enum value arbitraries ───

const arbFrequency = fc.constantFrom(
  'ONE_TIME',
  'WEEKLY',
  'BIWEEKLY',
  'SEMI_MONTHLY',
  'MONTHLY',
  'QUARTERLY',
  'ANNUAL',
);
const arbAccountType = fc.string({ minLength: 1, maxLength: 50 });
const arbPayScheduleType = fc.constantFrom('WEEKLY', 'BIWEEKLY', 'SEMI_MONTHLY', 'MONTHLY');
const arbInvestmentType = fc.constantFrom('STOCK', 'BITCOIN');
const arbGoalType = fc.constantFrom(
  'SAVINGS',
  'DEBT_PAYOFF',
  'INVESTMENT',
  'SPENDING_LIMIT',
  'CUSTOM',
);
const arbDebtType = fc.constantFrom(
  'MORTGAGE',
  'AUTO_LOAN',
  'STUDENT_LOAN',
  'CREDIT_CARD',
  'PERSONAL_LOAN',
  'OTHER',
);
const arbTransactionType = fc.constantFrom('EXPENSE', 'INCOME', 'TRANSFER', 'REFUND', 'TRADE');

// ─── Helper: normalize -0 to 0 (JSON.stringify(-0) === "0") ───

function normalizeNegZero(val: unknown): unknown {
  if (typeof val === 'number' && Object.is(val, -0)) return 0;
  if (val === null || val === undefined) return val;
  if (val instanceof Date) return val;
  if (Array.isArray(val)) return val.map(normalizeNegZero);
  if (typeof val === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val)) {
      out[k] = normalizeNegZero(v);
    }
    return out;
  }
  return val;
}

// ─── Helper: round-trip assertion ───

function assertRoundTrip<T extends z.ZodTypeAny>(schema: T, obj: unknown): void {
  const parsed = schema.parse(obj);
  const roundTripped = schema.parse(JSON.parse(JSON.stringify(parsed)));
  expect(normalizeNegZero(roundTripped)).toEqual(normalizeNegZero(parsed));
}

// ─── Helper: list round-trip ───

function assertListRoundTrip<T extends z.ZodTypeAny>(
  listSchema: T,
  itemArb: fc.Arbitrary<unknown>,
): void {
  fc.assert(
    fc.property(fc.array(itemArb, { minLength: 0, maxLength: 5 }), (items) => {
      assertRoundTrip(listSchema, items);
    }),
    { numRuns: 20 },
  );
}

// ─── Entity arbitraries ───

const arbIncome = fc.record({
  id: arbId,
  name: fc.string({ minLength: 1, maxLength: 200 }),
  amount: arbPosAmount,
  frequency: arbFrequency,
  budgetId: arbId,
  accountId: arbNullableId,
  amountSchedule: fc.option(
    fc.dictionary(fc.string({ minLength: 1, maxLength: 10 }), arbMoney, { minKeys: 0, maxKeys: 3 }),
    { nil: null },
  ),
  startDate: arbNullableDate,
  endDate: arbNullableDate,
  pausedUntil: arbNullableDate,
  archivedAt: arbNullableDate,
  note: arbNullableString,
  managementUrl: arbNullableUrl,
  createdAt: arbDate,
  updatedAt: arbDate,
});

const arbExpense = fc.record({
  id: arbId,
  name: fc.string({ minLength: 1, maxLength: 200 }),
  amount: arbMoney,
  frequency: arbFrequency,
  budgetId: arbId,
  accountId: arbNullableId,
  isAutomatic: fc.boolean(),
  skipWeekend: fc.boolean(),
  dueDay: fc.option(fc.integer({ min: 1, max: 31 }), { nil: null }),
  dueWeekday: fc.option(fc.integer({ min: 0, max: 6 }), { nil: null }),
  dueOrdinal: fc.option(fc.integer({ min: -1, max: 4 }), { nil: null }),
  amountSchedule: fc.option(
    fc.dictionary(fc.string({ minLength: 1, maxLength: 10 }), arbMoney, { minKeys: 0, maxKeys: 3 }),
    { nil: null },
  ),
  startDate: arbNullableDate,
  endDate: arbNullableDate,
  pausedUntil: arbNullableDate,
  archivedAt: arbNullableDate,
  note: arbNullableString,
  linkedDebtId: arbNullableId,
  managementUrl: arbNullableUrl,
  isLinkedToBudget: fc.boolean(),
  createdAt: arbDate,
  updatedAt: arbDate,
});

const arbTransaction = fc.record({
  id: arbId,
  type: arbTransactionType,
  name: fc.string({ minLength: 0, maxLength: 200 }),
  amount: arbSignedMoney,
  date: arbDate,
  payPeriodId: arbNullableId,
  expenseId: arbNullableId,
  incomeId: arbNullableId,
  accountId: arbId,
  toAccountId: arbNullableId,
  budgetId: arbNullableId,
  note: arbNullableString,
  tradeMetadata: fc.constant(null),
  netAmount: arbSignedMoney,
  createdAt: arbDate,
});

const arbInterestRateType = fc.constantFrom('APY', 'APR');

const arbAccount = fc.record({
  id: arbId,
  name: fc.string({ minLength: 1, maxLength: 100 }),
  type: arbAccountType,
  balance: arbSignedMoney,
  openingBalance: arbSignedMoney,
  archived: fc.boolean(),
  hasRewards: fc.boolean(),
  parentAccountId: arbNullableId,
  earnsInterest: fc.boolean(),
  interestRate: fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true }),
  interestRateType: arbInterestRateType,
  createdAt: arbDate,
  updatedAt: arbDate,
});

const arbCategory = fc.record({
  id: arbId,
  name: fc.string({ minLength: 1, maxLength: 100 }),
  groupId: arbId,
  groupName: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
  groupColor: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
  icon: arbNullableString,
  isCustom: fc.boolean(),
  isSystem: fc.boolean(),
  createdAt: arbDate,
});

const arbDebt = fc.record({
  id: arbId,
  name: fc.string({ minLength: 1, maxLength: 200 }),
  type: arbDebtType,
  originalBalance: arbMoney,
  currentBalance: arbMoney,
  apr: fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true }),
  minimumPayment: arbMoney,
  frequency: arbFrequency,
  startDate: arbDate,
  maturityDate: arbNullableDate,
  termMonths: fc.option(fc.integer({ min: 1, max: 600 }), { nil: null }),
  linkedExpenseId: arbNullableId,
  linkedAccountId: arbNullableId,
  paidOff: fc.boolean(),
  escrowEnabled: fc.boolean(),
  note: arbNullableString,
  managementUrl: arbNullableUrl,
  createdAt: arbDate,
  updatedAt: arbDate,
  monthlyPayment: arbMoney,
});

const arbBudgetGoal = fc.record({
  id: arbId,
  name: fc.string({ minLength: 1, maxLength: 200 }),
  type: arbGoalType,
  targetAmount: arbPosAmount,
  currentAmount: arbMoney,
  budgetId: arbNullableId,
  deadline: arbNullableDate,
  createdAt: arbDate,
  updatedAt: arbDate,
});

const arbInvestmentHolding = fc.record({
  id: arbId,
  name: fc.string({ minLength: 1, maxLength: 200 }),
  ticker: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: null }),
  type: arbInvestmentType,
  quantity: arbMoney,
  costBasis: arbNullableMoney,
  custodianId: arbNullableId,
  walletId: arbNullableId,
  createdAt: arbDate,
  updatedAt: arbDate,
});

const arbInvestmentSnapshot = fc.record({
  id: arbId,
  holdingId: arbId,
  date: arbDate,
  quantity: arbMoney,
  value: arbNullableMoney,
  createdAt: arbDate,
});

const arbInvestmentHoldingWithSnapshot = fc.record({
  id: arbId,
  name: fc.string({ minLength: 1, maxLength: 200 }),
  ticker: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: null }),
  type: arbInvestmentType,
  quantity: arbMoney,
  costBasis: arbNullableMoney,
  custodianId: arbNullableId,
  walletId: arbNullableId,
  createdAt: arbDate,
  updatedAt: arbDate,
  custodianName: arbNullableString,
  walletName: arbNullableString,
  latestSnapshot: fc.option(arbInvestmentSnapshot, { nil: null }),
});

const arbCustodian = fc.record({
  id: arbId,
  name: fc.string({ minLength: 1, maxLength: 100 }),
  managementUrl: arbNullableUrl,
  createdAt: arbDate,
  updatedAt: arbDate,
});

const arbCustodyType = fc.constantFrom('CUSTODIAL', 'NON_CUSTODIAL');
const arbStorageType = fc.constantFrom('HOT', 'COLD');

const arbWallet = fc.record({
  id: arbId,
  name: fc.string({ minLength: 1, maxLength: 100 }),
  custodyType: arbCustodyType,
  storageType: fc.option(arbStorageType, { nil: null }),
  managementUrl: arbNullableUrl,
  createdAt: arbDate,
  updatedAt: arbDate,
});

const arbUtilityReading = fc.record({
  id: arbId,
  serviceId: arbId,
  billDate: arbDate,
  dueDate: arbNullableDate,
  usage: arbNullableMoney,
  cost: arbMoney,
  unitCost: arbNullableMoney,
  convenienceFee: arbNullableMoney,
  convenienceFeeType: arbNullableString,
  otherFees: arbNullableMoney,
  details: fc.option(
    fc.dictionary(
      fc.string({ minLength: 1, maxLength: 10 }),
      fc.oneof(
        fc.string(),
        fc.double({ noNaN: true, noDefaultInfinity: true }),
        fc.boolean(),
        fc.constant(null),
      ),
      { minKeys: 0, maxKeys: 3 },
    ),
    { nil: null },
  ),
  createdAt: arbDate,
});

const arbPaySchedule = fc.record({
  id: arbId,
  name: fc.string({ minLength: 1, maxLength: 100 }),
  type: arbPayScheduleType,
  anchorDate: arbDate,
  firstPayDay: fc.option(fc.integer({ min: 1, max: 31 }), { nil: null }),
  secondPayDay: fc.option(fc.integer({ min: 1, max: 31 }), { nil: null }),
  isDefault: fc.boolean(),
  createdAt: arbDate,
  updatedAt: arbDate,
});

const arbPayPeriod = fc.record({
  id: arbId,
  scheduleId: arbId,
  startDate: arbDate,
  endDate: arbDate,
  payDate: arbDate,
  year: fc.integer({ min: 2000, max: 2100 }),
  periodNum: fc.integer({ min: 1, max: 52 }),
});

const arbCategoryGroup = fc.record({
  id: arbId,
  name: fc.string({ minLength: 1, maxLength: 50 }),
  color: fc.string({ minLength: 1, maxLength: 20 }),
  createdAt: arbDate,
});

// ─── Dashboard arbitraries ───

const arbBalanceSnapshot = fc.record({
  accountId: arbId,
  openingBalance: arbSignedMoney,
  closingBalance: arbSignedMoney,
  totalIncome: arbMoney,
  totalExpenses: arbMoney,
  accountName: arbName,
});

const arbIncomeLineItem = fc.record({
  id: arbId,
  name: fc.string({ minLength: 1, maxLength: 200 }),
  amount: arbPosAmount,
  frequency: arbFrequency,
  budgetId: arbId,
  actualAmount: fc.option(arbSignedMoney, { nil: null }),
  anticipationStatus: fc.option(fc.constantFrom('DUE', 'OVERDUE', 'PAID', 'UPCOMING'), {
    nil: null,
  }),
  anticipationId: arbNullableId,
});

const arbExpenseLineItem = fc.record({
  id: arbId,
  name: fc.string({ minLength: 1, maxLength: 200 }),
  amount: arbMoney,
  frequency: arbFrequency,
  budgetId: arbId,
  accountId: arbNullableId,
  isAutomatic: fc.boolean(),
  dueDay: fc.option(fc.integer({ min: 1, max: 31 }), { nil: null }),
  actualAmount: fc.option(arbSignedMoney, { nil: null }),
  isPaid: fc.boolean(),
  paidDate: arbNullableDate,
  expenseType: fc.constantFrom('cash', 'credit'),
  anticipationStatus: fc.option(fc.constantFrom('DUE', 'OVERDUE', 'PAID', 'UPCOMING'), {
    nil: null,
  }),
  anticipationId: arbNullableId,
});

const arbCurrentPeriod = fc.record({
  payPeriod: arbPayPeriod,
  schedule: arbPaySchedule,
  totalIncome: arbSignedMoney,
  totalExpenses: arbSignedMoney,
  netIncome: arbSignedMoney,
  incomeItems: fc.array(arbIncomeLineItem, { minLength: 0, maxLength: 3 }),
  expenseItems: fc.array(arbExpenseLineItem, { minLength: 0, maxLength: 3 }),
  balances: fc.array(arbBalanceSnapshot, { minLength: 0, maxLength: 3 }),
  cashFlowSummary: fc.record({
    totalIncome: arbSignedMoney,
    totalExpenses: arbSignedMoney,
    netCashFlow: arbSignedMoney,
    cashExpenses: arbSignedMoney,
    creditExpenses: arbSignedMoney,
    previousPeriodCreditExpenses: arbSignedMoney,
    cashNeeded: arbSignedMoney,
    creditCardPayments: arbSignedMoney,
  }),
});

const arbCategoryGroupName = fc.string({ minLength: 1, maxLength: 50 });

const arbYTDCategoryBreakdown = fc.record({
  budgetId: arbId,
  categoryName: arbName,
  group: arbCategoryGroupName,
  total: arbSignedMoney,
});

const arbYTD = fc.record({
  year: fc.integer({ min: 2000, max: 2100 }),
  startDate: arbDate,
  endDate: arbDate,
  totalIncome: arbSignedMoney,
  totalExpenses: arbSignedMoney,
  netIncome: arbSignedMoney,
  byCategory: fc.array(arbYTDCategoryBreakdown, { minLength: 0, maxLength: 3 }),
});

const arbTrendsDataPoint = fc.record({
  periodLabel: fc.string({ minLength: 1, maxLength: 20 }),
  payDate: arbDate,
  income: arbSignedMoney,
  expenses: arbSignedMoney,
  net: arbSignedMoney,
});

const arbTrends = fc.array(arbTrendsDataPoint, { minLength: 0, maxLength: 5 });

const arbCategoryBreakdownItem = fc.record({
  budgetId: arbId,
  categoryName: arbName,
  group: arbCategoryGroupName,
  color: arbNullableString,
  total: arbSignedMoney,
  percentage: fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true }),
  transactionCount: fc.integer({ min: 0, max: 10000 }),
});

const arbCategoryBreakdown = fc.array(arbCategoryBreakdownItem, { minLength: 0, maxLength: 5 });

const arbGoalProgress = fc.record({
  id: arbId,
  name: fc.string({ minLength: 1, maxLength: 200 }),
  type: arbGoalType,
  targetAmount: arbPosAmount,
  currentAmount: arbMoney,
  budgetId: arbNullableId,
  deadline: arbNullableDate,
  createdAt: arbDate,
  updatedAt: arbDate,
  percentComplete: fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true }),
  remaining: arbMoney,
});

const arbGoalProgressList = fc.array(arbGoalProgress, { minLength: 0, maxLength: 5 });

// ═══════════════════════════════════════════════════════════════════════════════
// Property 1: Response Schema JSON Round-Trip
// ═══════════════════════════════════════════════════════════════════════════════

describe('Feature: runtime-safety, Property 1: Response Schema JSON Round-Trip', () => {
  /**
   * **Validates: Requirements 6.5, 6.1**
   *
   * For any valid object conforming to a domain entity Response Schema,
   * serializing to JSON via JSON.stringify and then parsing with JSON.parse
   * followed by schema.parse() SHALL produce an object deeply equal to the
   * original parsed object.
   */

  // ─── Income ───

  it('IncomeResponseSchema round-trips through JSON', () => {
    fc.assert(
      fc.property(arbIncome, (obj) => {
        assertRoundTrip(IncomeResponseSchema, obj);
      }),
      { numRuns: 20 },
    );
  });

  it('IncomeListResponseSchema round-trips through JSON', () => {
    assertListRoundTrip(IncomeListResponseSchema, arbIncome);
  });

  // ─── Expense ───

  it('ExpenseResponseSchema round-trips through JSON', () => {
    fc.assert(
      fc.property(arbExpense, (obj) => {
        assertRoundTrip(ExpenseResponseSchema, obj);
      }),
      { numRuns: 20 },
    );
  });

  it('ExpenseListResponseSchema round-trips through JSON', () => {
    assertListRoundTrip(ExpenseListResponseSchema, arbExpense);
  });

  // ─── Transaction ───

  it('TransactionResponseSchema round-trips through JSON', () => {
    fc.assert(
      fc.property(arbTransaction, (obj) => {
        assertRoundTrip(TransactionResponseSchema, obj);
      }),
      { numRuns: 20 },
    );
  });

  it('TransactionListResponseSchema round-trips through JSON', () => {
    assertListRoundTrip(TransactionListResponseSchema, arbTransaction);
  });

  // ─── Account ───

  it('AccountResponseSchema round-trips through JSON', () => {
    fc.assert(
      fc.property(arbAccount, (obj) => {
        assertRoundTrip(AccountResponseSchema, obj);
      }),
      { numRuns: 20 },
    );
  });

  it('AccountListResponseSchema round-trips through JSON', () => {
    assertListRoundTrip(AccountListResponseSchema, arbAccount);
  });

  // ─── BudgetItem ───

  it('BudgetItemResponseSchema round-trips through JSON', () => {
    fc.assert(
      fc.property(arbCategory, (obj) => {
        assertRoundTrip(BudgetItemResponseSchema, obj);
      }),
      { numRuns: 20 },
    );
  });

  it('BudgetItemListResponseSchema round-trips through JSON', () => {
    assertListRoundTrip(BudgetItemListResponseSchema, arbCategory);
  });

  // ─── Debt ───

  it('DebtResponseSchema round-trips through JSON', () => {
    fc.assert(
      fc.property(arbDebt, (obj) => {
        assertRoundTrip(DebtResponseSchema, obj);
      }),
      { numRuns: 20 },
    );
  });

  it('DebtListResponseSchema round-trips through JSON', () => {
    assertListRoundTrip(DebtListResponseSchema, arbDebt);
  });

  // ─── BudgetGoal ───

  it('BudgetGoalResponseSchema round-trips through JSON', () => {
    fc.assert(
      fc.property(arbBudgetGoal, (obj) => {
        assertRoundTrip(BudgetGoalResponseSchema, obj);
      }),
      { numRuns: 20 },
    );
  });

  it('BudgetGoalListResponseSchema round-trips through JSON', () => {
    assertListRoundTrip(BudgetGoalListResponseSchema, arbBudgetGoal);
  });

  // ─── InvestmentHolding ───

  it('InvestmentHoldingResponseSchema round-trips through JSON', () => {
    fc.assert(
      fc.property(arbInvestmentHolding, (obj) => {
        assertRoundTrip(InvestmentHoldingResponseSchema, obj);
      }),
      { numRuns: 20 },
    );
  });

  it('InvestmentHoldingListResponseSchema round-trips through JSON', () => {
    assertListRoundTrip(InvestmentHoldingListResponseSchema, arbInvestmentHoldingWithSnapshot);
  });

  // ─── Custodian ───

  it('CustodianResponseSchema round-trips through JSON', () => {
    fc.assert(
      fc.property(arbCustodian, (obj) => {
        assertRoundTrip(CustodianResponseSchema, obj);
      }),
      { numRuns: 20 },
    );
  });

  it('CustodianListResponseSchema round-trips through JSON', () => {
    assertListRoundTrip(CustodianListResponseSchema, arbCustodian);
  });

  // ─── Wallet ───

  it('WalletResponseSchema round-trips through JSON', () => {
    fc.assert(
      fc.property(arbWallet, (obj) => {
        assertRoundTrip(WalletResponseSchema, obj);
      }),
      { numRuns: 20 },
    );
  });

  it('WalletListResponseSchema round-trips through JSON', () => {
    assertListRoundTrip(WalletListResponseSchema, arbWallet);
  });

  // ─── UtilityReading ───

  it('UtilityReadingResponseSchema round-trips through JSON', () => {
    fc.assert(
      fc.property(arbUtilityReading, (obj) => {
        assertRoundTrip(UtilityReadingResponseSchema, obj);
      }),
      { numRuns: 20 },
    );
  });

  it('UtilityReadingListResponseSchema round-trips through JSON', () => {
    assertListRoundTrip(UtilityReadingListResponseSchema, arbUtilityReading);
  });

  // ─── HealthcareYear ───
  // NOTE: HealthcareYearResponseSchema/HealthcareYearListResponseSchema
  // do not exist in core schemas — healthcare years use raw Prisma types.
  // These round-trip tests are skipped until response schemas are created.

  // ─── PaySchedule ───

  it('PayScheduleResponseSchema round-trips through JSON', () => {
    fc.assert(
      fc.property(arbPaySchedule, (obj) => {
        assertRoundTrip(PayScheduleResponseSchema, obj);
      }),
      { numRuns: 20 },
    );
  });

  // ─── PayPeriod ───

  it('PayPeriodResponseSchema round-trips through JSON', () => {
    fc.assert(
      fc.property(arbPayPeriod, (obj) => {
        assertRoundTrip(PayPeriodResponseSchema, obj);
      }),
      { numRuns: 20 },
    );
  });

  // ─── Dashboard: CurrentPeriod ───

  it('CurrentPeriodResponseSchema round-trips through JSON', () => {
    fc.assert(
      fc.property(arbCurrentPeriod, (obj) => {
        assertRoundTrip(CurrentPeriodResponseSchema, obj);
      }),
      { numRuns: 20 },
    );
  });

  // ─── Dashboard: YTD ───

  it('YTDResponseSchema round-trips through JSON', () => {
    fc.assert(
      fc.property(arbYTD, (obj) => {
        assertRoundTrip(YTDResponseSchema, obj);
      }),
      { numRuns: 20 },
    );
  });

  // ─── Dashboard: Trends ───

  it('TrendsResponseSchema round-trips through JSON', () => {
    fc.assert(
      fc.property(arbTrends, (obj) => {
        assertRoundTrip(TrendsResponseSchema, obj);
      }),
      { numRuns: 20 },
    );
  });

  // ─── Dashboard: BudgetBreakdown ───

  it('BudgetBreakdownResponseSchema round-trips through JSON', () => {
    fc.assert(
      fc.property(arbCategoryBreakdown, (obj) => {
        assertRoundTrip(BudgetBreakdownResponseSchema, obj);
      }),
      { numRuns: 20 },
    );
  });

  // ─── Dashboard: GoalProgress ───

  it('GoalProgressResponseSchema round-trips through JSON', () => {
    fc.assert(
      fc.property(arbGoalProgressList, (obj) => {
        assertRoundTrip(GoalProgressResponseSchema, obj);
      }),
      { numRuns: 20 },
    );
  });

  // ─── BudgetGroup ───

  it('BudgetGroupResponseSchema round-trips through JSON', () => {
    fc.assert(
      fc.property(arbCategoryGroup, (obj) => {
        assertRoundTrip(BudgetGroupResponseSchema, obj);
      }),
      { numRuns: 20 },
    );
  });
});
