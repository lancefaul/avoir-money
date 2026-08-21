import { dashboardApi } from './dashboard.js';
import { incomeApi } from './income.js';
import { expensesApi } from './expenses.js';
import { transactionsApi } from './transactions.js';
import { budgetItemsApi } from './budget-items.js';
import { accountsApi } from './accounts.js';
import { paySchedulesApi } from './pay-schedules.js';
import { utilitiesApi } from './utilities.js';
import { healthcareApi } from './healthcare.js';
import { investmentsApi } from './investments.js';
import { debtsApi } from './debts.js';
import { preferencesApi } from './preferences.js';
import { signConventionsApi } from './sign-conventions.js';
import { scheduledTransactionsApi } from './scheduled-transactions.js';
import { budgetsApi } from './budgets.js';
import { budgetLinksApi } from './budget-links.js';
import { descriptionsApi } from './descriptions.js';
import { backupsApi } from './backups.js';
import { connectedServicesApi } from './connected-services.js';
import { dataManagementApi } from './data-management.js';
import { reconciliationsApi } from './reconciliations.js';
import { purchasesApi } from './purchases.js';

export const api = {
  dashboard: dashboardApi,
  income: incomeApi,
  expenses: expensesApi,
  transactions: transactionsApi,
  budgetItems: budgetItemsApi,
  accounts: accountsApi,
  paySchedules: paySchedulesApi,
  utilities: utilitiesApi,
  healthcare: healthcareApi,
  investments: investmentsApi,
  debts: debtsApi,
  preferences: preferencesApi,
  signConventions: signConventionsApi,
  scheduledTransactions: scheduledTransactionsApi,
  budgets: budgetsApi,
  budgetLinks: budgetLinksApi,
  descriptions: descriptionsApi,
  backups: backupsApi,
  connectedServices: connectedServicesApi,
  dataManagement: dataManagementApi,
  reconciliations: reconciliationsApi,
  purchases: purchasesApi,
};

export { ApiValidationError } from './request.js';
