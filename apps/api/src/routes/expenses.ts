import { createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { prisma, Prisma } from '@budget-tracker/db';
import {
  ExpenseSchema,
  CreateExpenseSchema,
  UpdateExpenseSchema,
  ListExpensesQuerySchema,
} from '@budget-tracker/core';
import { ErrorSchema, createRouter } from '../lib/errors.js';
import { ensurePeriodsExist } from '../lib/pay-periods.js';
import {
  hasScheduleAffectingChange,
  invalidateSchedule,
  markScheduleDirty,
} from '../lib/schedule-generator.js';
import { serializeExpense } from '../lib/expense-serialization.js';
import { triggerBudgetRecompute } from '../lib/expense-budget-recompute.js';

const app = createRouter();

// ─── GET / ───

const listExpensesRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Expenses'],
  summary: 'List expenses',
  request: { query: ListExpensesQuerySchema },
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(ExpenseSchema) } },
      description: 'List of expenses',
    },
  },
});

app.openapi(listExpensesRoute, async (c) => {
  const query = c.req.valid('query');
  const where: Record<string, unknown> = {};
  if (query.budgetId) where['budgetId'] = query.budgetId;
  if (query.accountId) where['accountId'] = query.accountId;
  if (query.frequency) where['frequency'] = query.frequency;
  if (query.isAutomatic !== undefined) where['isAutomatic'] = query.isAutomatic;

  // Filter by archive status; default to active-only (archivedAt IS NULL)
  if (query.archived === true) {
    where['archivedAt'] = { not: null };
  } else {
    where['archivedAt'] = null;
  }

  const records = await prisma.expense.findMany({
    where,
    orderBy: { name: 'asc' },
    take: query.limit,
    skip: query.offset,
    include: {
      debts: { select: { id: true }, take: 1 },
      budgetExpenseLink: { select: { id: true } },
    },
  });
  return c.json(
    records.map((r) => serializeExpense(r, r.debts[0]?.id ?? null)),
    200,
  );
});

// ─── POST / ───

const createExpenseRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['Expenses'],
  summary: 'Create an expense',
  request: {
    body: { content: { 'application/json': { schema: CreateExpenseSchema } } },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: ExpenseSchema } },
      description: 'Expense created',
    },
    400: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Bad Request',
    },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Linked debt not found',
    },
  },
});

app.openapi(createExpenseRoute, async (c) => {
  const body = c.req.valid('json');
  const { linkedDebtId, ...restData } = body;
  const expenseData = restData as Prisma.ExpenseUncheckedCreateInput;
  const record = await prisma.expense.create({ data: expenseData });

  if (linkedDebtId) {
    try {
      await prisma.debt.update({
        where: { id: linkedDebtId },
        data: { linkedExpenseId: record.id },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === 'P2025') return c.json({ error: 'Linked debt not found' }, 404);
      }
      throw err;
    }
  }

  // Auto-generate pay periods 2 years out
  await ensurePeriodsExist();
  // Mark schedule dirty so the lazy generator picks up the new expense
  markScheduleDirty();
  return c.json(serializeExpense(record, linkedDebtId ?? null), 201);
});

// ─── GET /:id ───

const getExpenseRoute = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Expenses'],
  summary: 'Get expense by ID',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      content: { 'application/json': { schema: ExpenseSchema } },
      description: 'Expense found',
    },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Not Found',
    },
  },
});

app.openapi(getExpenseRoute, async (c) => {
  const { id } = c.req.valid('param');
  const record = await prisma.expense.findUnique({
    where: { id },
    include: { budgetExpenseLink: { select: { id: true } } },
  });
  if (!record) return c.json({ error: 'Expense not found' }, 404);
  const linkedDebt = await prisma.debt.findFirst({
    where: { linkedExpenseId: id },
    select: { id: true },
  });
  return c.json(serializeExpense(record, linkedDebt?.id ?? null), 200);
});

// ─── PUT /:id ───

const updateExpenseRoute = createRoute({
  method: 'put',
  path: '/{id}',
  tags: ['Expenses'],
  summary: 'Update an expense',
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: UpdateExpenseSchema } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: ExpenseSchema } },
      description: 'Expense updated',
    },
    400: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Bad Request',
    },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Not Found',
    },
    409: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Conflict',
    },
  },
});

app.openapi(updateExpenseRoute, async (c) => {
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');
  const linkedDebtIdProvided = 'linkedDebtId' in body;
  const { linkedDebtId, ...restExpenseData } = body;
  const expenseData = restExpenseData;
  try {
    const record = await prisma.expense.update({ where: { id }, data: expenseData });

    // When schedule-affecting fields change, delete PENDING + SNOOZED rows so
    // the lazy generator recreates them with the correct dates/amounts.
    // SNOOZED rows must also go because their due dates are no longer valid.
    if (hasScheduleAffectingChange(expenseData)) {
      await invalidateSchedule('EXPENSE', id, true);
    } else if ('amount' in expenseData || 'amountSchedule' in expenseData) {
      // Amount or schedule changed — invalidate so the generator recreates
      // rows with correct amounts (including utility reading resolution).
      await invalidateSchedule('EXPENSE', id);
    }

    if (linkedDebtIdProvided) {
      const currentLinkedDebt = await prisma.debt.findFirst({
        where: { linkedExpenseId: id },
        select: { id: true },
      });

      if (currentLinkedDebt && currentLinkedDebt.id !== linkedDebtId) {
        await prisma.debt.update({
          where: { id: currentLinkedDebt.id },
          data: { linkedExpenseId: null },
        });
      }

      if (linkedDebtId) {
        await prisma.debt.update({
          where: { id: linkedDebtId },
          data: { linkedExpenseId: id },
        });
      }
    }

    const finalLinkedDebt = await prisma.debt.findFirst({
      where: { linkedExpenseId: id },
      select: { id: true },
    });

    // Recompute linked budget if expense amount/schedule/frequency changed
    await triggerBudgetRecompute(id);

    return c.json(serializeExpense(record, finalLinkedDebt?.id ?? null), 200);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') return c.json({ error: 'Expense not found' }, 404);
      if (err.code === 'P2002')
        return c.json({ error: 'Duplicate record', details: err.meta }, 409);
    }
    throw err;
  }
});

// ─── DELETE /:id ───

const deleteExpenseRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Expenses'],
  summary: 'Delete an expense',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: { description: 'Expense deleted' },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Not Found',
    },
    409: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Cannot delete archived expense',
    },
  },
});

app.openapi(deleteExpenseRoute, async (c) => {
  const { id } = c.req.valid('param');

  const expense = await prisma.expense.findUnique({ where: { id } });
  if (!expense) return c.json({ error: 'Expense not found' }, 404);
  if (expense.archivedAt)
    return c.json({ error: 'Cannot delete an archived source. Restore it first.' }, 409);

  try {
    // Set all PENDING rows to SKIPPED before deleting
    await prisma.scheduledTransaction.updateMany({
      where: {
        sourceType: 'EXPENSE',
        sourceId: id,
        status: 'PENDING',
      },
      data: { status: 'SKIPPED' },
    });

    await prisma.expense.delete({ where: { id } });
    return c.body(null, 204);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') return c.json({ error: 'Expense not found' }, 404);
    }
    throw err;
  }
});

export default app;
