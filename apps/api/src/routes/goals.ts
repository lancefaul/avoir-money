import { createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { prisma, Prisma } from '@budget-tracker/db';
import {
  BudgetGoalSchema,
  CreateBudgetGoalSchema,
  UpdateBudgetGoalSchema,
} from '@budget-tracker/core';
import { ErrorSchema, createRouter } from '../lib/errors.js';

type BudgetGoal = z.infer<typeof BudgetGoalSchema>;

const app = createRouter();

function serializeGoal(r: {
  id: string;
  name: string;
  type: string;
  targetAmount: { toNumber(): number };
  currentAmount: { toNumber(): number };
  budgetId: string | null;
  deadline: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): BudgetGoal {
  return {
    id: r.id,
    name: r.name,
    type: r.type as BudgetGoal['type'],
    targetAmount: Number(r.targetAmount),
    currentAmount: Number(r.currentAmount),
    budgetId: r.budgetId,
    deadline: r.deadline,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

// ─── GET / ───

const listGoalsRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Goals'],
  summary: 'List all budget goals',
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(BudgetGoalSchema) } },
      description: 'List of budget goals',
    },
  },
});

app.openapi(listGoalsRoute, async (c) => {
  const goals = await prisma.budgetGoal.findMany({ orderBy: { createdAt: 'desc' } });
  return c.json(goals.map(serializeGoal), 200);
});

// ─── POST / ───

const createGoalRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['Goals'],
  summary: 'Create a budget goal',
  request: {
    body: { content: { 'application/json': { schema: CreateBudgetGoalSchema } } },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: BudgetGoalSchema } },
      description: 'Budget goal created',
    },
    400: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Bad Request',
    },
    409: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Conflict',
    },
  },
});

app.openapi(createGoalRoute, async (c) => {
  const body = c.req.valid('json');
  try {
    const goal = await prisma.budgetGoal.create({ data: body });
    return c.json(serializeGoal(goal), 201);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2002')
        return c.json({ error: 'Duplicate record', details: err.meta }, 409);
    }
    throw err;
  }
});

// ─── PUT /:id ───

const updateGoalRoute = createRoute({
  method: 'put',
  path: '/{id}',
  tags: ['Goals'],
  summary: 'Update a budget goal',
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: UpdateBudgetGoalSchema } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: BudgetGoalSchema } },
      description: 'Budget goal updated',
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

app.openapi(updateGoalRoute, async (c) => {
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');
  try {
    const goal = await prisma.budgetGoal.update({ where: { id }, data: body });
    return c.json(serializeGoal(goal), 200);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') return c.json({ error: 'Budget goal not found' }, 404);
      if (err.code === 'P2002')
        return c.json({ error: 'Duplicate record', details: err.meta }, 409);
    }
    throw err;
  }
});

// ─── DELETE /:id ───

const deleteGoalRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Goals'],
  summary: 'Delete a budget goal',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: { description: 'Budget goal deleted' },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Not Found',
    },
  },
});

app.openapi(deleteGoalRoute, async (c) => {
  const { id } = c.req.valid('param');
  try {
    await prisma.budgetGoal.delete({ where: { id } });
    return c.body(null, 204);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') return c.json({ error: 'Budget goal not found' }, 404);
    }
    throw err;
  }
});

export default app;
