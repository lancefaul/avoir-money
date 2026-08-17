import { createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { prisma, Prisma } from '@budget-tracker/db';
import {
  PayScheduleSchema,
  CreatePayScheduleSchema,
  UpdatePayScheduleSchema,
  PayPeriodSchema,
  GeneratePayPeriodsSchema,
  generatePayPeriods,
} from '@budget-tracker/core';
import { ErrorSchema, createRouter } from '../lib/errors.js';

type PaySchedule = z.infer<typeof PayScheduleSchema>;
type PayPeriod = z.infer<typeof PayPeriodSchema>;

const app = createRouter();

function serializeSchedule(r: {
  id: string;
  name: string;
  type: string;
  anchorDate: Date;
  firstPayDay: number | null;
  secondPayDay: number | null;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}): PaySchedule {
  return {
    id: r.id,
    name: r.name,
    type: r.type as PaySchedule['type'],
    anchorDate: r.anchorDate,
    firstPayDay: r.firstPayDay,
    secondPayDay: r.secondPayDay,
    isDefault: r.isDefault,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

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

// ─── GET / ───

const listSchedulesRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Pay Schedules'],
  summary: 'List all pay schedules',
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(PayScheduleSchema) } },
      description: 'List of pay schedules',
    },
  },
});

app.openapi(listSchedulesRoute, async (c) => {
  const schedules = await prisma.paySchedule.findMany({ orderBy: { name: 'asc' } });
  return c.json(schedules.map(serializeSchedule), 200);
});

// ─── POST / ───

const createScheduleRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['Pay Schedules'],
  summary: 'Create a pay schedule',
  request: {
    body: { content: { 'application/json': { schema: CreatePayScheduleSchema } } },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: PayScheduleSchema } },
      description: 'Pay schedule created',
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

app.openapi(createScheduleRoute, async (c) => {
  const body = c.req.valid('json');
  try {
    const schedule = await prisma.paySchedule.create({ data: body });
    return c.json(serializeSchedule(schedule), 201);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2002')
        return c.json({ error: 'Duplicate record', details: err.meta }, 409);
    }
    throw err;
  }
});

// ─── GET /:id ───

const PayScheduleWithCountSchema = PayScheduleSchema.extend({
  _count: z.object({ payPeriods: z.number().int() }),
});

const getScheduleRoute = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Pay Schedules'],
  summary: 'Get pay schedule by ID with pay period count',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      content: { 'application/json': { schema: PayScheduleWithCountSchema } },
      description: 'Pay schedule found',
    },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Not Found',
    },
  },
});

app.openapi(getScheduleRoute, async (c) => {
  const { id } = c.req.valid('param');
  const schedule = await prisma.paySchedule.findUnique({
    where: { id },
    include: { _count: { select: { payPeriods: true } } },
  });
  if (!schedule) return c.json({ error: 'Pay schedule not found' }, 404);
  return c.json(
    {
      ...serializeSchedule(schedule),
      _count: schedule._count,
    },
    200,
  );
});

// ─── PUT /:id ───

const updateScheduleRoute = createRoute({
  method: 'put',
  path: '/{id}',
  tags: ['Pay Schedules'],
  summary: 'Update a pay schedule',
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: UpdatePayScheduleSchema } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: PayScheduleSchema } },
      description: 'Pay schedule updated',
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

app.openapi(updateScheduleRoute, async (c) => {
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');
  try {
    const schedule = await prisma.paySchedule.update({ where: { id }, data: body });
    return c.json(serializeSchedule(schedule), 200);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') return c.json({ error: 'Pay schedule not found' }, 404);
      if (err.code === 'P2002')
        return c.json({ error: 'Duplicate record', details: err.meta }, 409);
    }
    throw err;
  }
});

// ─── DELETE /:id ───

const deleteScheduleRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Pay Schedules'],
  summary: 'Delete a pay schedule',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: { description: 'Pay schedule deleted' },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Not Found',
    },
  },
});

app.openapi(deleteScheduleRoute, async (c) => {
  const { id } = c.req.valid('param');
  try {
    await prisma.paySchedule.delete({ where: { id } });
    return c.body(null, 204);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') return c.json({ error: 'Pay schedule not found' }, 404);
    }
    throw err;
  }
});

// ─── POST /:id/generate ───

const generatePeriodsRoute = createRoute({
  method: 'post',
  path: '/{id}/generate',
  tags: ['Pay Schedules'],
  summary: 'Generate pay periods for a date range',
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: GeneratePayPeriodsSchema } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(PayPeriodSchema) } },
      description: 'Generated pay periods',
    },
    400: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Bad Request',
    },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Pay schedule not found',
    },
  },
});

app.openapi(generatePeriodsRoute, async (c) => {
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');

  const schedule = await prisma.paySchedule.findUnique({ where: { id } });
  if (!schedule) return c.json({ error: 'Pay schedule not found' }, 404);

  const generated = generatePayPeriods({
    scheduleType: schedule.type,
    anchorDate: schedule.anchorDate,
    firstPayDay: schedule.firstPayDay ?? undefined,
    secondPayDay: schedule.secondPayDay ?? undefined,
    rangeStart: body.rangeStart,
    rangeEnd: body.rangeEnd,
  });

  const upserted = await Promise.all(
    generated.map((p) =>
      prisma.payPeriod.upsert({
        where: {
          scheduleId_year_periodNum: {
            scheduleId: id,
            year: p.year,
            periodNum: p.periodNum,
          },
        },
        update: {
          startDate: p.startDate,
          endDate: p.endDate,
          payDate: p.payDate,
        },
        create: {
          scheduleId: id,
          startDate: p.startDate,
          endDate: p.endDate,
          payDate: p.payDate,
          year: p.year,
          periodNum: p.periodNum,
        },
      }),
    ),
  );

  return c.json(upserted.map(serializePeriod), 200);
});

export default app;
