import { createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { prisma, Prisma } from '@budget-tracker/db';
import {
  UtilityReadingSchema,
  CreateUtilityReadingSchema,
  UpdateUtilityReadingSchema,
  ListUtilitiesQuerySchema,
} from '@budget-tracker/core';
import { ErrorSchema, createRouter } from '../lib/errors.js';
import { localDate, monthRange } from '../lib/dates.js';
import { markScheduleDirty, invalidateSchedule } from '../lib/schedule-generator.js';
import { computeUtilityTotalBill } from '../lib/recurring.js';
import { ledgerUpdate } from '../lib/lifecycle/index.js';

type UtilityReading = z.infer<typeof UtilityReadingSchema>;

// ─── Helpers ───

/**
 * Invalidate scheduled transactions for the expense linked to a utility service.
 * When a utility reading changes, the PENDING rows for the linked expense must
 * be deleted so the lazy generator recreates them with the correct amounts.
 */
async function invalidateLinkedExpenseSchedule(serviceId: string): Promise<void> {
  const service = await prisma.utilityService.findUnique({
    where: { id: serviceId },
    select: { expenseId: true },
  });
  if (service?.expenseId) {
    await invalidateSchedule('EXPENSE', service.expenseId);
  } else {
    // No linked expense — just mark dirty so next generation picks up any new links
    markScheduleDirty();
  }
}

/** Convert Prisma Decimal fields to plain numbers for JSON serialization */
function serializeReading(r: {
  id: string;
  serviceId: string;
  billDate: Date;
  dueDate: Date | null;
  usage: { toNumber(): number } | null;
  cost: { toNumber(): number };
  unitCost: { toNumber(): number } | null;
  convenienceFee: { toNumber(): number } | null;
  convenienceFeeType: string | null;
  otherFees: { toNumber(): number } | null;
  details: unknown;
  createdAt: Date;
}): UtilityReading {
  return {
    id: r.id,
    serviceId: r.serviceId,
    billDate: r.billDate,
    dueDate: r.dueDate,
    usage: r.usage !== null ? Number(r.usage) : null,
    cost: Number(r.cost),
    unitCost: r.unitCost !== null ? Number(r.unitCost) : null,
    convenienceFee: r.convenienceFee !== null ? Number(r.convenienceFee) : null,
    convenienceFeeType: r.convenienceFeeType,
    otherFees: r.otherFees !== null ? Number(r.otherFees) : null,
    details: r.details as Record<string, unknown> | null,
    createdAt: r.createdAt,
  };
}

const app = createRouter();

// ─── Param schemas ───

const readingIdParam = z.object({ id: z.string() });

// ═══════════════════════════════════════════════════════════════════════════════
// Reading CRUD
// ═══════════════════════════════════════════════════════════════════════════════

// ─── GET /readings ───

const listReadingsRoute = createRoute({
  method: 'get',
  path: '/readings',
  tags: ['Utility Readings'],
  summary: 'List utility readings',
  request: { query: ListUtilitiesQuerySchema },
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(UtilityReadingSchema) } },
      description: 'List of utility readings',
    },
  },
});

app.openapi(listReadingsRoute, async (c) => {
  const query = c.req.valid('query');
  const where: Record<string, unknown> = {};
  if (query.serviceId) where['serviceId'] = query.serviceId;
  if (query.dateFrom || query.dateTo) {
    const dateFilter: Record<string, Date> = {};
    if (query.dateFrom) dateFilter['gte'] = query.dateFrom;
    if (query.dateTo) dateFilter['lte'] = query.dateTo;
    where['billDate'] = dateFilter;
  }

  const records = await prisma.utilityReading.findMany({
    where,
    orderBy: { billDate: 'desc' },
    take: query.limit,
    skip: query.offset,
  });
  return c.json(records.map(serializeReading), 200);
});

// ─── POST /readings ───

const createReadingRoute = createRoute({
  method: 'post',
  path: '/readings',
  tags: ['Utility Readings'],
  summary: 'Create a utility reading',
  request: {
    body: { content: { 'application/json': { schema: CreateUtilityReadingSchema } } },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: UtilityReadingSchema } },
      description: 'Utility reading created',
    },
    400: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Bad Request',
    },
  },
});

app.openapi(createReadingRoute, async (c) => {
  const body = c.req.valid('json');

  // Validate service exists
  const service = await prisma.utilityService.findUnique({
    where: { id: body.serviceId },
    select: { id: true, expenseId: true },
  });
  if (!service) {
    return c.json({ error: 'Service not found' }, 400);
  }

  const record = await prisma.utilityReading.create({
    data: { ...body, details: body.details as never },
  });

  // If this service is linked to a recurring expense, update the transaction amount
  if (service.expenseId) {
    const matchDate = record.dueDate ?? record.billDate;
    const md = localDate(matchDate);
    const { start, end } = monthRange(md.year, md.month);
    const tx = await prisma.transaction.findFirst({
      where: {
        expenseId: service.expenseId,
        date: { gte: start, lt: end },
      },
      select: { id: true },
    });
    if (tx) {
      await ledgerUpdate(tx.id, { amount: computeUtilityTotalBill(record) });
    }
  }

  await invalidateLinkedExpenseSchedule(record.serviceId);
  return c.json(serializeReading(record), 201);
});

// ─── PUT /readings/:id ───

const updateReadingRoute = createRoute({
  method: 'put',
  path: '/readings/{id}',
  tags: ['Utility Readings'],
  summary: 'Update a utility reading',
  request: {
    params: readingIdParam,
    body: { content: { 'application/json': { schema: UpdateUtilityReadingSchema } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: UtilityReadingSchema } },
      description: 'Utility reading updated',
    },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Not Found',
    },
  },
});

app.openapi(updateReadingRoute, async (c) => {
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');

  try {
    const record = await prisma.utilityReading.update({
      where: { id },
      data: { ...body, details: body.details as never },
    });
    await invalidateLinkedExpenseSchedule(record.serviceId);
    return c.json(serializeReading(record), 200);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') return c.json({ error: 'Reading not found' }, 404);
    }
    throw err;
  }
});

// ─── DELETE /readings/:id ───

const deleteReadingRoute = createRoute({
  method: 'delete',
  path: '/readings/{id}',
  tags: ['Utility Readings'],
  summary: 'Delete a utility reading',
  request: { params: readingIdParam },
  responses: {
    204: { description: 'Reading deleted' },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Not Found',
    },
  },
});

app.openapi(deleteReadingRoute, async (c) => {
  const { id } = c.req.valid('param');
  try {
    const record = await prisma.utilityReading.delete({ where: { id } });
    await invalidateLinkedExpenseSchedule(record.serviceId);
    return c.body(null, 204);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') return c.json({ error: 'Reading not found' }, 404);
    }
    throw err;
  }
});

export { app as utilitiesReadingsRouter };
export default app;
