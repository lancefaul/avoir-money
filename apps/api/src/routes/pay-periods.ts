import { createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { prisma } from '@budget-tracker/db';
import {
  PayPeriodSchema,
  BalanceSnapshotSchema,
  ListPayPeriodsQuerySchema,
} from '@budget-tracker/core';
import { ErrorSchema, createRouter } from '../lib/errors.js';

type PayPeriod = z.infer<typeof PayPeriodSchema>;
type BalanceSnapshot = z.infer<typeof BalanceSnapshotSchema>;

const app = createRouter();

function serializePeriod(r: {
  id: string;
  scheduleId: string;
  startDate: Date;
  endDate: Date;
  payDate: Date;
  year: number;
  periodNum: number;
}): PayPeriod {
  return {
    id: r.id,
    scheduleId: r.scheduleId,
    startDate: r.startDate,
    endDate: r.endDate,
    payDate: r.payDate,
    year: r.year,
    periodNum: r.periodNum,
  };
}

function serializeSnapshot(r: {
  id: string;
  payPeriodId: string;
  accountId: string;
  openingBalance: { toNumber(): number };
  closingBalance: { toNumber(): number };
  totalIncome: { toNumber(): number };
  totalExpenses: { toNumber(): number };
  createdAt: Date;
}): BalanceSnapshot {
  return {
    id: r.id,
    payPeriodId: r.payPeriodId,
    accountId: r.accountId,
    openingBalance: Number(r.openingBalance),
    closingBalance: Number(r.closingBalance),
    totalIncome: Number(r.totalIncome),
    totalExpenses: Number(r.totalExpenses),
    createdAt: r.createdAt,
  };
}

// ─── GET /current — MUST be registered before GET /:id ───

const getCurrentPeriodRoute = createRoute({
  method: 'get',
  path: '/current',
  tags: ['Pay Periods'],
  summary: 'Get the pay period containing today',
  request: {
    query: z.object({ scheduleId: z.string().optional() }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: PayPeriodSchema } },
      description: 'Current pay period',
    },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'No current pay period found',
    },
  },
});

app.openapi(getCurrentPeriodRoute, async (c) => {
  const query = c.req.valid('query');
  const today = new Date();

  let scheduleId = query.scheduleId;
  if (!scheduleId) {
    const defaultSchedule = await prisma.paySchedule.findFirst({
      where: { isDefault: true },
    });
    if (defaultSchedule) {
      scheduleId = defaultSchedule.id;
    } else {
      const firstSchedule = await prisma.paySchedule.findFirst({
        orderBy: { createdAt: 'asc' },
      });
      if (firstSchedule) scheduleId = firstSchedule.id;
    }
  }

  const where: Record<string, unknown> = {
    startDate: { lte: today },
    endDate: { gte: today },
  };
  if (scheduleId) where['scheduleId'] = scheduleId;

  const period = await prisma.payPeriod.findFirst({ where });
  if (!period) return c.json({ error: 'No current pay period found' }, 404);
  return c.json(serializePeriod(period), 200);
});

// ─── GET / ───

const listPayPeriodsRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Pay Periods'],
  summary: 'List pay periods',
  request: { query: ListPayPeriodsQuerySchema },
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(PayPeriodSchema) } },
      description: 'List of pay periods',
    },
  },
});

app.openapi(listPayPeriodsRoute, async (c) => {
  const query = c.req.valid('query');
  const where: Record<string, unknown> = {};
  if (query.scheduleId) where['scheduleId'] = query.scheduleId;
  if (query.year) where['year'] = query.year;
  if (query.dateFrom || query.dateTo) {
    const dateFilter: Record<string, Date> = {};
    if (query.dateFrom) dateFilter['gte'] = query.dateFrom;
    if (query.dateTo) dateFilter['lte'] = query.dateTo;
    where['payDate'] = dateFilter;
  }

  const records = await prisma.payPeriod.findMany({
    where,
    orderBy: { payDate: 'asc' },
    take: query.limit,
    skip: query.offset,
  });
  return c.json(records.map(serializePeriod), 200);
});

// ─── GET /:id ───

const PayPeriodWithSnapshotsSchema = PayPeriodSchema.extend({
  balanceSnapshots: z.array(BalanceSnapshotSchema),
});

const getPayPeriodRoute = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Pay Periods'],
  summary: 'Get pay period by ID with balance snapshots',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      content: { 'application/json': { schema: PayPeriodWithSnapshotsSchema } },
      description: 'Pay period found',
    },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Not Found',
    },
  },
});

app.openapi(getPayPeriodRoute, async (c) => {
  const { id } = c.req.valid('param');
  const period = await prisma.payPeriod.findUnique({
    where: { id },
    include: { balanceSnapshots: true },
  });
  if (!period) return c.json({ error: 'Pay period not found' }, 404);

  return c.json(
    {
      ...serializePeriod(period),
      balanceSnapshots: period.balanceSnapshots.map(serializeSnapshot),
    },
    200,
  );
});

export default app;
