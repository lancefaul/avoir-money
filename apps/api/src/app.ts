import { createRouter } from './lib/errors.js';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { authMiddleware } from './middleware/auth.js';
import { rateLimitMiddleware } from './middleware/rate-limit.js';
import accountsRouter from './routes/accounts.js';
import budgetsRouter from './routes/budgets.js';
import incomeRouter from './routes/income.js';
import expensesRouter from './routes/expenses.js';
import expensesLifecycleRouter from './routes/expenses.lifecycle.js';
import transactionsRouter from './routes/transactions.js';
import transactionsChildrenRouter from './routes/transactions.children.js';
import transactionsLinkingRouter from './routes/transactions.linking.js';
import purchasesRouter from './routes/purchases.js';
import paySchedulesRouter from './routes/pay-schedules.js';
import payPeriodsRouter from './routes/pay-periods.js';
import { utilitiesProvidersRouter } from './routes/utilities.providers.js';
import { utilitiesReadingsRouter } from './routes/utilities.readings.js';
import healthcareRouter from './routes/healthcare.js';
import investmentsRouter from './routes/investments.js';
import investmentsHistoryRouter from './routes/investments.history.js';
import investmentsEntitiesRouter from './routes/investments.entities.js';
import investmentsTransfersRouter from './routes/investments.transfers.js';
import goalsRouter from './routes/goals.js';
import dashboardRouter from './routes/dashboard.js';
import signConventionsRouter from './routes/sign-conventions.js';
import debtsRouter from './routes/debts.js';
import escrowRouter from './routes/escrow.js';
import scheduledTransactionsRouter from './routes/scheduled-transactions.js';
import yearPlansRouter from './routes/year-plans.js';
import categoryBudgetsRouter from './routes/category-budgets.js';
import reconciliationsRouter from './routes/reconciliations.js';
import reconciliationsCloseRouter from './routes/reconciliations.close.js';
import reconciliationsMergeRouter from './routes/reconciliations.merge.js';
import budgetLinksRouter from './routes/budget-links.js';
import descriptionsRouter from './routes/descriptions.js';
import backupsRouter from './routes/backups.js';
import connectedServicesRouter from './routes/connected-services.js';
import dataManagementRouter from './routes/data-management.js';

// The hook lives in `lib/errors.js` beside the schema it produces, because a
// mounted sub-router does NOT inherit its parent's `defaultHook` — setting it
// here alone left all 33 route modules returning raw Zod. See `createRouter`.
const app = createRouter().basePath('/api/v1');

// ─── Middleware (order matters) ──────────────────────────────────────────────
app.use('*', secureHeaders());

const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000')
  .split(',')
  .map((o) => o.trim());

app.use(
  '*',
  cors({
    origin: (origin) => (allowedOrigins.includes(origin) ? origin : null),
  }),
);
app.use('*', rateLimitMiddleware);
app.use('*', authMiddleware);

app.get('/health', (c) => c.json({ status: 'ok' }));

// ─── Backward-compatible redirects (Category → Budget rename) ────────────────
app.all('/categories/*', (c) => {
  const newPath = c.req.path.replace('/categories', '/budgets');
  return c.redirect(newPath, 308);
});
app.all('/categories', (c) => c.redirect('/api/v1/budgets', 308));

app.route('/accounts', accountsRouter);
app.route('/budgets', budgetsRouter);
app.route('/income', incomeRouter);
app.route('/expenses', expensesRouter);
app.route('/expenses', expensesLifecycleRouter);
app.route('/transactions', transactionsRouter);
app.route('/transactions', transactionsChildrenRouter);
app.route('/transactions', transactionsLinkingRouter);
app.route('/purchases', purchasesRouter);
app.route('/pay-schedules', paySchedulesRouter);
app.route('/pay-periods', payPeriodsRouter);
app.route('/utilities', utilitiesProvidersRouter);
app.route('/utilities', utilitiesReadingsRouter);
app.route('/healthcare', healthcareRouter);
app.route('/investments', investmentsRouter);
app.route('/investments', investmentsHistoryRouter);
app.route('/investments', investmentsEntitiesRouter);
app.route('/investments', investmentsTransfersRouter);
app.route('/goals', goalsRouter);
app.route('/dashboard', dashboardRouter);
app.route('/sign-conventions', signConventionsRouter);
app.route('/debts', debtsRouter);
app.route('/debts', escrowRouter);
app.route('/scheduled-transactions', scheduledTransactionsRouter);
app.route('/year-plans', yearPlansRouter);
app.route('/category-budgets', categoryBudgetsRouter);
app.route('/reconciliations', reconciliationsRouter);
app.route('/reconciliations', reconciliationsCloseRouter);
app.route('/reconciliations', reconciliationsMergeRouter);
app.route('/category-budgets', budgetLinksRouter);
app.route('/descriptions', descriptionsRouter);
app.route('/backups', backupsRouter);
app.route('/connected-services', connectedServicesRouter);
app.route('/data-management', dataManagementRouter);

// OpenAPI spec — auto-populated from all mounted routes
app.doc('/openapi.json', {
  openapi: '3.1.0',
  info: {
    title: 'Avoir Money API',
    version: '1.0.0',
    description: 'Personal budget management API',
  },
});

import { HTTPException } from 'hono/http-exception';

// ─── Global Error Handler ────────────────────────────────────────────────────
app.onError((err, c) => {
  console.error('Unhandled error:', err);

  // HTTPException from Hono (e.g., malformed JSON) — safe to expose message
  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status);
  }

  // Everything else (Prisma errors, unexpected crashes) — generic message
  return c.json({ error: 'Internal server error' }, 500);
});

export default app;
