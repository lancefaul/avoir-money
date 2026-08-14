import { createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { prisma, Prisma } from '@budget-tracker/db';
import {
  CreateCategoryBudgetSchema,
  UpdateCategoryBudgetSchema,
  CategoryBudgetResponseSchema,
  BudgetStatusResponseSchema,
  BudgetHistoryResponseSchema,
} from '@budget-tracker/core';
import { ErrorSchema, createRouter } from '../lib/errors.js';
import { computeMonthlyEquivalent, resolveEffectiveVersion } from '../lib/budget.js';
import { localDate, today } from '../lib/dates.js';
import {
  serializeVersion,
  serializeCategoryBudget,
  budgetInclude,
} from '../lib/category-budget-serialization.js';
import { listBudgetStatuses } from '../lib/category-budget-status.js';

const app = createRouter();

// ─── GET / — List budgets for a year, resolved to a specific month ──────────

const listBudgetsRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Category Budgets'],
  summary: 'List budgets for a year plan, resolved to a specific month',
  request: {
    query: z.object({
      yearPlanId: z.string(),
      month: z.coerce.number().int().min(1).max(12).optional(),
      year: z.coerce.number().int().optional(),
      includeSeasonal: z.coerce.boolean().optional().default(false),
      periodStart: z.coerce.date().optional(),
      periodEnd: z.coerce.date().optional(),
      viewMode: z.enum(['PAY_PERIOD', 'MONTHLY', 'ANNUAL']).optional(),
    }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(BudgetStatusResponseSchema) } },
      description: 'Budgets with status',
    },
    404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Not Found' },
  },
});

app.openapi(listBudgetsRoute, async (c) => {
  const query = c.req.valid('query');
  const results = await listBudgetStatuses(query);
  if (!results) return c.json({ error: 'Year plan not found' }, 404);
  return c.json(results, 200);
});

// ─── POST / — Add a category to a year plan ─────────────────────────────────

const createBudgetRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['Category Budgets'],
  summary: 'Add a category budget to a year plan',
  request: {
    body: {
      content: {
        'application/json': {
          schema: CreateCategoryBudgetSchema.innerType(),
        },
      },
    },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: CategoryBudgetResponseSchema } },
      description: 'Created',
    },
    400: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Bad Request' },
    404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Not Found' },
    409: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Conflict' },
  },
});

app.openapi(createBudgetRoute, async (c) => {
  const body = c.req.valid('json');
  const {
    yearPlanId,
    budgetId: bodyBudgetId,
    amount,
    frequency,
    effectiveMonth,
    activeMonths,
  } = body;

  const yearPlan = await prisma.yearPlan.findUnique({ where: { id: yearPlanId } });
  if (!yearPlan) return c.json({ error: 'Year plan not found' }, 404);
  if (yearPlan.status === 'ARCHIVED')
    return c.json({ error: 'Cannot modify an archived year plan' }, 400);

  const budget = await prisma.budget.findUnique({ where: { id: bodyBudgetId } });
  if (!budget) return c.json({ error: 'Budget not found' }, 404);

  const monthlyEquivalent = computeMonthlyEquivalent(
    amount,
    frequency,
    activeMonths && activeMonths.length > 0 ? activeMonths : undefined,
  );
  const effectiveDate = new Date(Date.UTC(yearPlan.year, effectiveMonth - 1, 1));

  try {
    const budget = await prisma.categoryBudget.create({
      data: {
        yearPlanId,
        budgetId: bodyBudgetId,
        versions: {
          create: {
            amount,
            frequency,
            monthlyEquivalent,
            activeMonths: activeMonths ?? [],
            effectiveDate,
          },
        },
      },
      include: budgetInclude,
    });
    return c.json(serializeCategoryBudget(budget, budget.versions[0] ?? null), 201);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2002')
        return c.json(
          {
            error: `Budget already exists for this category in ${yearPlan.year}`,
            details: err.meta,
          },
          409,
        );
    }
    throw err;
  }
});

// ─── GET /:id — Get a single category budget ────────────────────────────────

const getBudgetRoute = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Category Budgets'],
  summary: 'Get a category budget with resolved version',
  request: {
    params: z.object({ id: z.string() }),
    query: z.object({
      month: z.coerce.number().int().min(1).max(12).optional(),
      year: z.coerce.number().int().optional(),
    }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: CategoryBudgetResponseSchema } },
      description: 'Category budget',
    },
    404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Not Found' },
  },
});

app.openapi(getBudgetRoute, async (c) => {
  const { id } = c.req.valid('param');
  const query = c.req.valid('query');
  const now = today();
  const nd = localDate(now);
  const month = query.month ?? nd.month + 1;
  const year = query.year ?? nd.year;

  const budget = await prisma.categoryBudget.findUnique({ where: { id }, include: budgetInclude });
  if (!budget) return c.json({ error: 'Category budget not found' }, 404);

  const version = resolveEffectiveVersion(budget.versions, month, year);
  return c.json(serializeCategoryBudget(budget, version), 200);
});

// ─── PUT /:id — Update a budget (create new version) ────────────────────────

const updateBudgetRoute = createRoute({
  method: 'put',
  path: '/{id}',
  tags: ['Category Budgets'],
  summary: 'Update a category budget (creates a new version)',
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: UpdateCategoryBudgetSchema } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: CategoryBudgetResponseSchema } },
      description: 'Updated',
    },
    400: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Bad Request' },
    404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Not Found' },
  },
});

app.openapi(updateBudgetRoute, async (c) => {
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');

  const budget = await prisma.categoryBudget.findUnique({
    where: { id },
    include: { yearPlan: true, versions: { orderBy: { effectiveDate: 'desc' } } },
  });
  if (!budget) return c.json({ error: 'Category budget not found' }, 404);
  if (budget.yearPlan.status === 'ARCHIVED')
    return c.json({ error: 'Cannot modify an archived year plan' }, 400);

  // Update doneForYear flag if provided (before version upsert)
  if (body.doneForYear !== undefined) {
    await prisma.categoryBudget.update({ where: { id }, data: { doneForYear: body.doneForYear } });
  }

  const latest = budget.versions[0];
  const amount = body.amount ?? latest?.amount.toNumber() ?? 0;
  const frequency = body.frequency ?? latest?.frequency ?? 'MONTHLY';
  const effectiveMonth =
    body.effectiveMonth ?? (latest ? latest.effectiveDate.getUTCMonth() + 1 : 1);
  const activeMonths = body.activeMonths ?? latest?.activeMonths ?? [];

  const manualOverride = body.manualOverride ?? latest?.manualOverride ?? false;
  const monthlyEquivalent = computeMonthlyEquivalent(
    amount,
    frequency,
    activeMonths.length > 0 ? activeMonths : undefined,
  );
  const effectiveDate = new Date(Date.UTC(budget.yearPlan.year, effectiveMonth - 1, 1));

  // Upsert: if a version with the same effectiveDate exists, replace it.
  // Also remove any later versions with amount=0 (leftover from "no track" state)
  // so the new version takes effect going forward.
  const existing = budget.versions.find(
    (v) => v.effectiveDate.getTime() === effectiveDate.getTime(),
  );
  if (existing) await prisma.budgetVersion.delete({ where: { id: existing.id } });

  // Remove zero-amount versions that come after the new effective date
  // (these are "no track" placeholders that would override the new amount)
  const laterZeroVersions = budget.versions.filter(
    (v) =>
      v.effectiveDate.getTime() > effectiveDate.getTime() &&
      v.amount.toNumber() === 0 &&
      v.id !== existing?.id,
  );
  if (laterZeroVersions.length > 0) {
    await prisma.budgetVersion.deleteMany({
      where: { id: { in: laterZeroVersions.map((v) => v.id) } },
    });
  }

  await prisma.budgetVersion.create({
    data: {
      categoryBudgetId: id,
      amount,
      frequency,
      monthlyEquivalent,
      activeMonths,
      effectiveDate,
      manualOverride,
    },
  });

  const updated = await prisma.categoryBudget.findUnique({ where: { id }, include: budgetInclude });
  const resolvedVersion = resolveEffectiveVersion(
    updated!.versions,
    effectiveMonth,
    budget.yearPlan.year,
  );
  return c.json(serializeCategoryBudget(updated!, resolvedVersion), 200);
});

// ─── DELETE /:id — Soft-delete ───────────────────────────────────────────────

const deleteBudgetRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Category Budgets'],
  summary: 'Soft-delete a category budget',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: { description: 'Deleted' },
    400: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Bad Request' },
    404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Not Found' },
  },
});

app.openapi(deleteBudgetRoute, async (c) => {
  const { id } = c.req.valid('param');
  const budget = await prisma.categoryBudget.findUnique({
    where: { id },
    include: { yearPlan: true },
  });
  if (!budget) return c.json({ error: 'Category budget not found' }, 404);
  if (budget.yearPlan.status === 'ARCHIVED')
    return c.json({ error: 'Cannot modify an archived year plan' }, 400);

  await prisma.categoryBudget.update({ where: { id }, data: { removedAt: new Date() } });
  return c.body(null, 204);
});

// ─── POST /:id/restore — Restore a soft-deleted budget ──────────────────────

const restoreBudgetRoute = createRoute({
  method: 'post',
  path: '/{id}/restore',
  tags: ['Category Budgets'],
  summary: 'Restore a soft-deleted category budget',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      content: { 'application/json': { schema: CategoryBudgetResponseSchema } },
      description: 'Restored',
    },
    400: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Bad Request' },
    404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Not Found' },
  },
});

app.openapi(restoreBudgetRoute, async (c) => {
  const { id } = c.req.valid('param');
  const budget = await prisma.categoryBudget.findUnique({
    where: { id },
    include: { yearPlan: true },
  });
  if (!budget) return c.json({ error: 'Category budget not found' }, 404);
  if (budget.yearPlan.status === 'ARCHIVED')
    return c.json({ error: 'Cannot modify an archived year plan' }, 400);

  const restored = await prisma.categoryBudget.update({
    where: { id },
    data: { removedAt: null },
    include: budgetInclude,
  });
  const now = today();
  const nd = localDate(now);
  const version = resolveEffectiveVersion(restored.versions, nd.month + 1, nd.year);
  return c.json(serializeCategoryBudget(restored, version), 200);
});

// ─── GET /:id/history — Get all versions ─────────────────────────────────────

const budgetHistoryRoute = createRoute({
  method: 'get',
  path: '/{id}/history',
  tags: ['Category Budgets'],
  summary: 'Get all budget versions for a category budget',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      content: { 'application/json': { schema: BudgetHistoryResponseSchema } },
      description: 'Budget history',
    },
    404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Not Found' },
  },
});

app.openapi(budgetHistoryRoute, async (c) => {
  const { id } = c.req.valid('param');
  const budget = await prisma.categoryBudget.findUnique({
    where: { id },
    include: { versions: { orderBy: { effectiveDate: 'desc' } } },
  });
  if (!budget) return c.json({ error: 'Category budget not found' }, 404);

  return c.json(
    {
      id: budget.id,
      categoryBudgetId: budget.id,
      versions: budget.versions.map(serializeVersion),
    },
    200,
  );
});

export default app;
