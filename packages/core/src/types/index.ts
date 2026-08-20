import type { z } from 'zod';
import type {
  AccountSchema,
  AccountTypeSchema,
  AnticipationSchema,
  BalanceSnapshotSchema,
  BudgetGoalSchema,
  BudgetBreakdownItemSchema,
  BudgetGroupSchema,
  BudgetItemSchema,
  CreateAccountSchema,
  CreateBalanceSnapshotSchema,
  CreateBudgetGoalSchema,
  CreateExpenseSchema,
  CreateInsurancePolicySchema,
  PolicyTypeSchema,
  PolicyStatusSchema,
  CreateIncomeSchema,
  CreateInvestmentHoldingSchema,
  CreateInvestmentSnapshotSchema,
  CreatePayScheduleSchema,
  CreateTransactionSchema,
  CreateUtilityProviderSchema,
  CreateUtilityServiceSchema,
  CreateUtilityReadingSchema,
  CurrentPeriodSummarySchema,
  ExpenseSchema,
  FrequencySchema,
  GoalProgressSchema,
  IncomeSchema,
  GoalTypeSchema,
  HealthcareTransactionSchema,
  InsurancePolicySchema,
  InsurancePolicyWithBalanceSchema,
  InvestmentHoldingSchema,
  InvestmentHoldingWithSnapshotSchema,
  InvestmentSnapshotSchema,
  InvestmentTypeSchema,
  LinkRequestSchema,
  MarkScheduledPaidRequestSchema,
  MarkAsPaidRequestSchema,
  MedicalMetadataSchema,
  DentalMetadataSchema,
  VisionMetadataSchema,
  PolicyMetadataSchema,
  MeteringSchema,
  PayPeriodSchema,
  PayScheduleSchema,
  PayScheduleTypeSchema,
  ScheduledTransactionSchema,
  ScheduledTransactionsQuerySchema,
  ScheduleSourceTypeEnum,
  ScheduleStatusEnum,
  ServiceTypeSchema,
  SnoozeRequestSchema,
  SnoozeScheduledRequestSchema,
  TrendsDataPointSchema,
  TransactionSchema,
  UpdateAccountSchema,
  UpdateBudgetGoalSchema,
  UpdateExpenseSchema,
  PolicyBalanceSchema,
  PolicyYearsSchema,
  UpdateInsurancePolicySchema,
  UpdateOverridesSchema,
  UpdateIncomeSchema,
  UpdateInvestmentHoldingSchema,
  UpdatePayScheduleSchema,
  UpdateTransactionSchema,
  UpdateUtilityProviderSchema,
  UpdateUtilityServiceSchema,
  UpdateUtilityReadingSchema,
  UtilityProviderSchema,
  UtilityServiceSchema,
  UtilityReadingSchema,
  YTDSummarySchema,
  AccountBrandSchema,
} from '../schemas/index.js';

// ─── Enums ───
export type Frequency = z.infer<typeof FrequencySchema>;
export type AccountType = z.infer<typeof AccountTypeSchema>;
export type BudgetGroup = z.infer<typeof BudgetGroupSchema>;
/** @deprecated Use BudgetGroup */
export type CategoryGroup = BudgetGroup;
export type PayScheduleType = z.infer<typeof PayScheduleTypeSchema>;
export type ServiceType = z.infer<typeof ServiceTypeSchema>;
export type Metering = z.infer<typeof MeteringSchema>;
export type InvestmentType = z.infer<typeof InvestmentTypeSchema>;
export type GoalType = z.infer<typeof GoalTypeSchema>;
export type PolicyType = z.infer<typeof PolicyTypeSchema>;
export type PolicyStatus = z.infer<typeof PolicyStatusSchema>;
export type MedicalMetadata = z.infer<typeof MedicalMetadataSchema>;
export type DentalMetadata = z.infer<typeof DentalMetadataSchema>;
export type VisionMetadata = z.infer<typeof VisionMetadataSchema>;
export type PolicyMetadata = z.infer<typeof PolicyMetadataSchema>;

// ─── Entities ───
export type Account = z.infer<typeof AccountSchema>;
export type BudgetItem = z.infer<typeof BudgetItemSchema>;
/** @deprecated Use BudgetItem */
export type Category = BudgetItem;
export type Income = z.infer<typeof IncomeSchema>;
export type Expense = z.infer<typeof ExpenseSchema>;
export type Transaction = z.infer<typeof TransactionSchema>;
export type PaySchedule = z.infer<typeof PayScheduleSchema>;
export type PayPeriod = z.infer<typeof PayPeriodSchema>;
export type BalanceSnapshot = z.infer<typeof BalanceSnapshotSchema>;
export type UtilityProvider = z.infer<typeof UtilityProviderSchema>;
export type UtilityService = z.infer<typeof UtilityServiceSchema>;
export type UtilityReading = z.infer<typeof UtilityReadingSchema>;
export type InsurancePolicy = z.infer<typeof InsurancePolicySchema>;
export type InsurancePolicyWithBalance = z.infer<typeof InsurancePolicyWithBalanceSchema>;
export type HealthcareTransaction = z.infer<typeof HealthcareTransactionSchema>;
export type PolicyBalance = z.infer<typeof PolicyBalanceSchema>;
export type PolicyYears = z.infer<typeof PolicyYearsSchema>;
export type InvestmentHolding = z.infer<typeof InvestmentHoldingSchema>;
export type InvestmentSnapshot = z.infer<typeof InvestmentSnapshotSchema>;
export type InvestmentHoldingWithSnapshot = z.infer<typeof InvestmentHoldingWithSnapshotSchema>;
export type BudgetGoal = z.infer<typeof BudgetGoalSchema>;

// ─── Create inputs ───
export type CreateAccount = z.infer<typeof CreateAccountSchema>;
export type CreateIncome = z.infer<typeof CreateIncomeSchema>;
export type CreateExpense = z.infer<typeof CreateExpenseSchema>;
export type CreateTransaction = z.infer<typeof CreateTransactionSchema>;
export type CreatePaySchedule = z.infer<typeof CreatePayScheduleSchema>;
export type CreateBalanceSnapshot = z.infer<typeof CreateBalanceSnapshotSchema>;
export type CreateUtilityProvider = z.infer<typeof CreateUtilityProviderSchema>;
export type CreateUtilityService = z.infer<typeof CreateUtilityServiceSchema>;
export type CreateUtilityReading = z.infer<typeof CreateUtilityReadingSchema>;
export type CreateInsurancePolicy = z.infer<typeof CreateInsurancePolicySchema>;
export type CreateInvestmentHolding = z.infer<typeof CreateInvestmentHoldingSchema>;
export type CreateInvestmentSnapshot = z.infer<typeof CreateInvestmentSnapshotSchema>;
export type CreateBudgetGoal = z.infer<typeof CreateBudgetGoalSchema>;

// ─── Update inputs ───
export type UpdateAccount = z.infer<typeof UpdateAccountSchema>;
export type UpdateIncome = z.infer<typeof UpdateIncomeSchema>;
export type UpdateExpense = z.infer<typeof UpdateExpenseSchema>;
export type UpdateTransaction = z.infer<typeof UpdateTransactionSchema>;
export type UpdatePaySchedule = z.infer<typeof UpdatePayScheduleSchema>;
export type UpdateUtilityProvider = z.infer<typeof UpdateUtilityProviderSchema>;
export type UpdateUtilityService = z.infer<typeof UpdateUtilityServiceSchema>;
export type UpdateUtilityReading = z.infer<typeof UpdateUtilityReadingSchema>;
export type UpdateInsurancePolicy = z.infer<typeof UpdateInsurancePolicySchema>;
export type UpdateOverrides = z.infer<typeof UpdateOverridesSchema>;
export type UpdateInvestmentHolding = z.infer<typeof UpdateInvestmentHoldingSchema>;
export type UpdateBudgetGoal = z.infer<typeof UpdateBudgetGoalSchema>;

// ─── Dashboard ───
export type CurrentPeriodSummary = z.infer<typeof CurrentPeriodSummarySchema>;
export type YTDSummary = z.infer<typeof YTDSummarySchema>;
export type TrendsDataPoint = z.infer<typeof TrendsDataPointSchema>;
export type BudgetBreakdownItem = z.infer<typeof BudgetBreakdownItemSchema>;
/** @deprecated Use BudgetBreakdownItem */
export type CategoryBreakdownItem = BudgetBreakdownItem;
export type GoalProgress = z.infer<typeof GoalProgressSchema>;

// ─── Anticipations (legacy — retained for backward compat) ───
export type Anticipation = z.infer<typeof AnticipationSchema>;
export type MarkAsPaidRequest = z.infer<typeof MarkAsPaidRequestSchema>;
export type SnoozeRequest = z.infer<typeof SnoozeRequestSchema>;
export type LinkRequest = z.infer<typeof LinkRequestSchema>;

// ─── Scheduled Transactions ───
export type ScheduledTransaction = z.infer<typeof ScheduledTransactionSchema>;
export type ScheduledTransactionsQuery = z.infer<typeof ScheduledTransactionsQuerySchema>;
export type ScheduleStatus = z.infer<typeof ScheduleStatusEnum>;
export type ScheduleSourceType = z.infer<typeof ScheduleSourceTypeEnum>;
export type MarkScheduledPaidRequest = z.infer<typeof MarkScheduledPaidRequestSchema>;
export type SnoozeScheduledRequest = z.infer<typeof SnoozeScheduledRequestSchema>;
export type AccountBrand = z.infer<typeof AccountBrandSchema>;
