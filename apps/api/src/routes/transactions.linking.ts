import { createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { prisma, Prisma } from '@budget-tracker/db';
import { TransactionSchema, LinkRequestSchema } from '@budget-tracker/core';
import { ErrorSchema, createRouter } from '../lib/errors.js';
import { serializeTransaction } from '../lib/transaction-serialization.js';
import { ledgerUpdate } from '../lib/lifecycle/index.js';

const app = createRouter();

// ─── POST /:id/link ───

const linkTransactionRoute = createRoute({
  method: 'post',
  path: '/{id}/link',
  tags: ['Transactions'],
  summary: 'Link a transaction to a recurring source',
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: LinkRequestSchema } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: TransactionSchema } },
      description: 'Transaction linked',
    },
    400: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Bad Request' },
    404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Not Found' },
    409: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Conflict' },
  },
});

// @ts-expect-error — @hono/zod-openapi type inference breaks with nullable accountId in TransactionSchema
app.openapi(linkTransactionRoute, async (c) => {
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');

  const tx = await prisma.transaction.findUnique({ where: { id } });
  if (!tx) return c.json({ error: 'Transaction not found' }, 404);

  let budgetId: string | undefined;

  if (body.expenseId) {
    const expense = await prisma.expense.findUnique({ where: { id: body.expenseId } });
    if (!expense) return c.json({ error: 'Expense not found' }, 404);
    budgetId = expense.budgetId;

    // Check one-transaction-per-occurrence: no other transaction linked to this expense on the same date
    const duplicate = await prisma.transaction.findFirst({
      where: { expenseId: body.expenseId, date: tx.date, id: { not: id } },
    });
    if (duplicate)
      return c.json(
        { error: 'Another transaction is already linked to this expense for this occurrence date' },
        409,
      );
  }

  if (body.incomeId) {
    const income = await prisma.income.findUnique({ where: { id: body.incomeId } });
    if (!income) return c.json({ error: 'Income not found' }, 404);
    budgetId = income.budgetId;

    const duplicate = await prisma.transaction.findFirst({
      where: { incomeId: body.incomeId, date: tx.date, id: { not: id } },
    });
    if (duplicate)
      return c.json(
        { error: 'Another transaction is already linked to this income for this occurrence date' },
        409,
      );
  }

  try {
    await ledgerUpdate(id, {
      expenseId: body.expenseId ?? null,
      incomeId: body.incomeId ?? null,
      ...(budgetId ? { budgetId } : {}),
    });

    const full = await prisma.transaction.findUniqueOrThrow({
      where: { id },
      include: { tradeDetail: true, bitcoinPaymentDetail: true },
    });
    return c.json(serializeTransaction(full), 200);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') return c.json({ error: 'Transaction not found' }, 404);
      if (err.code === 'P2002')
        return c.json({ error: 'Duplicate record', details: err.meta }, 409);
    }
    throw err;
  }
});

// ─── DELETE /:id/link ───

const unlinkTransactionRoute = createRoute({
  method: 'delete',
  path: '/{id}/link',
  tags: ['Transactions'],
  summary: 'Unlink a transaction from a recurring source',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      content: { 'application/json': { schema: TransactionSchema } },
      description: 'Transaction unlinked',
    },
    400: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Bad Request' },
    404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Not Found' },
    409: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Conflict' },
  },
});

// @ts-expect-error — @hono/zod-openapi type inference breaks with nullable accountId in TransactionSchema
app.openapi(unlinkTransactionRoute, async (c) => {
  const { id } = c.req.valid('param');

  const tx = await prisma.transaction.findUnique({ where: { id } });
  if (!tx) return c.json({ error: 'Transaction not found' }, 404);

  if (!tx.expenseId && !tx.incomeId) {
    return c.json({ error: 'Transaction is not linked to any recurring source' }, 400);
  }

  try {
    await ledgerUpdate(id, { expenseId: null, incomeId: null });

    const full = await prisma.transaction.findUniqueOrThrow({
      where: { id },
      include: { tradeDetail: true, bitcoinPaymentDetail: true },
    });
    return c.json(serializeTransaction(full), 200);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') return c.json({ error: 'Transaction not found' }, 404);
      if (err.code === 'P2002')
        return c.json({ error: 'Duplicate record', details: err.meta }, 409);
    }
    throw err;
  }
});

export default app;
