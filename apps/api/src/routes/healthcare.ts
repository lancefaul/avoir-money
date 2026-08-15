import { createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { prisma, Prisma } from '@budget-tracker/db';
import {
  InsurancePolicyWithBalanceSchema,
  CreateInsurancePolicySchema,
  UpdateInsurancePolicySchema,
  UpdateOverridesSchema,
  HealthcareTransactionSchema,
  PolicyYearsSchema,
} from '@budget-tracker/core';
import { ErrorSchema, createRouter } from '../lib/errors.js';
import { serializePolicy, syncOopmToBudget } from '../lib/healthcare.js';
import { today, makeDate } from '../lib/dates.js';

const app = createRouter();

// ─── GET /years ───

const listYearsRoute = createRoute({
  method: 'get',
  path: '/years',
  tags: ['Healthcare'],
  summary: 'List distinct years with insurance policies',
  responses: {
    200: {
      content: { 'application/json': { schema: PolicyYearsSchema } },
      description: 'List of distinct years',
    },
  },
});

app.openapi(listYearsRoute, async (c) => {
  const policies = await prisma.insurancePolicy.findMany({
    select: { year: true },
    distinct: ['year'],
    orderBy: { year: 'desc' },
  });
  return c.json(
    policies.map((p) => p.year),
    200,
  );
});

// ─── GET /policies?year=X ───

const listPoliciesRoute = createRoute({
  method: 'get',
  path: '/policies',
  tags: ['Healthcare'],
  summary: 'List all policies for a year with computed balances',
  request: {
    query: z.object({ year: z.coerce.number().int() }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(InsurancePolicyWithBalanceSchema) } },
      description: 'Policies for the given year',
    },
  },
});

app.openapi(listPoliciesRoute, async (c) => {
  const { year } = c.req.valid('query');
  const policies = await prisma.insurancePolicy.findMany({
    where: { year },
    orderBy: { createdAt: 'desc' },
  });
  const serialized = await Promise.all(policies.map(serializePolicy));
  return c.json(serialized, 200);
});

// ─── GET /policies/:id ───

const getPolicyRoute = createRoute({
  method: 'get',
  path: '/policies/{id}',
  tags: ['Healthcare'],
  summary: 'Get a single policy with balance',
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: InsurancePolicyWithBalanceSchema } },
      description: 'Policy found',
    },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Not Found',
    },
  },
});

app.openapi(getPolicyRoute, async (c) => {
  const { id } = c.req.valid('param');
  const policy = await prisma.insurancePolicy.findUnique({ where: { id } });
  if (!policy) return c.json({ error: 'Insurance policy not found' }, 404);
  return c.json(await serializePolicy(policy), 200);
});

// ─── POST /policies ───

const createPolicyRoute = createRoute({
  method: 'post',
  path: '/policies',
  tags: ['Healthcare'],
  summary: 'Create an insurance policy (auto-freezes existing active policy of same type)',
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: CreateInsurancePolicySchema } },
    },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: InsurancePolicyWithBalanceSchema } },
      description: 'Policy created',
    },
    400: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Bad Request',
    },
  },
});

app.openapi(createPolicyRoute, async (c) => {
  const body = c.req.valid('json');

  const created = await prisma.$transaction(async (tx) => {
    // Create or find INSURANCE budget group (lavender50 for badge backgrounds)
    let insuranceGroup = await tx.budgetGroup.findFirst({ where: { name: 'INSURANCE' } });
    if (!insuranceGroup) {
      insuranceGroup = await tx.budgetGroup.create({
        data: { name: 'INSURANCE', color: 'violet50' },
      });
    }

    const meta = body.metadata as Record<string, unknown> | undefined;
    const insurer = (meta?.insurer as string) || body.employer;
    const typeLabel = body.type.charAt(0) + body.type.slice(1).toLowerCase();
    const budgetName = `${insurer} ${typeLabel} ${body.year}`;

    const policyBudget = await tx.budget.create({
      data: {
        name: budgetName,
        icon: body.type === 'MEDICAL' ? '🏥' : body.type === 'DENTAL' ? '🦷' : '👓',
        groupId: insuranceGroup.id,
        isSystem: true,
      },
    });

    return tx.insurancePolicy.create({
      data: {
        type: body.type,
        year: body.year,
        employer: body.employer,
        premium: body.premium,
        deductibleLimit: body.deductibleLimit ?? null,
        oopmLimit: body.oopmLimit ?? null,
        metadata: body.metadata as Prisma.InputJsonValue,
        budgetId: policyBudget.id,
      },
    });
  });

  return c.json(await serializePolicy(created), 201);
});

// ─── PUT /policies/:id ───

const updatePolicyRoute = createRoute({
  method: 'put',
  path: '/policies/{id}',
  tags: ['Healthcare'],
  summary: 'Update an insurance policy',
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: UpdateInsurancePolicySchema } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: InsurancePolicyWithBalanceSchema } },
      description: 'Policy updated',
    },
    400: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Bad Request',
    },
    403: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Forbidden — frozen policy limit change',
    },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Not Found',
    },
  },
});

app.openapi(updatePolicyRoute, async (c) => {
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');

  const existing = await prisma.insurancePolicy.findUnique({ where: { id } });
  if (!existing) return c.json({ error: 'Insurance policy not found' }, 404);

  if (existing.status === 'CLOSED') {
    return c.json({ error: 'Cannot modify a closed policy' }, 403);
  }

  const mergedDeductible =
    body.deductibleLimit !== undefined
      ? body.deductibleLimit
      : (existing.deductibleLimit?.toNumber() ?? null);
  const mergedOopm =
    body.oopmLimit !== undefined ? body.oopmLimit : (existing.oopmLimit?.toNumber() ?? null);
  if (mergedDeductible != null && mergedOopm != null && mergedOopm < mergedDeductible) {
    return c.json({ error: 'OOPM limit must be >= deductible limit' }, 400);
  }

  try {
    const updated = await prisma.insurancePolicy.update({
      where: { id },
      data: {
        ...body,
        ...(body.metadata !== undefined
          ? { metadata: body.metadata as Prisma.InputJsonValue }
          : {}),
      },
    });
    return c.json(await serializePolicy(updated), 200);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') return c.json({ error: 'Insurance policy not found' }, 404);
    }
    throw err;
  }
});

// ─── PATCH /policies/:id/overrides ───

const updateOverridesRoute = createRoute({
  method: 'patch',
  path: '/policies/{id}/overrides',
  tags: ['Healthcare'],
  summary: 'Toggle secondary insurance overrides',
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: UpdateOverridesSchema } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: InsurancePolicyWithBalanceSchema } },
      description: 'Overrides updated',
    },
    403: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Forbidden — closed policy',
    },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Not Found',
    },
  },
});

app.openapi(updateOverridesRoute, async (c) => {
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');

  const existing = await prisma.insurancePolicy.findUnique({ where: { id } });
  if (!existing) return c.json({ error: 'Insurance policy not found' }, 404);
  if (existing.status === 'CLOSED') return c.json({ error: 'Cannot modify a closed policy' }, 403);

  try {
    const updated = await prisma.insurancePolicy.update({
      where: { id },
      data: body,
    });

    await syncOopmToBudget(id);

    return c.json(await serializePolicy(updated), 200);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') return c.json({ error: 'Insurance policy not found' }, 404);
    }
    throw err;
  }
});

// ─── GET /policies/:id/transactions ───

const listTransactionsRoute = createRoute({
  method: 'get',
  path: '/policies/{id}/transactions',
  tags: ['Healthcare'],
  summary: 'List healthcare transactions for a policy',
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(HealthcareTransactionSchema) } },
      description: 'Healthcare transactions',
    },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Not Found',
    },
  },
});

app.openapi(listTransactionsRoute, async (c) => {
  const { id } = c.req.valid('param');

  const policy = await prisma.insurancePolicy.findUnique({ where: { id } });
  if (!policy) return c.json({ error: 'Insurance policy not found' }, 404);

  if (!policy.budgetId) return c.json([], 200);

  const yearStart = makeDate(policy.year, 0, 1);
  const yearEnd = makeDate(policy.year, 11, 31);

  const transactions = await prisma.transaction.findMany({
    where: {
      type: 'EXPENSE',
      budgetId: policy.budgetId,
      date: { gte: yearStart, lte: yearEnd },
    },
    include: {
      budget: { select: { name: true, icon: true } },
      account: { select: { name: true } },
    },
    orderBy: { date: 'desc' },
  });

  const result = transactions.map((t) => ({
    id: t.id,
    date: t.date,
    name: t.name,
    category: t.budget?.name ?? '',
    categoryIcon: t.budget?.icon ?? null,
    paymentMethod: t.account?.name ?? null,
    amount: t.amount.toNumber(),
  }));

  return c.json(result, 200);
});

// ─── POST /policies/:id/end-coverage ───

const endCoverageRoute = createRoute({
  method: 'post',
  path: '/policies/{id}/end-coverage',
  tags: ['Healthcare'],
  summary: 'End coverage for a policy (still selectable as budget)',
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: InsurancePolicyWithBalanceSchema } },
      description: 'Policy coverage ended',
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

app.openapi(endCoverageRoute, async (c) => {
  const { id } = c.req.valid('param');
  const policy = await prisma.insurancePolicy.findUnique({ where: { id } });
  if (!policy) return c.json({ error: 'Insurance policy not found' }, 404);
  if (policy.status !== 'ACTIVE') {
    return c.json({ error: 'Only active policies can have coverage ended' }, 400);
  }

  const updated = await prisma.insurancePolicy.update({
    where: { id },
    data: { status: 'ENDED', endedOn: today() },
  });
  return c.json(await serializePolicy(updated), 200);
});

// ─── POST /policies/:id/close ───

const closePolicyRoute = createRoute({
  method: 'post',
  path: '/policies/{id}/close',
  tags: ['Healthcare'],
  summary: 'Close a policy (budget no longer selectable)',
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: InsurancePolicyWithBalanceSchema } },
      description: 'Policy closed',
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

app.openapi(closePolicyRoute, async (c) => {
  const { id } = c.req.valid('param');
  const policy = await prisma.insurancePolicy.findUnique({ where: { id } });
  if (!policy) return c.json({ error: 'Insurance policy not found' }, 404);
  if (policy.status !== 'ENDED') {
    return c.json({ error: 'Only policies with ended coverage can be closed' }, 400);
  }

  const updated = await prisma.insurancePolicy.update({
    where: { id },
    data: { status: 'CLOSED', closedOn: today() },
  });
  return c.json(await serializePolicy(updated), 200);
});

// ─── GET /summary?year=X ───

const HealthcareSummarySchema = z.object({
  healthcareBudgetSpent: z.number(),
  medicineBudgetSpent: z.number(),
});

const summaryRoute = createRoute({
  method: 'get',
  path: '/summary',
  tags: ['Healthcare'],
  summary: 'Year-to-date spending for non-insurance healthcare and medicine budgets',
  request: {
    query: z.object({ year: z.coerce.number().int() }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: HealthcareSummarySchema } },
      description: 'Budget spending summary',
    },
  },
});

app.openapi(summaryRoute, async (c) => {
  const { year } = c.req.valid('query');
  const yearStart = makeDate(year, 0, 1);
  const yearEnd = makeDate(year, 11, 31);

  async function budgetSpent(name: string): Promise<number> {
    const budget = await prisma.budget.findFirst({
      where: { name },
      select: { id: true },
    });
    if (!budget) return 0;
    const result = await prisma.transaction.aggregate({
      where: {
        budgetId: budget.id,
        type: 'EXPENSE',
        date: { gte: yearStart, lte: yearEnd },
      },
      _sum: { amount: true },
    });
    return result._sum.amount?.toNumber() ?? 0;
  }

  const [healthcareBudgetSpent, medicineBudgetSpent] = await Promise.all([
    budgetSpent('Healthcare'),
    budgetSpent('Medicine'),
  ]);

  return c.json({ healthcareBudgetSpent, medicineBudgetSpent }, 200);
});

export default app;
