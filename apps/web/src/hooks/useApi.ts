// ─── Dashboard ───────────────────────────────────────────────────────────────
export { useCurrentPeriod, useYTD, useIncomeTrend } from './useDashboard.js';

// ─── Income ──────────────────────────────────────────────────────────────────
export {
  useIncome,
  useCreateIncome,
  useUpdateIncome,
  useDeleteIncome,
  useArchiveIncome,
  useRestoreIncome,
} from './useIncome.js';

// ─── Expenses ────────────────────────────────────────────────────────────────
export {
  useExpenses,
  useCreateExpense,
  useUpdateExpense,
  useDeleteExpense,
  useArchiveExpense,
  useRestoreExpense,
} from './useExpenses.js';

// ─── Budget Items ────────────────────────────────────────────────────────────
export {
  useBudgetItems,
  useBudgetItemGroups,
  useCreateBudgetItemGroup,
  useUpdateBudgetItemGroup,
  useDeleteBudgetItemGroup,
  useCreateBudgetItem,
  useUpdateBudgetItem,
  useDeleteBudgetItem,
  useReassignBudgetItem,
} from './useBudgetItems.js';

// ─── Accounts ────────────────────────────────────────────────────────────────
export { useAccounts } from './useAccounts.js';

// ─── Utilities ───────────────────────────────────────────────────────────────
export {
  useProviders,
  useCreateProvider,
  useUpdateProvider,
  useDeleteProvider,
  useServices,
  useCreateService,
  useUpdateService,
  useDeleteService,
  useLinkService,
  useUnlinkService,
  useUtilities,
  useCreateUtility,
  useUpdateUtility,
  useDeleteUtility,
} from './useUtilities.js';

// ─── Healthcare ──────────────────────────────────────────────────────────────
// Domain-specific hooks exported directly from ./useHealthcare.js
// (usePolicyYears, usePolicies, usePolicyTransactions, useCreatePolicy, etc.)

// ─── Investments ─────────────────────────────────────────────────────────────
export {
  useInvestments,
  useInvestmentPrices,
  useUpdateInvestment,
  useBitcoinTransfer,
  useStockTransfer,
  useDeleteHolding,
  useInvestmentHistory,
  usePortfolioHistory,
  useRegenerateSnapshots,
  useCustodians,
  useCreateCustodian,
  useUpdateCustodian,
  useDeleteCustodian,
  useWallets,
  useCreateWallet,
  useUpdateWallet,
  useDeleteWallet,
} from './useInvestments.js';

// ─── Debts ───────────────────────────────────────────────────────────────────
export {
  useDebts,
  useDebtSummary,
  useDebtAmortization,
  useCreateDebt,
  useUpdateDebt,
  useDeleteDebt,
  useEscrowHistory,
  useCreateEscrowRecord,
  useExtraPayment,
} from './useDebts.js';
export type { DebtRecord, AmortizationSchedule, EscrowRecord } from './useDebts.js';

// ─── Pay Schedules ───────────────────────────────────────────────────────────
export { usePaySchedules, useGeneratePeriods } from './usePaySchedules.js';
