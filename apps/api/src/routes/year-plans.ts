import { createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { prisma, Prisma } from '@budget-tracker/db';
import {
  YearPlanResponseSchema,
  CreateYearPlanSchema,
  CarryForwardSchema,
} from '@budget-tracker/core';
import { ErrorSchema, createRouter } from '../lib/errors.js';
import { computeMonthlyEquivalent } from '../lib/budget.js';

const app = createRouter();

/** Serialize a YearPlan record to the response shape (dates → ISO strings). */
function serializeYearPlan(plan: {
  id: string;
  year: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: plan.id,
    year: plan.year,
    status: plan.status as 'DRAFT' | 'ACTIVE' | 'ARCHIVED',
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString(),
  };
}

// ─── GET / — List all year plans ─────────────────────────────────────────────

const listYearPlansRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Year Plans'],
  summary: 'List all year plans',
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(YearPlanResponseSchema) } },
      description: 'Year plans',
    },
  },
});

app.openapi(listYearPlansRoute, async (c) => {
  const plans = await prisma.yearPlan.findMany({ orderBy: { year: 'desc' } });
  return c.json(plans.map(serializeYearPlan), 200);
});

// ─── POST / — Create a DRAFT year plan ──────────────────────────────────────

const createYearPlanRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['Year Plans'],
  summary: 'Create a DRAFT year plan',
  request: {
    body: { content: { 'application/json': { schema: CreateYearPlanSchema } } },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: YearPlanResponseSchema } },
      description: 'Created',
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

app.openapi(createYearPlanRoute, async (c) => {
  const { year } = c.req.valid('json');
  try {
    const plan = await prisma.yearPlan.create({
      data: { year, status: 'DRAFT' },
    });

    // Create a default "Mandatory" budget group if none exist
    const groupCount = await prisma.budgetGroup.count();
    if (groupCount === 0) {
      await prisma.budgetGroup.create({
        data: { name: 'Mandatory', color: 'neutral100' },
      });
    }

    return c.json(serializeYearPlan(plan), 201);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2002')
        return c.json({ error: `Year plan already exists for ${year}` }, 409);
      if (err.code === 'P2025') return c.json({ error: 'Related resource not found' }, 404);
    }
    throw err;
  }
});

// ─── GET /:id — Get year plan by ID ─────────────────────────────────────────

const getYearPlanRoute = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Year Plans'],
  summary: 'Get a year plan by ID',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      content: { 'application/json': { schema: YearPlanResponseSchema } },
      description: 'Year plan',
    },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Not Found',
    },
  },
});

app.openapi(getYearPlanRoute, async (c) => {
  const { id } = c.req.valid('param');
  const plan = await prisma.yearPlan.findUnique({ where: { id } });
  if (!plan) return c.json({ error: 'Year plan not found' }, 404);
  return c.json(serializeYearPlan(plan), 200);
});

// ─── POST /:id/confirm — Confirm a DRAFT plan → ACTIVE ─────────────────────

const confirmYearPlanRoute = createRoute({
  method: 'post',
  path: '/{id}/confirm',
  tags: ['Year Plans'],
  summary: 'Confirm a DRAFT year plan (set to ACTIVE)',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      content: { 'application/json': { schema: YearPlanResponseSchema } },
      description: 'Confirmed',
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

app.openapi(confirmYearPlanRoute, async (c) => {
  const { id } = c.req.valid('param');
  const plan = await prisma.yearPlan.findUnique({ where: { id } });
  if (!plan) return c.json({ error: 'Year plan not found' }, 404);

  if (plan.status !== 'DRAFT') {
    return c.json({ error: 'Only DRAFT plans can be confirmed' }, 400);
  }

  const jan1Utc = Date.UTC(plan.year, 0, 1);
  if (Date.now() < jan1Utc) {
    return c.json({ error: `Cannot confirm plan before January 1 of ${plan.year}` }, 400);
  }

  try {
    const updated = await prisma.yearPlan.update({
      where: { id },
      data: { status: 'ACTIVE' },
    });
    return c.json(serializeYearPlan(updated), 200);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') return c.json({ error: 'Year plan not found' }, 404);
    }
    throw err;
  }
});

// ─── POST /:id/carry-forward — Copy budgets from source year ────────────────

const carryForwardRoute = createRoute({
  method: 'post',
  path: '/{id}/carry-forward',
  tags: ['Year Plans'],
  summary: 'Copy budgets from a source year into this DRAFT plan',
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: CarryForwardSchema } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: YearPlanResponseSchema } },
      description: 'Carry-forward complete',
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

app.openapi(carryForwardRoute, async (c) => {
  const { id } = c.req.valid('param');
  const { sourceYear } = c.req.valid('json');

  // Find target plan
  const targetPlan = await prisma.yearPlan.findUnique({ where: { id } });
  if (!targetPlan) return c.json({ error: 'Year plan not found' }, 404);

  if (targetPlan.status === 'ARCHIVED') {
    return c.json({ error: 'Cannot modify an archived year plan' }, 400);
  }
  if (targetPlan.status !== 'DRAFT') {
    return c.json({ error: 'Only DRAFT plans can receive carry-forward' }, 400);
  }

  // Find source plan
  const sourcePlan = await prisma.yearPlan.findUnique({
    where: { year: sourceYear },
    include: {
      categoryBudgets: {
        include: {
          versions: { orderBy: { effectiveDate: 'desc' }, take: 1 },
        },
      },
    },
  });
  if (!sourcePlan) return c.json({ error: 'Source year plan not found' }, 404);

  const targetJan1 = new Date(Date.UTC(targetPlan.year, 0, 1));

  for (const cb of sourcePlan.categoryBudgets) {
    // Skip soft-deleted budgets
    if (cb.removedAt !== null) continue;

    // Skip if budget no longer exists
    const budget = await prisma.budget.findUnique({
      where: { id: cb.budgetId },
    });
    if (!budget) continue;

    // Must have at least one version
    const latestVersion = cb.versions[0];
    if (!latestVersion) continue;

    const amount = latestVersion.amount.toNumber();
    const frequency = latestVersion.frequency;
    const activeMonths =
      latestVersion.activeMonths.length > 0 ? latestVersion.activeMonths : undefined;
    const monthlyEquivalent = computeMonthlyEquivalent(amount, frequency, activeMonths);

    try {
      await prisma.categoryBudget.create({
        data: {
          yearPlanId: targetPlan.id,
          budgetId: cb.budgetId,
          versions: {
            create: {
              amount,
              frequency,
              monthlyEquivalent,
              activeMonths: latestVersion.activeMonths,
              effectiveDate: targetJan1,
            },
          },
        },
      });
    } catch (err) {
      // P2002 = duplicate — category already exists in target plan, skip it
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        continue;
      }
      throw err;
    }
  }

  // Return the updated target plan
  const updated = await prisma.yearPlan.findUnique({ where: { id } });
  return c.json(serializeYearPlan(updated!), 200);
});

export default app;
