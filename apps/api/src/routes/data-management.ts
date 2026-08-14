import { createRoute, z } from '@hono/zod-openapi';
import { prisma } from '@budget-tracker/db';
import { ledgerDelete } from '../lib/lifecycle/index.js';
import { createRouter } from '../lib/errors.js';

const app = createRouter();

/**
 * Reset all transaction-derived state to its zero baseline after a FULL transaction wipe.
 *
 * The bulk-delete "all-transactions" and "accounts" categories remove every transaction in
 * one `deleteMany`, bypassing the ledger gate's reversal hooks. That leaves derived values
 * frozen at their last computed state (balances, rewards ledger, holding quantities, debt
 * balances). Because these are TOTAL wipes, the correct end-state is trivial — no transactions
 * means every derived value returns to its baseline — so we reset directly instead of replaying
 * per-row reversals. This is only valid for a full wipe; partial deletes must use ledgerDelete.
 */
async function resetTransactionDerivedState(): Promise<void> {
  // Accounts: with no transactions left, the baseline balance is the account's
  // pre-tracking `openingBalance`, NOT zero — resetting to zero would discard the
  // Starting Balance and break the ledger invariant
  // (openingBalance + SUM(transactions) == balance) the moment the wipe finished.
  // updateMany cannot copy column-to-column, so this is a raw UPDATE.
  await prisma.$executeRaw`UPDATE "Account" SET balance = "openingBalance"`;

  // Holdings: no trades means zero units and no cost basis.
  await prisma.investmentHolding.updateMany({ data: { quantity: 0, costBasis: null } });

  // Debts: no recorded payments means the full original balance is owed again.
  await prisma.debtPayment.deleteMany();
  const debts = await prisma.debt.findMany({ select: { id: true, originalBalance: true } });
  for (const debt of debts) {
    await prisma.debt.update({
      where: { id: debt.id },
      data: { currentBalance: debt.originalBalance },
    });
  }

  // Scheduled transactions marked paid/partial via a now-deleted transaction revert to pending.
  // SKIPPED/SNOOZED are deliberate user actions unrelated to a transaction — leave them alone.
  await prisma.scheduledTransaction.updateMany({
    where: { status: { in: ['PAID', 'PARTIAL'] } },
    data: { status: 'PENDING', actualAmount: null, transactionId: null },
  });
}

// ─── GET /counts ─────────────────────────────────────────────────────────────

const countsRoute = createRoute({
  method: 'get',
  path: '/counts',
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({
            allTransactions: z.number(),
            importedTransactions: z.number(),
            recurringExpenses: z.number(),
            recurringIncome: z.number(),
            accounts: z.number(),
            budgets: z.number(),
            debts: z.number(),
            utilities: z.number(),
            healthcarePolicies: z.number(),
            investments: z.number(),
            scheduledTransactions: z.number(),
            paySchedules: z.number(),
          }),
        },
      },
      description: 'Counts for each data category',
    },
  },
});

app.openapi(countsRoute, async (c) => {
  const [
    allTransactions,
    importedTransactions,
    recurringExpenses,
    recurringIncome,
    accounts,
    budgets,
    debts,
    utilities,
    healthcarePolicies,
    investments,
    scheduledTransactions,
    paySchedules,
  ] = await Promise.all([
    prisma.transaction.count(),
    prisma.transaction.count({ where: { imported: true } }),
    prisma.expense.count(),
    prisma.income.count(),
    prisma.account.count(),
    prisma.categoryBudget.count({ where: { budget: { isSystem: false } } }),
    prisma.debt.count(),
    prisma.utilityProvider.count(),
    prisma.insurancePolicy.count(),
    prisma.investmentHolding.count(),
    prisma.scheduledTransaction.count(),
    prisma.paySchedule.count(),
  ]);

  return c.json({
    allTransactions,
    importedTransactions,
    recurringExpenses,
    recurringIncome,
    accounts,
    budgets,
    debts,
    utilities,
    healthcarePolicies,
    investments,
    scheduledTransactions,
    paySchedules,
  });
});

// ─── DELETE /bulk ────────────────────────────────────────────────────────────

const bulkDeleteRoute = createRoute({
  method: 'delete',
  path: '/bulk',
  request: {
    query: z.object({ confirm: z.literal('true') }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            categories: z.array(z.string()),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: z.object({ deleted: z.number() }) } },
      description: 'Number of records deleted',
    },
  },
});

app.openapi(bulkDeleteRoute, async (c) => {
  const { categories } = c.req.valid('json');
  let totalDeleted = 0;

  for (const category of categories) {
    switch (category) {
      case 'all-transactions': {
        const txCount = await prisma.transaction.deleteMany();
        totalDeleted += txCount.count;
        // Full wipe — reset every transaction-derived value to baseline.
        await resetTransactionDerivedState();
        break;
      }
      case 'imported-transactions': {
        // Partial delete: other transactions survive, so we cannot blanket-reset derived state.
        // Route each imported transaction through the ledger gate so its balance/rewards/holding/
        // debt effects are reversed individually. Only top-level rows — children cascade with them.
        const imported = await prisma.transaction.findMany({
          where: { imported: true, parentId: null },
          select: { id: true },
        });
        for (const { id } of imported) {
          // Read the debt payment BEFORE deleting (onDelete: SetNull nullifies the FK on delete).
          const debtPayment = await prisma.debtPayment.findFirst({
            where: { transactionId: id },
            include: { debt: true },
          });
          await ledgerDelete(id, debtPayment ? { debtPayment } : undefined);
          totalDeleted++;
        }
        break;
      }
      case 'recurring-expenses': {
        const result = await prisma.expense.deleteMany();
        totalDeleted += result.count;
        break;
      }
      case 'recurring-income': {
        const result = await prisma.income.deleteMany();
        totalDeleted += result.count;
        break;
      }
      case 'accounts': {
        // Transaction.accountId is onDelete: Restrict, so an account cannot be removed while any
        // transaction references it — every transaction must go first. That makes this a full
        // transaction wipe, so reset all derived state (rewards, holdings, debts) to baseline too.
        await prisma.transaction.deleteMany();
        await resetTransactionDerivedState();
        const acctCount = await prisma.account.deleteMany();
        totalDeleted += acctCount.count;
        break;
      }
      case 'budgets': {
        const result = await prisma.categoryBudget.deleteMany({
          where: { budget: { isSystem: false } },
        });
        totalDeleted += result.count;
        break;
      }
      case 'debts': {
        // Escrow records cascade via onDelete: Cascade from Debt
        const debtCount = await prisma.debt.deleteMany();
        totalDeleted += debtCount.count;
        break;
      }
      case 'utilities': {
        // Readings → services cascade, services → providers cascade
        const providerCount = await prisma.utilityProvider.deleteMany();
        totalDeleted += providerCount.count;
        break;
      }
      case 'healthcare-policies': {
        const result = await prisma.insurancePolicy.deleteMany();
        totalDeleted += result.count;
        break;
      }
      case 'investments': {
        // Snapshots and transfers cascade from holdings
        const holdingCount = await prisma.investmentHolding.deleteMany();
        const custodianCount = await prisma.custodian.deleteMany();
        const walletCount = await prisma.wallet.deleteMany();
        totalDeleted += holdingCount.count + custodianCount.count + walletCount.count;
        break;
      }
      case 'scheduled-transactions': {
        const result = await prisma.scheduledTransaction.deleteMany();
        totalDeleted += result.count;
        break;
      }
      case 'pay-schedules': {
        // Pay periods cascade via onDelete: Cascade from PaySchedule
        const scheduleCount = await prisma.paySchedule.deleteMany();
        totalDeleted += scheduleCount.count;
        break;
      }
      default:
        // Unknown category — skip
        break;
    }
  }

  return c.json({ deleted: totalDeleted });
});

export default app;
