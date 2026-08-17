import { createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { prisma, Prisma } from '@budget-tracker/db';
import {
  BudgetItemSchema,
  CreateBudgetItemSchema,
  UpdateBudgetItemSchema,
  ListBudgetItemsQuerySchema,
  BudgetGroupModelSchema,
  CreateBudgetGroupSchema,
  UpdateBudgetGroupSchema,
} from '@budget-tracker/core';
import { ErrorSchema, createRouter } from '../lib/errors.js';

type BudgetItem = z.infer<typeof BudgetItemSchema>;

const app = createRouter();

function serializeBudget(r: {
  id: string;
  name: string;
  groupId: string;
  icon: string | null;
  isCustom: boolean;
  isSystem: boolean;
  createdAt: Date;
  group?: { name: string; color: string } | null;
}): BudgetItem {
  return {
    id: r.id,
    name: r.name,
    groupId: r.groupId,
    groupName: r.group?.name,
    groupColor: r.group?.color,
    icon: r.icon,
    isCustom: r.isCustom,
    isSystem: r.isSystem,
    createdAt: r.createdAt,
  };
}

// ─── GET /groups ───
const listGroupsRoute = createRoute({
  method: 'get',
  path: '/groups',
  tags: ['Budgets'],
  summary: 'List budget groups',
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(BudgetGroupModelSchema) } },
      description: 'Groups',
    },
  },
});
app.openapi(listGroupsRoute, async (c) => {
  const groups = await prisma.budgetGroup.findMany({ orderBy: { name: 'asc' } });
  return c.json(groups, 200);
});

// ─── POST /groups ───
const createGroupRoute = createRoute({
  method: 'post',
  path: '/groups',
  tags: ['Budgets'],
  summary: 'Create a budget group',
  request: { body: { content: { 'application/json': { schema: CreateBudgetGroupSchema } } } },
  responses: {
    201: {
      content: { 'application/json': { schema: BudgetGroupModelSchema } },
      description: 'Created',
    },
    409: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Conflict' },
  },
});
app.openapi(createGroupRoute, async (c) => {
  const body = c.req.valid('json');
  try {
    const group = await prisma.budgetGroup.create({ data: body });
    return c.json(group, 201);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2002')
        return c.json({ error: 'Group already exists', details: err.meta }, 409);
    }
    throw err;
  }
});

// ─── PUT /groups/:id ───
const updateGroupRoute = createRoute({
  method: 'put',
  path: '/groups/{id}',
  tags: ['Budgets'],
  summary: 'Update a budget group',
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: UpdateBudgetGroupSchema } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: BudgetGroupModelSchema } },
      description: 'Updated',
    },
    404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Not Found' },
    409: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Conflict' },
  },
});
app.openapi(updateGroupRoute, async (c) => {
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');
  try {
    const group = await prisma.budgetGroup.update({ where: { id }, data: body });
    return c.json(group, 200);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') return c.json({ error: 'Group not found' }, 404);
      if (err.code === 'P2002')
        return c.json({ error: 'Group already exists', details: err.meta }, 409);
    }
    throw err;
  }
});

// ─── DELETE /groups/:id ───
const deleteGroupRoute = createRoute({
  method: 'delete',
  path: '/groups/{id}',
  tags: ['Budgets'],
  summary: 'Delete a budget group (must be empty)',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: { description: 'Deleted' },
    404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Not Found' },
    409: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Group not empty',
    },
  },
});
app.openapi(deleteGroupRoute, async (c) => {
  const { id } = c.req.valid('param');
  const count = await prisma.budget.count({ where: { groupId: id } });
  if (count > 0)
    return c.json({ error: `Group has ${count} budgets. Delete or move them first.` }, 409);
  try {
    await prisma.budgetGroup.delete({ where: { id } });
    return c.body(null, 204);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') return c.json({ error: 'Group not found' }, 404);
    }
    throw err;
  }
});

// ─── GET / ───
const listBudgetsRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Budgets'],
  summary: 'List budgets',
  request: { query: ListBudgetItemsQuerySchema },
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(BudgetItemSchema) } },
      description: 'Budgets',
    },
  },
});
app.openapi(listBudgetsRoute, async (c) => {
  const query = c.req.valid('query');
  const where: Record<string, unknown> = {};
  if (query.groupId) where.groupId = query.groupId;
  if (!query.includeDeleted) where.deletedAt = null;
  const records = await prisma.budget.findMany({
    where,
    include: { group: true },
    orderBy: { name: 'asc' },
  });
  return c.json(records.map(serializeBudget), 200);
});

// ─── POST / ───
const createBudgetRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['Budgets'],
  summary: 'Create a budget',
  request: { body: { content: { 'application/json': { schema: CreateBudgetItemSchema } } } },
  responses: {
    201: { content: { 'application/json': { schema: BudgetItemSchema } }, description: 'Created' },
    400: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Bad Request' },
    409: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Conflict' },
  },
});
app.openapi(createBudgetRoute, async (c) => {
  const body = c.req.valid('json');
  try {
    const record = await prisma.budget.create({
      data: { ...body, isCustom: true },
      include: { group: true },
    });
    return c.json(serializeBudget(record), 201);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2002')
        return c.json({ error: 'Duplicate record', details: err.meta }, 409);
    }
    throw err;
  }
});

// ─── PUT /:id ───
const updateBudgetRoute = createRoute({
  method: 'put',
  path: '/{id}',
  tags: ['Budgets'],
  summary: 'Update a budget',
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: UpdateBudgetItemSchema } } },
  },
  responses: {
    200: { content: { 'application/json': { schema: BudgetItemSchema } }, description: 'Updated' },
    404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Not Found' },
    409: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Conflict' },
  },
});
app.openapi(updateBudgetRoute, async (c) => {
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');
  try {
    const record = await prisma.budget.update({
      where: { id },
      data: body,
      include: { group: true },
    });
    return c.json(serializeBudget(record), 200);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') return c.json({ error: 'Budget not found' }, 404);
      if (err.code === 'P2002')
        return c.json({ error: 'Duplicate record', details: err.meta }, 409);
    }
    throw err;
  }
});

// ─── DELETE /:id ───
const HardDeleteResponseSchema = z.object({
  deleted: z.boolean(),
  transactionsDeleted: z.number().optional(),
  budgetsDeleted: z.number().optional(),
});
const SoftDeleteResponseSchema = z.object({ softDeleted: z.boolean() });

const deleteBudgetRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Budgets'],
  summary: 'Delete a budget (hard or soft)',
  request: {
    params: z.object({ id: z.string() }),
    query: z.object({ mode: z.enum(['hard', 'soft']).default('hard') }),
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.union([HardDeleteResponseSchema, SoftDeleteResponseSchema]),
        },
      },
      description: 'Deleted',
    },
    400: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Bad Request' },
    403: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Forbidden' },
    404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Not Found' },
  },
});
app.openapi(deleteBudgetRoute, async (c) => {
  const { id } = c.req.valid('param');
  const { mode } = c.req.valid('query');

  const budget = await prisma.budget.findUnique({ where: { id } });
  if (!budget) return c.json({ error: 'Budget not found' }, 404);
  if (budget.isSystem) return c.json({ error: 'System budgets cannot be deleted' }, 403);

  if (mode === 'soft') {
    if (budget.deletedAt) {
      return c.json({ error: 'Budget is already soft-deleted' }, 400);
    }
    await prisma.$transaction([
      prisma.budget.update({ where: { id }, data: { deletedAt: new Date() } }),
      prisma.categoryBudget.updateMany({
        where: { budgetId: id },
        data: { removedAt: new Date() },
      }),
    ]);
    return c.json({ softDeleted: true }, 200);
  }

  // Hard delete: remove all associated records, then the budget
  const [expenses, incomes, goals, budgets] = await prisma.$transaction([
    prisma.expense.deleteMany({ where: { budgetId: id } }),
    prisma.income.deleteMany({ where: { budgetId: id } }),
    prisma.budgetGoal.deleteMany({ where: { budgetId: id } }),
    prisma.categoryBudget.deleteMany({ where: { budgetId: id } }),
  ]);
  const transactionsDeleted = expenses.count + incomes.count + goals.count;
  const budgetsDeleted = budgets.count;
  await prisma.budget.delete({ where: { id } });
  return c.json({ deleted: true, transactionsDeleted, budgetsDeleted }, 200);
});

// ─── POST /:id/reassign ───
const ReassignResponseSchema = z.object({
  reassigned: z.number(),
  budgetsDeleted: z.number(),
  deleted: z.boolean(),
});

const reassignBudgetRoute = createRoute({
  method: 'post',
  path: '/{id}/reassign',
  tags: ['Budgets'],
  summary: 'Reassign references and delete',
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: z.object({ targetBudgetId: z.string() }) } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: ReassignResponseSchema } },
      description: 'Done',
    },
    403: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Forbidden' },
    404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Not Found' },
  },
});
app.openapi(reassignBudgetRoute, async (c) => {
  const { id } = c.req.valid('param');
  const { targetBudgetId } = c.req.valid('json');
  const [source, target] = await Promise.all([
    prisma.budget.findUnique({ where: { id } }),
    prisma.budget.findUnique({ where: { id: targetBudgetId } }),
  ]);
  if (!source) return c.json({ error: 'Source not found' }, 404);
  if (!target) return c.json({ error: 'Target not found' }, 404);
  if (source.isSystem) return c.json({ error: 'System budgets cannot be reassigned' }, 403);
  const [e, i, g] = await Promise.all([
    prisma.expense.updateMany({ where: { budgetId: id }, data: { budgetId: targetBudgetId } }),
    prisma.income.updateMany({ where: { budgetId: id }, data: { budgetId: targetBudgetId } }),
    prisma.budgetGoal.updateMany({ where: { budgetId: id }, data: { budgetId: targetBudgetId } }),
  ]);
  // Delete budget data for source budget (BudgetVersions cascade via onDelete: Cascade)
  const allocations = await prisma.categoryBudget.deleteMany({ where: { budgetId: id } });
  await prisma.budget.delete({ where: { id } });
  return c.json(
    { reassigned: e.count + i.count + g.count, budgetsDeleted: allocations.count, deleted: true },
    200,
  );
});

export default app;
