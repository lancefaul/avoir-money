import { createRouter, createRoute, createRootRoute } from '@tanstack/react-router';
import Layout from './components/Layout.js';
import PageErrorBoundary from './components/PageErrorBoundary.js';
import Dashboard from './pages/Dashboard.js';
import RecurringPage from './pages/Recurring.js';
import TransactionsPage from './pages/Transactions.js';
import AccountsPage from './pages/Accounts.js';
import UtilitiesPage from './pages/Utilities.js';
import HealthcarePage from './pages/Healthcare.js';
import InvestmentsPage from './pages/Investments.js';
import BudgetsPage from './pages/Budgets.js';
import DebtsPage from './pages/Debts.js';
import SettingsPage from './pages/Settings.js';

function withErrorBoundary(Page: React.ComponentType, pageName: string) {
  return function WrappedPage() {
    return (
      <PageErrorBoundary pageName={pageName}>
        <Page />
      </PageErrorBoundary>
    );
  };
}

const rootRoute = createRootRoute({ component: Layout });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: withErrorBoundary(Dashboard, 'Dashboard'),
});
const recurringRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/recurring',
  component: withErrorBoundary(RecurringPage, 'Recurring'),
});
const transactionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/transactions',
  // `?purchase=<groupId>` scopes the list to one payment-split purchase — the
  // "Manage purchase" deep-link from a split leg on the account ledger.
  validateSearch: (search: Record<string, unknown>): { purchase?: string } => ({
    purchase: typeof search.purchase === 'string' ? search.purchase : undefined,
  }),
  component: withErrorBoundary(TransactionsPage, 'Transactions'),
});
const accountsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/accounts',
  component: withErrorBoundary(AccountsPage, 'Accounts'),
});
const utilitiesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/utilities',
  component: withErrorBoundary(UtilitiesPage, 'Utilities'),
});
const healthcareRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/healthcare',
  component: withErrorBoundary(HealthcarePage, 'Healthcare'),
});
const investmentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/investments',
  component: withErrorBoundary(InvestmentsPage, 'Investments'),
});
const budgetsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/budgets',
  component: withErrorBoundary(BudgetsPage, 'Budgets'),
});
const debtsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/debts',
  component: withErrorBoundary(DebtsPage, 'Debts'),
});
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: withErrorBoundary(SettingsPage, 'Settings'),
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  recurringRoute,
  transactionsRoute,
  accountsRoute,
  utilitiesRoute,
  healthcareRoute,
  investmentsRoute,
  debtsRoute,
  budgetsRoute,
  settingsRoute,
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
