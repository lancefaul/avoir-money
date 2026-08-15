import { createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { prisma, Prisma } from '@budget-tracker/db';
import type { AnticipationSchema } from '@budget-tracker/core';
import {
  TransactionSchema,
  CreateTransactionSchema,
  UpdateTransactionSchema,
  ListTransactionsQuerySchema,
  PaginatedTransactionsResponseSchema,
  BudgetSuggestionsResponseSchema,
  roundCurrency,
  transactionCrossFieldIssues,
} from '@budget-tracker/core';
import { ErrorSchema, createRouter } from '../lib/errors.js';
import { buildTransactionListWhere, buildUpcomingAnticipations } from '../lib/transaction-list.js';
import { NOT_PAYMENT_LEG } from '../lib/purchase-group.js';
import { serializeTransaction } from '../lib/transaction-serialization.js';
import { validateTradeMetadata, validateBitcoinPayment } from '../lib/transaction-validation.js';
import { ledgerCreate, ledgerUpdate, ledgerDelete } from '../lib/lifecycle/index.js';

const app = createRouter();

// ─── GET / ───

const listTransactionsRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Transactions'],
  summary: 'List transactions',
  request: { query: ListTransactionsQuerySchema },
  responses: {
    200: {
      content: { 'application/json': { schema: PaginatedTransactionsResponseSchema } },
      description: 'Paginated list of transactions',
    },
    400: {
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      description: 'Bad Request',
    },
  },
});

app.openapi(listTransactionsRoute, async (c) => {
  const query = c.req.valid('query');

  const where = await buildTransactionListWhere(query);

  // A split purchase (payment-split, ADR-030) appears as its Anchor (carrying the
  // full total) AND one balance-visible leg per account (the legs also sum to the
  // total). With no account filter, the totals and count would count it twice —
  // once via the Anchor, once via the legs — so exclude the legs and keep the
  // Anchor, matching the list's collapsed view. With an account filter the
  // null-account Anchor is already excluded and the legs ARE the per-account rows,
  // so no leg filter is applied. NOT_PAYMENT_LEG is itself an OR, so it must be
  // AND-nested (never spread) to avoid clobbering the account/search OR on `where`.
  const excludeLegs = (w: Record<string, unknown>): Record<string, unknown> =>
    query.accountId ? w : { AND: [w, NOT_PAYMENT_LEG] };

  const [totalCount, cursorRecord, spentAgg, earnedAgg, refundAgg] = await Promise.all([
    prisma.transaction.count({ where: excludeLegs(where) }),
    query.cursor
      ? prisma.transaction.findUnique({ where: { id: query.cursor }, select: { id: true } })
      : Promise.resolve(undefined),
    prisma.transaction.aggregate({
      where: excludeLegs({ ...where, type: 'EXPENSE' }),
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: excludeLegs({ ...where, type: 'INCOME' }),
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: excludeLegs({ ...where, type: 'REFUND' }),
      _sum: { amount: true },
    }),
  ]);
  const totalSpent =
    (spentAgg._sum.amount?.toNumber() ?? 0) - (refundAgg._sum.amount?.toNumber() ?? 0);
  const totalEarned = earnedAgg._sum.amount?.toNumber() ?? 0;

  if (query.cursor && !cursorRecord) {
    return c.json({ error: 'Invalid cursor: transaction not found' }, 400);
  }

  const records = await prisma.transaction.findMany({
    where,
    include: {
      _count: { select: { children: true } },
      expense: { select: { budgetId: true } },
      income: { select: { budgetId: true } },
      tradeDetail: true,
      bitcoinPaymentDetail: true,
      // Reconciliation adjustments are marked in the list, per Requirement 6.7:
      // an adjustment that looks like an ordinary transaction is the invisible
      // absorption this feature exists to prevent.
      adjustmentForSession: { select: { id: true } },
    },
    // `id` last, and it is not decoration: `date` and `createdAt` together are
    // NOT unique. A split purchase writes its Anchor and every leg inside one
    // millisecond, so those rows tie on both keys and the database returns them
    // in whatever order it likes — which is a different order in Postgres than
    // in SQLite, and not guaranteed stable between two calls to either.
    //
    // Under cursor pagination that is a correctness bug rather than a cosmetic
    // one. The cursor is a position in this ordering; if the ordering is not a
    // strict total order, the rows that sort equal to the cursor can land on
    // either side of it between requests, so scrolling can serve a row twice or
    // skip it entirely. ADR-009 chose cursors precisely to avoid that class of
    // problem, and an undefined tie-break reintroduces it.
    //
    // Same direction as the keys above so the whole ordering reverses together.
    orderBy: [
      { date: query.sortOrder === 'oldest' ? ('asc' as const) : ('desc' as const) },
      { createdAt: query.sortOrder === 'oldest' ? ('asc' as const) : ('desc' as const) },
      { id: query.sortOrder === 'oldest' ? ('asc' as const) : ('desc' as const) },
    ],
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });

  const hasMore = records.length > query.limit;
  const page = hasMore ? records.slice(0, query.limit) : records;
  const nextCursor = hasMore ? page[page.length - 1]!.id : null;

  // First page only (ADR-009: repeating them per page would double-count), and
  // only when the caller wants them at all.
  let anticipations: z.infer<typeof AnticipationSchema>[] | undefined;
  if (!query.cursor && !query.skipGenerate && query.showAnticipations) {
    anticipations = await buildUpcomingAnticipations({ showSnoozed: query.showSnoozed });
  }

  return c.json(
    {
      transactions: page.map(serializeTransaction),
      totalCount,
      totalSpent,
      totalEarned,
      nextCursor,
      hasMore,
      ...(anticipations ? { anticipations } : {}),
    },
    200,
  );
});

// ─── POST / ───

const createTransactionRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['Transactions'],
  summary: 'Create a transaction',
  request: { body: { content: { 'application/json': { schema: CreateTransactionSchema } } } },
  responses: {
    201: {
      content: { 'application/json': { schema: TransactionSchema } },
      description: 'Transaction created',
    },
    400: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Bad Request' },
    409: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Conflict' },
  },
});

// @ts-expect-error — @hono/zod-openapi type inference breaks with nullable accountId in TransactionSchema
app.openapi(createTransactionRoute, async (c) => {
  const body = c.req.valid('json');

  if (body.type === 'TRANSFER') {
    if (!body.toAccountId) return c.json({ error: 'Transfers require a toAccountId' }, 400);
    if (body.accountId === body.toAccountId)
      return c.json({ error: 'From and to accounts must be different' }, 400);
  }

  // Auto-set budgetId from linked expense if not provided
  if (body.expenseId && !body.budgetId) {
    const exp = await prisma.expense.findUnique({
      where: { id: body.expenseId },
      select: { budgetId: true, name: true },
    });
    if (exp) {
      (body as Record<string, unknown>).budgetId = exp.budgetId;
      if (!body.name) body.name = exp.name;
    }
  }
  if (body.incomeId && !body.name) {
    const inc = await prisma.income.findUnique({
      where: { id: body.incomeId },
      select: { name: true },
    });
    if (inc) body.name = inc.name;
  }

  // TRADE-specific: validate tradeMetadata and check SELL holdings
  if (body.type === 'TRADE') {
    if (!body.tradeMetadata)
      return c.json({ error: 'Trade metadata is required for TRADE transactions' }, 400);
    const tradeResult = await validateTradeMetadata(body.tradeMetadata);
    if (!tradeResult.ok) return c.json({ error: tradeResult.error }, tradeResult.status);
  }

  // Bitcoin payment validation
  if (body.bitcoinMetadata) {
    const btcResult = await validateBitcoinPayment(body.bitcoinMetadata, body.type);
    if (!btcResult.ok) return c.json({ error: btcResult.error }, btcResult.status);
    body.amount = btcResult.data!.usdAmount;
    body.accountId = undefined; // Bitcoin txns use wallet, not bank account
  }

  // netAmount is recomputed in the ledger gate (equal to amount).
  try {
    const final = await ledgerCreate(body as Parameters<typeof ledgerCreate>[0]);
    const fullRecord = await prisma.transaction.findUniqueOrThrow({
      where: { id: final.id },
      include: { tradeDetail: true, bitcoinPaymentDetail: true },
    });
    return c.json(serializeTransaction(fullRecord), 201);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') return c.json({ error: 'Related resource not found' }, 404);
      if (err.code === 'P2002')
        return c.json({ error: 'Duplicate record', details: err.meta }, 409);
    }
    throw err;
  }
});

// ─── PUT /{id} ───

const updateTransactionRoute = createRoute({
  method: 'put',
  path: '/{id}',
  tags: ['Transactions'],
  summary: 'Update a transaction',
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: UpdateTransactionSchema } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: TransactionSchema } },
      description: 'Transaction updated',
    },
    400: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Bad Request' },
    404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Not Found' },
    409: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Conflict' },
  },
});

// @ts-expect-error — @hono/zod-openapi type inference breaks with nullable accountId in TransactionSchema
app.openapi(updateTransactionRoute, async (c) => {
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');
  try {
    // The detail relations are the stored answer to "does this already have
    // trade / bitcoin metadata?" — the cross-field rules need them, and the
    // request body only ever carries the fields being changed.
    const oldTx = await prisma.transaction.findUnique({
      where: { id },
      include: { tradeDetail: true, bitcoinPaymentDetail: true },
    });
    if (!oldTx) return c.json({ error: 'Transaction not found' }, 404);

    // If amount is being changed, check it doesn't go below children sum
    if (body.amount !== undefined) {
      const childrenAgg = await prisma.transaction.aggregate({
        where: { parentId: id },
        _sum: { amount: true },
      });
      const childrenSum = childrenAgg._sum.amount ? Number(childrenAgg._sum.amount) : 0;
      if (childrenSum > 0 && body.amount < childrenSum) {
        return c.json(
          { error: `Cannot reduce amount below allocated children total of ${childrenSum}` },
          400,
        );
      }
    }

    // If budgetId is changing and transaction is linked to an expense, update the expense too
    if (body.budgetId && oldTx.expenseId && body.budgetId !== oldTx.budgetId) {
      await prisma.expense.update({
        where: { id: oldTx.expenseId },
        data: { budgetId: body.budgetId },
      });
    }

    if (body.bitcoinMetadata) {
      const btcResult = await validateBitcoinPayment(
        body.bitcoinMetadata!,
        body.type ?? oldTx.type,
      );
      if (!btcResult.ok) return c.json({ error: btcResult.error }, btcResult.status);
      body.amount = btcResult.data!.usdAmount;
      body.accountId = undefined; // Bitcoin txns use wallet, not bank account
    }

    // Clear toAccountId when type changes away from TRANSFER
    if (body.type && body.type !== 'TRANSFER' && oldTx.type === 'TRANSFER') {
      body.toAccountId = null;
    }

    /*
     * Cross-field rules, evaluated against the FINAL state.
     *
     * `UpdateTransactionSchema` is a `.partial()` and carries no refinement, so
     * until now every one of these was enforced on create and silently skipped
     * here — an update could strip a TRADE's funding account or mark an EXPENSE
     * as cash back. Not reachable from the UI, which is why it went unnoticed.
     *
     * Merged from the stored row rather than read off the body, because a
     * partial update may not send `type` at all; refining the partial directly
     * would evaluate every rule against `undefined` and pass everything.
     *
     * Placed after the mutations above deliberately — those resolve real
     * conflicts (a bitcoin payment clears its accountId), so validating the
     * body as received would reject a request the route was about to make
     * valid.
     */
    const issues = transactionCrossFieldIssues({
      type: body.type ?? oldTx.type,
      hasFundingAccount: 'accountId' in body ? Boolean(body.accountId) : Boolean(oldTx.accountId),
      hasTradeMetadata:
        'tradeMetadata' in body ? Boolean(body.tradeMetadata) : Boolean(oldTx.tradeDetail),
      hasBitcoinMetadata:
        'bitcoinMetadata' in body
          ? Boolean(body.bitcoinMetadata)
          : Boolean(oldTx.bitcoinPaymentDetail),
      isCashBack: 'isCashBack' in body ? Boolean(body.isCashBack) : oldTx.isCashBack,
    });
    if (issues.length > 0) {
      return c.json(
        {
          error: issues[0]!.message,
          details: issues.map((i) => ({ field: i.path, message: i.message })),
        },
        400,
      );
    }

    await ledgerUpdate(id, body as Parameters<typeof ledgerUpdate>[1]);
    const fullRecord = await prisma.transaction.findUniqueOrThrow({
      where: { id },
      include: { tradeDetail: true, bitcoinPaymentDetail: true },
    });
    return c.json(serializeTransaction(fullRecord), 200);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') return c.json({ error: 'Transaction not found' }, 404);
      if (err.code === 'P2002')
        return c.json({ error: 'Duplicate record', details: err.meta }, 409);
    }
    throw err;
  }
});

// ─── DELETE /{id} ───

// ─── DELETE /imported ───

const deleteImportedRoute = createRoute({
  method: 'delete',
  path: '/imported',
  tags: ['Transactions'],
  summary: 'Delete all imported transactions',
  request: { query: z.object({ confirm: z.string().optional() }) },
  responses: {
    200: {
      content: { 'application/json': { schema: z.object({ deleted: z.number() }) } },
      description: 'Deleted count',
    },
    400: {
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      description: 'Bad Request',
    },
  },
});

app.openapi(deleteImportedRoute, async (c) => {
  const { confirm } = c.req.valid('query');
  if (confirm !== 'true') {
    return c.json({ error: 'Mass delete requires ?confirm=true query parameter' }, 400);
  }

  // Find all imported transactions
  const imported = await prisma.transaction.findMany({
    where: { imported: true },
    select: { id: true },
  });
  const ids = imported.map((t) => t.id);

  if (ids.length === 0) {
    return c.json({ deleted: 0 }, 200);
  }

  // Unlink ScheduledTransactions and DebtPayments
  await prisma.scheduledTransaction.updateMany({
    where: { transactionId: { in: ids } },
    data: { transactionId: null, status: 'PENDING', actualAmount: null },
  });
  await prisma.debtPayment.updateMany({
    where: { transactionId: { in: ids } },
    data: { transactionId: null },
  });

  // Delete children first (FK constraint), then parents
  await prisma.transaction.deleteMany({ where: { parentId: { in: ids } } });
  const result = await prisma.transaction.deleteMany({ where: { id: { in: ids } } });

  // Recalculate all account balances from remaining transactions using netAmount
  const accounts = await prisma.account.findMany({ select: { id: true } });
  for (const acct of accounts) {
    const txs = await prisma.transaction.findMany({
      where: { accountId: acct.id, parentId: null },
      select: { type: true, netAmount: true, tradeDetail: { select: { direction: true } } },
    });
    const inboundTransfers = await prisma.transaction.findMany({
      where: { toAccountId: acct.id, parentId: null, type: 'TRANSFER' },
      select: { netAmount: true },
    });
    let balance = 0;
    for (const tx of txs) {
      const amt = Number(tx.netAmount);
      if (tx.type === 'INCOME' || tx.type === 'REFUND') {
        balance = roundCurrency(balance + amt);
      } else if (tx.type === 'EXPENSE' || tx.type === 'TRANSFER') {
        balance = roundCurrency(balance - amt);
      } else if (tx.type === 'TRADE') {
        const direction = tx.tradeDetail?.direction;
        if (direction === 'BUY') balance = roundCurrency(balance - amt);
        else if (direction === 'SELL') balance = roundCurrency(balance + amt);
      }
    }
    for (const tx of inboundTransfers) {
      balance = roundCurrency(balance + Number(tx.netAmount));
    }
    await prisma.account.update({ where: { id: acct.id }, data: { balance } });
  }

  return c.json({ deleted: result.count }, 200);
});

// ─── DELETE /{id} ───

const deleteTransactionRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Transactions'],
  summary: 'Delete a transaction',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: { description: 'Transaction deleted' },
    404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Not Found' },
    409: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Conflict' },
  },
});

app.openapi(deleteTransactionRoute, async (c) => {
  const { id } = c.req.valid('param');
  try {
    const tx = await prisma.transaction.findUnique({ where: { id } });
    if (!tx) return c.json({ error: 'Transaction not found' }, 404);

    const childCount = await prisma.transaction.count({ where: { parentId: id } });
    if (childCount > 0) {
      return c.json(
        { error: 'Cannot delete transaction with child line items. Remove children first.' },
        409,
      );
    }

    // Read debt payment BEFORE deleting the transaction (onDelete: SetNull nullifies the FK)
    const debtPaymentForReversal = await prisma.debtPayment.findFirst({
      where: { transactionId: id },
      include: { debt: true },
    });

    await ledgerDelete(id, { debtPayment: debtPaymentForReversal });
    return c.body(null, 204);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') return c.json({ error: 'Transaction not found' }, 404);
      if (err.code === 'P2002')
        return c.json({ error: 'Duplicate record', details: err.meta }, 409);
    }
    throw err;
  }
});

// ─── GET /suggest-budget ───

const suggestBudgetRoute = createRoute({
  method: 'get',
  path: '/suggest-budget',
  tags: ['Transactions'],
  summary: 'Suggest budgets based on past transactions with similar descriptions',
  request: {
    query: z.object({
      description: z.string().min(1),
    }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: BudgetSuggestionsResponseSchema } },
      description: 'Budget suggestions ordered by frequency',
    },
  },
});

app.openapi(suggestBudgetRoute, async (c) => {
  const { description } = c.req.valid('query');

  // Find transactions with matching description, grouped by budgetId, ordered by count
  const suggestions = await prisma.transaction.groupBy({
    by: ['budgetId'],
    where: {
      name: { equals: description, mode: 'insensitive' },
      budgetId: { not: null },
    },
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
    take: 5,
  });

  if (suggestions.length === 0) {
    return c.json({ suggestions: [] }, 200);
  }

  // Fetch budget names for the suggested IDs
  const budgetIds = suggestions.map((s) => s.budgetId).filter((id): id is string => id !== null);
  const budgets = await prisma.budget.findMany({
    where: { id: { in: budgetIds } },
    select: { id: true, name: true },
  });

  const budgetMap = new Map(budgets.map((b) => [b.id, b.name]));

  return c.json(
    {
      suggestions: suggestions
        .filter((s) => s.budgetId && budgetMap.has(s.budgetId))
        .map((s) => ({
          budgetId: s.budgetId!,
          budgetName: budgetMap.get(s.budgetId!) ?? 'Unknown',
          count: s._count.id,
        })),
    },
    200,
  );
});

export default app;
