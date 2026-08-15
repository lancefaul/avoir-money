import { z } from 'zod';
import { BudgetGroupSchema } from './enums.js';
import { ExpenseSchema } from './expense.js';
import { BudgetGoalSchema } from './goal.js';
import { IncomeSchema } from './income.js';
import { BalanceSnapshotSchema, PayPeriodSchema, PayScheduleSchema } from './pay-schedule.js';

// Display status enum — extends ScheduleStatus with display-only values (DUE, OVERDUE, UPCOMING)
const DisplayStatusEnum = z.enum([
  'DUE',
  'OVERDUE',
  'PAID',
  'PARTIAL',
  'SNOOZED',
  'SKIPPED',
  'UPCOMING',
]);

// ─── Current Pay Period Summary ───

const IncomeLineItem = IncomeSchema.pick({
  id: true,
  name: true,
  amount: true,
  frequency: true,
  budgetId: true,
}).extend({
  /** Actual recorded amount for this period (null if not yet recorded) */
  actualAmount: z.number().nullable(),
  anticipationStatus: DisplayStatusEnum.nullable(),
  anticipationId: z.string().nullable(),
});

const ExpenseLineItem = ExpenseSchema.pick({
  id: true,
  name: true,
  amount: true,
  frequency: true,
  budgetId: true,
  accountId: true,
  isAutomatic: true,
  dueDay: true,
}).extend({
  /** Actual recorded amount for this period (null if not yet paid) */
  actualAmount: z.number().nullable(),
  isPaid: z.boolean(),
  anticipationStatus: DisplayStatusEnum.nullable(),
  anticipationId: z.string().nullable(),
  /** Actual date the transaction was paid (null if not yet paid) */
  paidDate: z.coerce.date().nullable(),
  /**
   * Whether this expense draws down cash now, is deferred to a credit-card
   * payment, or is 'excluded' from both cards (HSA — trapped, medical-only cash).
   */
  expenseType: z.enum(['cash', 'credit', 'excluded']),
});

// ─── Cash Flow Summary ───

export const CashFlowSummarySchema = z.object({
  cashExpenses: z.number(),
  creditExpenses: z.number(),
  previousPeriodCreditExpenses: z.number(),
  previousPeriodBankBalance: z.number().default(0),
  /** Previous period's closing Checking balance (the combined bank total split out). */
  previousPeriodCheckingBalance: z.number().default(0),
  /** Previous period's closing Savings balance. */
  previousPeriodSavingsBalance: z.number().default(0),
  /** Actual cash purchases this period not tied to a recurring/one-time expense. */
  adHocCashSpending: z.number().default(0),
  cashNeeded: z.number(),
  creditCardPayments: z.number(),
});

const AccountBalance = BalanceSnapshotSchema.pick({
  accountId: true,
  openingBalance: true,
  closingBalance: true,
  totalIncome: true,
  totalExpenses: true,
}).extend({
  accountName: z.string(),
});

export const CurrentPeriodSummarySchema = z.object({
  payPeriod: PayPeriodSchema,
  schedule: PayScheduleSchema,
  totalIncome: z.number(),
  totalExpenses: z.number(),
  netIncome: z.number(),
  incomeItems: z.array(IncomeLineItem),
  expenseItems: z.array(ExpenseLineItem),
  balances: z.array(AccountBalance),
  cashFlowSummary: CashFlowSummarySchema,
});

// ─── YTD Summary ───

const YTDCategoryBreakdown = z.object({
  budgetId: z.string(),
  categoryName: z.string(),
  group: BudgetGroupSchema,
  total: z.number(),
});

export const YTDSummarySchema = z.object({
  year: z.number().int(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  totalIncome: z.number(),
  totalExpenses: z.number(),
  netIncome: z.number(),
  byCategory: z.array(YTDCategoryBreakdown),
});

export const YTDQuerySchema = z.object({
  year: z.coerce.number().int().optional(),
  scheduleId: z.string().optional(),
});

// ─── Trends (income vs. expenses over time) ───

export const TrendsDataPointSchema = z.object({
  periodLabel: z.string(), // e.g. "Mar 6", "Mar 20"
  payDate: z.coerce.date(),
  income: z.number(),
  expenses: z.number(),
  net: z.number(),
});

export const TrendsSummarySchema = z.array(TrendsDataPointSchema);

export const TrendsQuerySchema = z.object({
  scheduleId: z.string().optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  /** Number of most-recent periods to return (default 13 = ~6 months biweekly) */
  periods: z.coerce.number().int().positive().max(52).default(13),
});

// ─── Budget Breakdown ───

export const BudgetBreakdownItemSchema = z.object({
  budgetId: z.string(),
  categoryName: z.string(),
  group: BudgetGroupSchema,
  color: z.string().nullable(),
  total: z.number(),
  percentage: z.number().min(0).max(100),
  transactionCount: z.number().int().nonnegative(),
});

export const BudgetBreakdownSchema = z.array(BudgetBreakdownItemSchema);

export const BudgetBreakdownQuerySchema = z.object({
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  payPeriodId: z.string().optional(),
  group: BudgetGroupSchema.optional(),
});

// ─── Goal Progress ───

export const GoalProgressSchema = BudgetGoalSchema.extend({
  percentComplete: z.number().min(0).max(100),
  remaining: z.number().nonnegative(),
});

export const GoalProgressListSchema = z.array(GoalProgressSchema);

// ─── Dashboard query for current period ───

export const CurrentPeriodQuerySchema = z.object({
  scheduleId: z.string().optional(),
});

// ─── Income Trend ───

export const IncomeTrendDataPointSchema = z.object({
  periodLabel: z.string(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  income: z.number(),
  expenses: z.number(),
  trades: z.number(),
  budgetExpenses: z.number(),
  projected: z.boolean(),
});

export const IncomeTrendResponseSchema = z.array(IncomeTrendDataPointSchema);

export const IncomeTrendQuerySchema = z.object({
  scheduleId: z.string().optional(),
});

// ─── Spend Prediction ───

export const SpendPredictionDaySchema = z.object({
  dayNumber: z.number().int().positive(),
  date: z.coerce.date(),
  expectedCumulative: z.number(),
  actualCumulative: z.number().nullable(),
});

export const SpendPredictionResponseSchema = z.object({
  expectedPeriodSpend: z.number(),
  overUnderAmount: z.number(),
  periodStartDate: z.coerce.date(),
  periodEndDate: z.coerce.date(),
  currentDayNumber: z.number().int().positive(),
  totalDays: z.number().int().positive(),
  dailyData: z.array(SpendPredictionDaySchema),
});

export const SpendPredictionQuerySchema = z.object({
  scheduleId: z.string().optional(),
});

// ─── Response Schemas ───

export const CurrentPeriodResponseSchema = CurrentPeriodSummarySchema;
export const YTDResponseSchema = YTDSummarySchema;
export const TrendsResponseSchema = TrendsSummarySchema;
export const BudgetBreakdownResponseSchema = BudgetBreakdownSchema;
export const GoalProgressResponseSchema = GoalProgressListSchema;
