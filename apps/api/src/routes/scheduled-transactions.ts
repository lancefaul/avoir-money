/**
 * Scheduled Transactions API routes — list, mark-as-paid, snooze, skip.
 *
 * Feature: transaction-schedule
 * Requirements: 4.1, 4.2, 4.3, 4.4, 7.1, 7.3, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6
 */
import { createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { prisma, Prisma } from '@budget-tracker/db';
import {
  TransactionSchema,
  ScheduledTransactionSchema,
  ScheduledTransactionsQuerySchema,
  MarkScheduledPaidRequestSchema,
  SnoozeScheduledRequestSchema,
} from '@budget-tracker/core';
import { ErrorSchema, createRouter } from '../lib/errors.js';
import { generateSchedule } from '../lib/schedule-generator.js';
import { today as todayFn, makeDate, localDate } from '../lib/dates.js';
import { serializeTransaction } from '../lib/transaction-serialization.js';
import { ledgerCreate } from '../lib/lifecycle/index.js';

const app = createRouter();

// ─── GET / ───

const listRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Scheduled Transactions'],
  summary: 'List scheduled transactions for a period',
  request: {
    query: ScheduledTransactionsQuerySchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(ScheduledTransactionSchema) } },
      description: 'Scheduled transactions for the period',
    },
    400: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Bad Request' },
  },
});

app.openapi(listRoute, async (c) => {
  const { periodStart, periodEnd, sourceType, sourceId } = c.req.valid('query');

  // Lazy generation — ensure rows exist for this period
  await generateSchedule({ periodStart, periodEnd, sourceType, sourceId });

  const where: Record<string, unknown> = {
    dueDate: { gte: periodStart, lte: periodEnd },
  };
  if (sourceType) where.sourceType = sourceType;
  if (sourceId) where.sourceId = sourceId;

  const rows = await prisma.scheduledTransaction.findMany({
    where,
    // `id` as the tie-break: a single day routinely holds several due items,
    // and ordering by `dueDate` alone leaves them in whatever order the
    // database returns, which is not stable between calls. Rows that reshuffle
    // between two renders of the same list is a defect the user sees directly.
    orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
  });

  return c.json(
    rows.map((r) => ({
      id: r.id,
      sourceType: r.sourceType,
      sourceId: r.sourceId,
      dueDate: r.dueDate,
      expectedAmount: Number(r.expectedAmount),
      actualAmount: r.actualAmount != null ? Number(r.actualAmount) : null,
      status: r.status,
      transactionId: r.transactionId,
      snoozedUntil: r.snoozedUntil,
      note: r.note,
      expenseId: r.expenseId,
      incomeId: r.incomeId,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
    200,
  );
});

// ─── POST /:id/pay ───

const payRoute = createRoute({
  method: 'post',
  path: '/{id}/pay',
  tags: ['Scheduled Transactions'],
  summary: 'Mark a scheduled transaction as paid',
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: MarkScheduledPaidRequestSchema } } },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: TransactionSchema } },
      description: 'Transaction created from scheduled transaction',
    },
    404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Not Found' },
    409: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Conflict' },
  },
});

// @ts-expect-error — @hono/zod-openapi type inference breaks with nullable fields in TransactionSchema
app.openapi(payRoute, async (c) => {
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');

  const scheduled = await prisma.scheduledTransaction.findUnique({ where: { id } });
  if (!scheduled) return c.json({ error: 'Scheduled transaction not found' }, 404);
  if (scheduled.status === 'PAID')
    return c.json({ error: 'Scheduled transaction is already paid' }, 409);

  // Resolve source defaults
  let sourceName: string;
  let sourceBudgetId: string;
  let sourceAccountId: string | null;

  if (scheduled.sourceType === 'EXPENSE') {
    const expense = await prisma.expense.findUnique({ where: { id: scheduled.sourceId } });
    if (!expense) return c.json({ error: 'Source expense not found' }, 404);
    sourceName = expense.name;
    sourceBudgetId = expense.budgetId;
    sourceAccountId = expense.accountId;
  } else {
    const income = await prisma.income.findUnique({ where: { id: scheduled.sourceId } });
    if (!income) return c.json({ error: 'Source income not found' }, 404);
    sourceName = income.name;
    sourceBudgetId = income.budgetId;
    sourceAccountId = income.accountId;
  }

  const txAmount = body.amount ?? Number(scheduled.expectedAmount);
  const txDate = body.date ?? todayFn();
  const accountId = body.accountId ?? sourceAccountId ?? null;

  try {
    // Create the fulfilling transaction through the ledger gate
    const record = await ledgerCreate({
      type: scheduled.sourceType === 'EXPENSE' ? 'EXPENSE' : 'INCOME',
      name: sourceName,
      amount: txAmount,
      date: txDate,
      occurrenceDate: scheduled.dueDate,
      accountId,
      budgetId: sourceBudgetId,
      ...(scheduled.sourceType === 'EXPENSE'
        ? { expenseId: scheduled.sourceId }
        : { incomeId: scheduled.sourceId }),
    });

    // Update the scheduled transaction
    const newStatus = txAmount >= Number(scheduled.expectedAmount) ? 'PAID' : 'PARTIAL';
    await prisma.scheduledTransaction.update({
      where: { id },
      data: {
        status: newStatus,
        transactionId: record.id,
        actualAmount: txAmount,
      },
    });

    const full = await prisma.transaction.findUniqueOrThrow({
      where: { id: record.id },
      include: { tradeDetail: true, bitcoinPaymentDetail: true },
    });
    return c.json(serializeTransaction(full), 201);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') return c.json({ error: 'Related resource not found' }, 404);
      if (err.code === 'P2002')
        return c.json({ error: 'Duplicate record', details: err.meta }, 409);
    }
    throw err;
  }
});

// ─── POST /:id/snooze ───

const snoozeRoute = createRoute({
  method: 'post',
  path: '/{id}/snooze',
  tags: ['Scheduled Transactions'],
  summary: 'Snooze a scheduled transaction',
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: SnoozeScheduledRequestSchema } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: ScheduledTransactionSchema } },
      description: 'Scheduled transaction snoozed',
    },
    404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Not Found' },
    409: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Conflict' },
  },
});

app.openapi(snoozeRoute, async (c) => {
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');

  const scheduled = await prisma.scheduledTransaction.findUnique({ where: { id } });
  if (!scheduled) return c.json({ error: 'Scheduled transaction not found' }, 404);
  if (scheduled.status === 'PAID')
    return c.json({ error: 'Cannot snooze a paid scheduled transaction' }, 409);

  const now = todayFn();
  const nd = localDate(now);
  const snoozedUntil = makeDate(nd.year, nd.month, nd.day + body.days);

  try {
    const updated = await prisma.scheduledTransaction.update({
      where: { id },
      data: { status: 'SNOOZED', snoozedUntil },
    });

    return c.json(
      {
        id: updated.id,
        sourceType: updated.sourceType,
        sourceId: updated.sourceId,
        dueDate: updated.dueDate,
        expectedAmount: Number(updated.expectedAmount),
        actualAmount: updated.actualAmount != null ? Number(updated.actualAmount) : null,
        status: updated.status,
        transactionId: updated.transactionId,
        snoozedUntil: updated.snoozedUntil,
        note: updated.note,
        expenseId: updated.expenseId,
        incomeId: updated.incomeId,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      },
      200,
    );
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') return c.json({ error: 'Scheduled transaction not found' }, 404);
      if (err.code === 'P2002')
        return c.json({ error: 'Duplicate record', details: err.meta }, 409);
    }
    throw err;
  }
});

// ─── POST /:id/skip ───

const skipRoute = createRoute({
  method: 'post',
  path: '/{id}/skip',
  tags: ['Scheduled Transactions'],
  summary: 'Skip a scheduled transaction',
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: ScheduledTransactionSchema } },
      description: 'Scheduled transaction skipped',
    },
    404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Not Found' },
    409: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Conflict' },
  },
});

app.openapi(skipRoute, async (c) => {
  const { id } = c.req.valid('param');

  const scheduled = await prisma.scheduledTransaction.findUnique({ where: { id } });
  if (!scheduled) return c.json({ error: 'Scheduled transaction not found' }, 404);
  if (scheduled.status === 'PAID')
    return c.json({ error: 'Cannot skip a paid scheduled transaction' }, 409);

  try {
    const updated = await prisma.scheduledTransaction.update({
      where: { id },
      data: { status: 'SKIPPED' },
    });

    return c.json(
      {
        id: updated.id,
        sourceType: updated.sourceType,
        sourceId: updated.sourceId,
        dueDate: updated.dueDate,
        expectedAmount: Number(updated.expectedAmount),
        actualAmount: updated.actualAmount != null ? Number(updated.actualAmount) : null,
        status: updated.status,
        transactionId: updated.transactionId,
        snoozedUntil: updated.snoozedUntil,
        note: updated.note,
        expenseId: updated.expenseId,
        incomeId: updated.incomeId,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      },
      200,
    );
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') return c.json({ error: 'Scheduled transaction not found' }, 404);
      if (err.code === 'P2002')
        return c.json({ error: 'Duplicate record', details: err.meta }, 409);
    }
    throw err;
  }
});

export default app;
