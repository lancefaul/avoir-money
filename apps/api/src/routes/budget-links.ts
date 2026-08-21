import { createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { prisma, Prisma } from '@budget-tracker/db';
import {
  LinkExpenseRequestSchema,
  BulkLinkExpensesRequestSchema,
  BudgetExpenseLinkResponseSchema,
} from '@budget-tracker/core';
import { ErrorSchema, createRouter } from '../lib/errors.js';
import {
  recomputeBudgetFromLinks,
  computeExpenseMonthlyEquivalent,
  resolveCurrentAmount,
} from '../lib/budget-linking.js';
import { localDate, today } from '../lib/dates.js';
import type { Frequency } from '@budget-tracker/core';

const app = createRouter();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function serializeLink(link: {
  id: string;
  categoryBudgetId: string;
  expenseId: string;
  createdAt: Date;
  expense: {
    name: string;
    amount: { toNumber(): number };
    frequency: string;
    amountSchedule: unknown;
    pausedUntil: Date | null;
    archivedAt: Date | null;
  };
}) {
  const amount = link.expense.amount.toNumber();
  const frequency = link.expense.frequency as Frequency;
  const amountSchedule = link.expense.amountSchedule as Record<string, number> | null;
  const nd = localDate(today());
  const currentMonth = nd.month + 1;
  const currentAmount = resolveCurrentAmount({ amount, amountSchedule }, currentMonth);
  const monthlyEquivalent = computeExpenseMonthlyEquivalent(currentAmount, frequency);

  return {
    id: link.id,
    categoryBudgetId: link.categoryBudgetId,
    expenseId: link.expenseId,
    expenseName: link.expense.name,
    expenseAmount: amount,
    expenseFrequency: frequency,
    monthlyEquivalent,
    isPaused: link.expense.pausedUntil !== null,
    isArchived: link.expense.archivedAt !== null,
    createdAt: link.createdAt.toISOString(),
  };
}

// ─── POST /:id/links — Link a single expense ────────────────────────────────

const linkExpenseRoute = createRoute({
  method: 'post',
  path: '/{id}/links',
  tags: ['Budget Links'],
  summary: 'Link an expense to a category budget',
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: LinkExpenseRequestSchema } } },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: BudgetExpenseLinkResponseSchema } },
      description: 'Expense linked',
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

app.openapi(linkExpenseRoute, async (c) => {
  const { id } = c.req.valid('param');
  const { expenseId } = c.req.valid('json');

  // Fetch budget with year plan
  const budget = await prisma.categoryBudget.findUnique({
    where: { id },
    include: { yearPlan: true },
  });
  if (!budget) return c.json({ error: 'Category budget not found' }, 404);
  if (budget.yearPlan.status === 'ARCHIVED') {
    return c.json({ error: 'Cannot modify an archived year plan' }, 400);
  }

  // Fetch expense
  const expense = await prisma.expense.findUnique({ where: { id: expenseId } });
  if (!expense) return c.json({ error: 'Expense not found' }, 404);

  // Validate category match
  if (expense.budgetId !== budget.budgetId) {
    return c.json({ error: 'Expense category does not match budget category' }, 400);
  }

  // Reject ONE_TIME expenses
  if (expense.frequency === 'ONE_TIME') {
    return c.json({ error: 'Cannot link a one-time expense to a budget' }, 400);
  }

  // Check if already linked to another budget
  const existingLink = await prisma.budgetExpenseLink.findUnique({
    where: { expenseId },
  });
  if (existingLink) {
    return c.json({ error: 'Expense is already linked to another budget' }, 409);
  }

  // Create the link
  const link = await prisma.budgetExpenseLink.create({
    data: { categoryBudgetId: id, expenseId },
    include: { expense: true },
  });

  // Recompute budget from links
  const currentMonth = localDate(today()).month + 1;
  await recomputeBudgetFromLinks(id, currentMonth);

  return c.json(serializeLink(link), 201);
});

// ─── POST /:id/links/bulk — Bulk-link expenses ──────────────────────────────

const BulkLinkResultSchema = z.object({
  results: z.array(
    z.union([
      BudgetExpenseLinkResponseSchema,
      z.object({ expenseId: z.string(), error: z.string() }),
    ]),
  ),
});

const bulkLinkRoute = createRoute({
  method: 'post',
  path: '/{id}/links/bulk',
  tags: ['Budget Links'],
  summary: 'Bulk-link expenses to a category budget',
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: BulkLinkExpensesRequestSchema } } },
  },
  responses: {
    207: {
      content: { 'application/json': { schema: BulkLinkResultSchema } },
      description: 'Partial success',
    },
    400: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Bad Request',
    },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Not Found',
    },
  },
});

app.openapi(bulkLinkRoute, async (c) => {
  const { id } = c.req.valid('param');
  const { expenseIds } = c.req.valid('json');

  // Fetch budget with year plan
  const budget = await prisma.categoryBudget.findUnique({
    where: { id },
    include: { yearPlan: true },
  });
  if (!budget) return c.json({ error: 'Category budget not found' }, 404);
  if (budget.yearPlan.status === 'ARCHIVED') {
    return c.json({ error: 'Cannot modify an archived year plan' }, 400);
  }

  const results: Array<
    z.infer<typeof BudgetExpenseLinkResponseSchema> | { expenseId: string; error: string }
  > = [];

  for (const expenseId of expenseIds) {
    // Fetch expense
    const expense = await prisma.expense.findUnique({ where: { id: expenseId } });
    if (!expense) {
      results.push({ expenseId, error: 'Expense not found' });
      continue;
    }

    // Validate category match
    if (expense.budgetId !== budget.budgetId) {
      results.push({ expenseId, error: 'Expense category does not match budget category' });
      continue;
    }

    // Reject ONE_TIME
    if (expense.frequency === 'ONE_TIME') {
      results.push({ expenseId, error: 'Cannot link a one-time expense to a budget' });
      continue;
    }

    // Check if already linked
    const existingLink = await prisma.budgetExpenseLink.findUnique({
      where: { expenseId },
    });
    if (existingLink) {
      results.push({ expenseId, error: 'Expense is already linked to another budget' });
      continue;
    }

    // Create the link
    const link = await prisma.budgetExpenseLink.create({
      data: { categoryBudgetId: id, expenseId },
      include: { expense: true },
    });
    results.push(serializeLink(link));
  }

  // Recompute budget from links after all links are created
  const currentMonth = localDate(today()).month + 1;
  await recomputeBudgetFromLinks(id, currentMonth);

  return c.json({ results }, 207);
});

// ─── DELETE /:id/links/:linkId — Unlink an expense ──────────────────────────

const unlinkExpenseRoute = createRoute({
  method: 'delete',
  path: '/{id}/links/{linkId}',
  tags: ['Budget Links'],
  summary: 'Unlink an expense from a category budget',
  request: {
    params: z.object({ id: z.string(), linkId: z.string() }),
  },
  responses: {
    204: { description: 'Expense unlinked' },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Not Found',
    },
  },
});

app.openapi(unlinkExpenseRoute, async (c) => {
  const { id, linkId } = c.req.valid('param');

  try {
    await prisma.budgetExpenseLink.delete({
      where: { id: linkId, categoryBudgetId: id },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') return c.json({ error: 'Budget expense link not found' }, 404);
    }
    throw err;
  }

  // Recompute budget from links after unlinking
  const currentMonth = localDate(today()).month + 1;
  await recomputeBudgetFromLinks(id, currentMonth);

  return c.body(null, 204);
});

// ─── GET /:id/links — List linked expenses ──────────────────────────────────

const listLinksRoute = createRoute({
  method: 'get',
  path: '/{id}/links',
  tags: ['Budget Links'],
  summary: 'List linked expenses for a category budget',
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(BudgetExpenseLinkResponseSchema) } },
      description: 'Linked expenses',
    },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Not Found',
    },
  },
});

app.openapi(listLinksRoute, async (c) => {
  const { id } = c.req.valid('param');

  const budget = await prisma.categoryBudget.findUnique({ where: { id } });
  if (!budget) return c.json({ error: 'Category budget not found' }, 404);

  const links = await prisma.budgetExpenseLink.findMany({
    where: { categoryBudgetId: id },
    include: { expense: true },
    orderBy: { createdAt: 'asc' },
  });

  return c.json(links.map(serializeLink), 200);
});

export default app;
