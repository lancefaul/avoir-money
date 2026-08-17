import { createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { prisma, Prisma } from '@budget-tracker/db';
import {
  IncomeSchema,
  CreateIncomeSchema,
  UpdateIncomeSchema,
  ListIncomeQuerySchema,
  PauseSourceSchema,
  ResumeSourceSchema,
} from '@budget-tracker/core';
import { ErrorSchema, createRouter } from '../lib/errors.js';
import { ensurePeriodsExist } from '../lib/pay-periods.js';
import { today } from '../lib/dates.js';
import { computePausedUntil } from '../lib/pause.js';
import {
  hasScheduleAffectingChange,
  invalidateSchedule,
  markScheduleDirty,
} from '../lib/schedule-generator.js';
import { serializeIncome } from '../lib/income-serialization.js';

const app = createRouter();

// ─── GET / ───

const listIncomeRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Income'],
  summary: 'List income records',
  request: { query: ListIncomeQuerySchema },
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(IncomeSchema) } },
      description: 'List of income records',
    },
  },
});

app.openapi(listIncomeRoute, async (c) => {
  const query = c.req.valid('query');
  const where: Record<string, unknown> = {};
  if (query.frequency) where['frequency'] = query.frequency;
  if (query.budgetId) where['budgetId'] = query.budgetId;

  // Filter by archive status; default to active-only (archivedAt IS NULL)
  if (query.archived === true) {
    where['archivedAt'] = { not: null };
  } else {
    where['archivedAt'] = null;
  }

  const records = await prisma.income.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: query.limit,
    skip: query.offset,
  });
  return c.json(records.map(serializeIncome), 200);
});

// ─── POST / ───

const createIncomeRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['Income'],
  summary: 'Create an income record',
  request: {
    body: { content: { 'application/json': { schema: CreateIncomeSchema } } },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: IncomeSchema } },
      description: 'Income record created',
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

app.openapi(createIncomeRoute, async (c) => {
  const body = c.req.valid('json');
  const createData = body as Prisma.IncomeUncheckedCreateInput;
  try {
    const record = await prisma.income.create({ data: createData });
    // Auto-generate pay periods — respects end date if set
    await ensurePeriodsExist(record.endDate);
    // Mark schedule dirty so the lazy generator picks up the new income
    markScheduleDirty();
    return c.json(serializeIncome(record), 201);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2002')
        return c.json({ error: 'Duplicate record', details: err.meta }, 409);
    }
    throw err;
  }
});

// ─── GET /:id ───

const getIncomeRoute = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Income'],
  summary: 'Get income record by ID',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      content: { 'application/json': { schema: IncomeSchema } },
      description: 'Income record found',
    },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Not Found',
    },
  },
});

app.openapi(getIncomeRoute, async (c) => {
  const { id } = c.req.valid('param');
  const record = await prisma.income.findUnique({ where: { id } });
  if (!record) return c.json({ error: 'Income record not found' }, 404);
  return c.json(serializeIncome(record), 200);
});

// ─── PUT /:id ───

const updateIncomeRoute = createRoute({
  method: 'put',
  path: '/{id}',
  tags: ['Income'],
  summary: 'Update an income record',
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: UpdateIncomeSchema } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: IncomeSchema } },
      description: 'Income record updated',
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

app.openapi(updateIncomeRoute, async (c) => {
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');
  const updateData = body as Prisma.IncomeUncheckedUpdateInput;
  try {
    const record = await prisma.income.update({ where: { id }, data: updateData });

    // When schedule-affecting fields change, delete PENDING + SNOOZED rows so
    // the lazy generator recreates them with the correct dates/amounts.
    // SNOOZED rows must also go because their due dates are no longer valid.
    if (hasScheduleAffectingChange(updateData)) {
      await invalidateSchedule('INCOME', id, true);
    } else if ('amount' in updateData || 'amountSchedule' in updateData) {
      // Only propagate amount changes if the schedule itself didn't change
      await prisma.scheduledTransaction.updateMany({
        where: {
          sourceType: 'INCOME',
          sourceId: id,
          status: 'PENDING',
          dueDate: { gt: today() },
        },
        data: { expectedAmount: Number(record.amount) },
      });
    }

    return c.json(serializeIncome(record), 200);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') return c.json({ error: 'Income record not found' }, 404);
      if (err.code === 'P2002')
        return c.json({ error: 'Duplicate record', details: err.meta }, 409);
    }
    throw err;
  }
});

// ─── POST /:id/pause ───

const pauseIncomeRoute = createRoute({
  method: 'post',
  path: '/{id}/pause',
  tags: ['Income'],
  summary: 'Pause a recurring income source',
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: PauseSourceSchema } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: IncomeSchema } },
      description: 'Income paused',
    },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Not Found',
    },
  },
});

app.openapi(pauseIncomeRoute, async (c) => {
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');

  const income = await prisma.income.findUnique({ where: { id } });
  if (!income) return c.json({ error: 'Income not found' }, 404);

  const pausedUntil = computePausedUntil(body);
  const record = await prisma.income.update({
    where: { id },
    data: { pausedUntil },
  });

  // Pausing changes which occurrences are active — invalidate schedule
  await invalidateSchedule('INCOME', id, true);

  return c.json(serializeIncome(record), 200);
});

// ─── POST /:id/resume ───

const resumeIncomeRoute = createRoute({
  method: 'post',
  path: '/{id}/resume',
  tags: ['Income'],
  summary: 'Resume a paused recurring income source',
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: ResumeSourceSchema } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: IncomeSchema } },
      description: 'Income resumed',
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

app.openapi(resumeIncomeRoute, async (c) => {
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');

  const income = await prisma.income.findUnique({ where: { id } });
  if (!income) return c.json({ error: 'Income not found' }, 404);
  if (!income.pausedUntil) return c.json({ error: 'Source is not currently paused' }, 400);

  const data: { pausedUntil: null; startDate?: Date } = { pausedUntil: null };
  if (body.immediately) {
    data.startDate = today();
  } else if (body.resumeDate) {
    data.startDate = body.resumeDate;
  }

  const record = await prisma.income.update({ where: { id }, data });

  // Resuming changes which occurrences are active — invalidate schedule
  await invalidateSchedule('INCOME', id, true);

  return c.json(serializeIncome(record), 200);
});

// ─── POST /:id/archive ───

const archiveIncomeRoute = createRoute({
  method: 'post',
  path: '/{id}/archive',
  tags: ['Income'],
  summary: 'Archive a recurring income source',
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: IncomeSchema } },
      description: 'Income archived',
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

app.openapi(archiveIncomeRoute, async (c) => {
  const { id } = c.req.valid('param');

  const income = await prisma.income.findUnique({ where: { id } });
  if (!income) return c.json({ error: 'Income record not found' }, 404);
  if (income.archivedAt) return c.json({ error: 'Source is already archived' }, 409);

  const record = await prisma.income.update({
    where: { id },
    data: { archivedAt: new Date() },
  });

  // Set all PENDING rows to SKIPPED on archive
  await prisma.scheduledTransaction.updateMany({
    where: {
      sourceType: 'INCOME',
      sourceId: id,
      status: 'PENDING',
    },
    data: { status: 'SKIPPED' },
  });

  return c.json(serializeIncome(record), 200);
});

// ─── POST /:id/restore ───

const restoreIncomeRoute = createRoute({
  method: 'post',
  path: '/{id}/restore',
  tags: ['Income'],
  summary: 'Restore an archived recurring income source',
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: IncomeSchema } },
      description: 'Income restored',
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

app.openapi(restoreIncomeRoute, async (c) => {
  const { id } = c.req.valid('param');

  const income = await prisma.income.findUnique({ where: { id } });
  if (!income) return c.json({ error: 'Income record not found' }, 404);
  if (!income.archivedAt) return c.json({ error: 'Source is not archived' }, 409);

  const record = await prisma.income.update({
    where: { id },
    data: { archivedAt: null },
  });
  return c.json(serializeIncome(record), 200);
});

// ─── DELETE /:id ───

const deleteIncomeRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Income'],
  summary: 'Delete an income record',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: { description: 'Income record deleted' },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Not Found',
    },
    409: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Cannot delete archived income',
    },
  },
});

app.openapi(deleteIncomeRoute, async (c) => {
  const { id } = c.req.valid('param');

  const income = await prisma.income.findUnique({ where: { id } });
  if (!income) return c.json({ error: 'Income record not found' }, 404);
  if (income.archivedAt)
    return c.json({ error: 'Cannot delete an archived source. Restore it first.' }, 409);

  try {
    // Set all PENDING rows to SKIPPED before deleting
    await prisma.scheduledTransaction.updateMany({
      where: {
        sourceType: 'INCOME',
        sourceId: id,
        status: 'PENDING',
      },
      data: { status: 'SKIPPED' },
    });

    await prisma.income.delete({ where: { id } });
    return c.body(null, 204);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') return c.json({ error: 'Income record not found' }, 404);
    }
    throw err;
  }
});

export default app;
