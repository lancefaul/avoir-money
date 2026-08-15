/**
 * Pause / resume / archive / restore action routes for recurring expenses,
 * split from routes/expenses.ts (sub-resource route-split pattern, like
 * transactions.children.ts). Mounted at /expenses alongside the main router.
 */
import { createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { prisma } from '@budget-tracker/db';
import { ExpenseSchema, PauseSourceSchema, ResumeSourceSchema } from '@budget-tracker/core';
import { ErrorSchema, createRouter } from '../lib/errors.js';
import { today } from '../lib/dates.js';
import { computePausedUntil } from '../lib/pause.js';
import { invalidateSchedule } from '../lib/schedule-generator.js';
import { serializeExpense } from '../lib/expense-serialization.js';
import { triggerBudgetRecompute } from '../lib/expense-budget-recompute.js';

const app = createRouter();

// ─── POST /:id/pause ───

const pauseExpenseRoute = createRoute({
  method: 'post',
  path: '/{id}/pause',
  tags: ['Expenses'],
  summary: 'Pause a recurring expense source',
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: PauseSourceSchema } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: ExpenseSchema } },
      description: 'Expense paused',
    },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Not Found',
    },
  },
});

app.openapi(pauseExpenseRoute, async (c) => {
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');

  const expense = await prisma.expense.findUnique({ where: { id } });
  if (!expense) return c.json({ error: 'Expense not found' }, 404);

  const pausedUntil = computePausedUntil(body);
  const record = await prisma.expense.update({
    where: { id },
    data: { pausedUntil },
    include: { budgetExpenseLink: { select: { id: true } } },
  });

  // Pausing changes which occurrences are active — invalidate schedule
  await invalidateSchedule('EXPENSE', id, true);

  // Recompute linked budget — paused expense excluded from baseline
  await triggerBudgetRecompute(id);

  return c.json(serializeExpense(record), 200);
});

// ─── POST /:id/resume ───
const resumeExpenseRoute = createRoute({
  method: 'post',
  path: '/{id}/resume',
  tags: ['Expenses'],
  summary: 'Resume a paused recurring expense source',
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: ResumeSourceSchema } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: ExpenseSchema } },
      description: 'Expense resumed',
    },
    400: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Source is not paused',
    },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Not Found',
    },
  },
});

app.openapi(resumeExpenseRoute, async (c) => {
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');

  const expense = await prisma.expense.findUnique({ where: { id } });
  if (!expense) return c.json({ error: 'Expense not found' }, 404);
  if (!expense.pausedUntil) return c.json({ error: 'Source is not currently paused' }, 400);

  const data: { pausedUntil: null; startDate?: Date } = { pausedUntil: null };
  if (body.immediately) {
    data.startDate = today();
  } else if (body.resumeDate) {
    data.startDate = body.resumeDate;
  }

  const record = await prisma.expense.update({
    where: { id },
    data,
    include: { budgetExpenseLink: { select: { id: true } } },
  });

  // Resuming changes which occurrences are active — invalidate schedule
  await invalidateSchedule('EXPENSE', id, true);

  // Recompute linked budget — resumed expense included in baseline
  await triggerBudgetRecompute(id);

  return c.json(serializeExpense(record), 200);
});

// ─── POST /:id/archive ───
const archiveExpenseRoute = createRoute({
  method: 'post',
  path: '/{id}/archive',
  tags: ['Expenses'],
  summary: 'Archive a recurring expense source',
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: ExpenseSchema } },
      description: 'Expense archived',
    },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Not Found',
    },
    409: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Already archived',
    },
  },
});

app.openapi(archiveExpenseRoute, async (c) => {
  const { id } = c.req.valid('param');

  const expense = await prisma.expense.findUnique({ where: { id } });
  if (!expense) return c.json({ error: 'Expense not found' }, 404);
  if (expense.archivedAt) return c.json({ error: 'Source is already archived' }, 409);

  const record = await prisma.expense.update({
    where: { id },
    data: { archivedAt: new Date() },
    include: { budgetExpenseLink: { select: { id: true } } },
  });

  // Set all PENDING rows to SKIPPED on archive
  await prisma.scheduledTransaction.updateMany({
    where: {
      sourceType: 'EXPENSE',
      sourceId: id,
      status: 'PENDING',
    },
    data: { status: 'SKIPPED' },
  });

  // Unlink from budget — archived expenses should not remain linked
  await prisma.budgetExpenseLink.deleteMany({ where: { expenseId: id } });

  // Recompute linked budget — archived expense no longer contributes
  await triggerBudgetRecompute(id);

  return c.json(serializeExpense(record), 200);
});

// ─── POST /:id/restore ───

const restoreExpenseRoute = createRoute({
  method: 'post',
  path: '/{id}/restore',
  tags: ['Expenses'],
  summary: 'Restore an archived recurring expense source',
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: ExpenseSchema } },
      description: 'Expense restored',
    },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Not Found',
    },
    409: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Not archived',
    },
  },
});

app.openapi(restoreExpenseRoute, async (c) => {
  const { id } = c.req.valid('param');

  const expense = await prisma.expense.findUnique({ where: { id } });
  if (!expense) return c.json({ error: 'Expense not found' }, 404);
  if (!expense.archivedAt) return c.json({ error: 'Source is not archived' }, 409);

  const record = await prisma.expense.update({
    where: { id },
    data: { archivedAt: null },
    include: { budgetExpenseLink: { select: { id: true } } },
  });

  // Recompute linked budget — restored expense included in baseline
  await triggerBudgetRecompute(id);

  return c.json(serializeExpense(record), 200);
});

export default app;
