import { createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { prisma, Prisma } from '@budget-tracker/db';
import {
  DebtSchema,
  CreateDebtSchema,
  UpdateDebtSchema,
  ListDebtsQuerySchema,
  DebtSummarySchema,
  AmortizationScheduleSchema,
  AmortizationQuerySchema,
  DebtWithProgressResponseSchema,
  ExtraPaymentSchema,
  ExtraPaymentResponseSchema,
  generateAmortization,
  estimatePayoffDate,
  monthsRemaining,
  resolveBasePayment,
} from '@budget-tracker/core';
import type { Frequency } from '@budget-tracker/core';
import { ErrorSchema, createRouter } from '../lib/errors.js';
import { today } from '../lib/dates.js';
import {
  serializeDebt,
  latestEscrowByDebt,
  serializeEscrowRecord,
} from '../lib/debt-serialization.js';
import { applyExtraPayment } from '../lib/debt-extra-payment.js';

const app = createRouter();

// ─── GET /summary ─── (MUST be before /:id)

const getSummaryRoute = createRoute({
  method: 'get',
  path: '/summary',
  tags: ['Debts'],
  summary: 'Get debt summary',
  responses: {
    200: {
      content: { 'application/json': { schema: DebtSummarySchema } },
      description: 'Debt summary',
    },
  },
});

app.openapi(getSummaryRoute, async (c) => {
  const [activeDebts, paidOffCount] = await Promise.all([
    prisma.debt.findMany({ where: { paidOff: false } }),
    prisma.debt.count({ where: { paidOff: true } }),
  ]);

  const totalBalance = activeDebts.reduce((sum: number, d) => sum + Number(d.currentBalance), 0);

  // Total monthly payment = derived P&I (or minimumPayment) + current escrow,
  // summed across active debts.
  const escrowMap = await latestEscrowByDebt(
    activeDebts.filter((d) => d.escrowEnabled).map((d) => d.id),
  );
  const totalMinimumMonthly = activeDebts.reduce((sum: number, d) => {
    // Same helper `serializeDebt` uses. This total appears on the same page as
    // the per-debt figures it sums, so a second copy of the rule here would let
    // the summary disagree with the rows above it.
    const pAndI = resolveBasePayment({
      minimumPayment: Number(d.minimumPayment),
      originalBalance: Number(d.originalBalance),
      apr: Number(d.apr),
      termMonths: d.termMonths,
      frequency: d.frequency as Frequency,
    });
    const escrow = escrowMap.get(d.id) ?? 0;
    return Math.round((sum + pAndI + escrow) * 100) / 100;
  }, 0);

  // Find the debt that takes longest to pay off for the debt-free date
  let debtFreeDate: Date | null = null;
  const now = today();
  for (const debt of activeDebts) {
    const balance = Number(debt.currentBalance);
    if (balance <= 0) continue;
    const payoff = estimatePayoffDate(
      {
        currentBalance: balance,
        apr: Number(debt.apr),
        minimumPayment: Number(debt.minimumPayment),
        frequency: debt.frequency as Frequency,
        termMonths: debt.termMonths,
        maturityDate: debt.maturityDate,
        startDate: debt.startDate,
        originalBalance: Number(debt.originalBalance),
      },
      now,
    );
    if (payoff && (!debtFreeDate || payoff > debtFreeDate)) {
      debtFreeDate = payoff;
    }
  }

  return c.json(
    {
      totalBalance: Math.round(totalBalance * 100) / 100,
      totalMinimumMonthly: Math.round(totalMinimumMonthly * 100) / 100,
      debtFreeDate,
      activeCount: activeDebts.length,
      paidOffCount,
    },
    200,
  );
});

// ─── GET / ───

const listDebtsRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Debts'],
  summary: 'List debts',
  request: { query: ListDebtsQuerySchema },
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(DebtSchema) } },
      description: 'List of debts',
    },
  },
});

app.openapi(listDebtsRoute, async (c) => {
  const query = c.req.valid('query');
  const where: Record<string, unknown> = {};
  if (query.type) where['type'] = query.type;
  if (query.paidOff !== undefined) where['paidOff'] = query.paidOff;
  if (query.linkedAccountId) where['linkedAccountId'] = query.linkedAccountId;

  const records = await prisma.debt.findMany({
    where,
    orderBy: { name: 'asc' },
    take: query.limit,
    skip: query.offset,
  });
  const escrowMap = await latestEscrowByDebt(
    records.filter((r) => r.escrowEnabled).map((r) => r.id),
  );
  const now = today();
  return c.json(
    records.map((r) => {
      const balance = Number(r.currentBalance);
      const payoff =
        balance > 0
          ? estimatePayoffDate(
              {
                currentBalance: balance,
                apr: Number(r.apr),
                minimumPayment: Number(r.minimumPayment),
                frequency: r.frequency as Frequency,
                termMonths: r.termMonths,
                maturityDate: r.maturityDate,
                startDate: r.startDate,
                originalBalance: Number(r.originalBalance),
              },
              now,
            )
          : null;
      return {
        ...serializeDebt(r, escrowMap.get(r.id) ?? 0),
        estimatedPayoffDate: payoff,
      };
    }),
    200,
  );
});

// ─── POST / ───

const createDebtRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['Debts'],
  summary: 'Create a debt',
  request: {
    body: { content: { 'application/json': { schema: CreateDebtSchema } } },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: DebtSchema } },
      description: 'Debt created',
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

app.openapi(createDebtRoute, async (c) => {
  const body = c.req.valid('json');
  try {
    const record = await prisma.debt.create({ data: body });
    return c.json(serializeDebt(record), 201);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2002')
        return c.json({ error: 'Duplicate record', details: err.meta }, 409);
    }
    throw err;
  }
});

// ─── GET /:id ───

const getDebtRoute = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Debts'],
  summary: 'Get debt by ID with progress',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      content: { 'application/json': { schema: DebtWithProgressResponseSchema } },
      description: 'Debt with progress',
    },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Not Found',
    },
  },
});

app.openapi(getDebtRoute, async (c) => {
  const { id } = c.req.valid('param');
  const record = await prisma.debt.findUnique({
    where: { id },
    include: { payments: true },
  });
  if (!record) return c.json({ error: 'Debt not found' }, 404);

  const totalPrincipalPaid = record.payments.reduce(
    (sum: number, p) => sum + Number(p.principalAmount),
    0,
  );
  const totalInterestPaid = record.payments.reduce(
    (sum: number, p) => sum + Number(p.interestAmount),
    0,
  );

  const balance = Number(record.currentBalance);
  const apr = Number(record.apr);
  const minPay = Number(record.minimumPayment);
  const debtInput = {
    currentBalance: balance,
    apr,
    minimumPayment: minPay,
    frequency: record.frequency as Frequency,
    termMonths: record.termMonths,
    maturityDate: record.maturityDate,
    startDate: record.startDate,
    originalBalance: Number(record.originalBalance),
  };

  const payoff = balance > 0 ? estimatePayoffDate(debtInput, today()) : null;
  const months = balance > 0 ? monthsRemaining(debtInput) : 0;

  // Fetch the most recent escrow record (active escrow) if any exist
  const latestEscrow = record.escrowEnabled
    ? await prisma.escrowRecord.findFirst({
        where: { debtId: id },
        orderBy: [{ periodStartDate: 'desc' }, { createdAt: 'desc' }],
      })
    : null;

  return c.json(
    {
      ...serializeDebt(record, latestEscrow ? latestEscrow.monthlyAmount.toNumber() : 0),
      totalPrincipalPaid: Math.round(totalPrincipalPaid * 100) / 100,
      totalInterestPaid: Math.round(totalInterestPaid * 100) / 100,
      estimatedPayoffDate: payoff,
      monthsRemaining: months,
      currentEscrowRecord: latestEscrow ? serializeEscrowRecord(latestEscrow) : null,
    },
    200,
  );
});

// ─── PUT /:id ───

const updateDebtRoute = createRoute({
  method: 'put',
  path: '/{id}',
  tags: ['Debts'],
  summary: 'Update a debt',
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: UpdateDebtSchema } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: DebtSchema } },
      description: 'Debt updated',
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

app.openapi(updateDebtRoute, async (c) => {
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');
  try {
    const record = await prisma.debt.update({ where: { id }, data: body });
    const latestEscrow = record.escrowEnabled
      ? await prisma.escrowRecord.findFirst({
          where: { debtId: id },
          orderBy: [{ periodStartDate: 'desc' }, { createdAt: 'desc' }],
        })
      : null;
    return c.json(
      serializeDebt(record, latestEscrow ? latestEscrow.monthlyAmount.toNumber() : 0),
      200,
    );
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') return c.json({ error: 'Debt not found' }, 404);
      if (err.code === 'P2002')
        return c.json({ error: 'Duplicate record', details: err.meta }, 409);
    }
    throw err;
  }
});

// ─── DELETE /:id ───

const deleteDebtRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Debts'],
  summary: 'Delete a debt',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: { description: 'Debt deleted' },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Not Found',
    },
  },
});

app.openapi(deleteDebtRoute, async (c) => {
  const { id } = c.req.valid('param');
  try {
    await prisma.debt.delete({ where: { id } });
    return c.body(null, 204);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') return c.json({ error: 'Debt not found' }, 404);
    }
    throw err;
  }
});

// ─── GET /:id/amortization ───

const getAmortizationRoute = createRoute({
  method: 'get',
  path: '/{id}/amortization',
  tags: ['Debts'],
  summary: 'Get amortization schedule for a debt',
  request: {
    params: z.object({ id: z.string() }),
    query: AmortizationQuerySchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: AmortizationScheduleSchema } },
      description: 'Amortization schedule',
    },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Not Found',
    },
  },
});

app.openapi(getAmortizationRoute, async (c) => {
  const { id } = c.req.valid('param');
  const { extraPayment, escrowAmount: escrowOverride } = c.req.valid('query');

  const record = await prisma.debt.findUnique({ where: { id } });
  if (!record) return c.json({ error: 'Debt not found' }, 404);

  // Determine escrow amount: query param override > active escrow record > 0
  let escrowAmount = 0;
  if (escrowOverride > 0) {
    escrowAmount = escrowOverride;
  } else if (record.escrowEnabled) {
    const activeEscrow = await prisma.escrowRecord.findFirst({
      where: { debtId: id },
      orderBy: [{ periodStartDate: 'desc' }, { createdAt: 'desc' }],
    });
    if (activeEscrow) {
      escrowAmount = activeEscrow.monthlyAmount.toNumber();
    }
  }

  const balance = Number(record.currentBalance);
  const apr = Number(record.apr);
  const minPay = Number(record.minimumPayment);
  const debtInput = {
    currentBalance: balance,
    apr,
    minimumPayment: minPay,
    frequency: record.frequency as Frequency,
    termMonths: record.termMonths,
    maturityDate: record.maturityDate,
    startDate: record.startDate,
    originalBalance: Number(record.originalBalance),
  };

  const result = generateAmortization(debtInput, extraPayment, escrowAmount);
  const payoffDate = balance > 0 ? estimatePayoffDate(debtInput, today(), extraPayment) : null;

  return c.json(
    {
      debtId: id,
      entries: result.entries,
      totalInterest: result.totalInterest,
      totalPayments: result.totalPayments,
      totalEscrow: result.totalEscrow,
      payoffDate,
      monthsRemaining: result.payoffMonths,
      isNegativelyAmortizing: result.isNegativelyAmortizing,
    },
    200,
  );
});

// ─── POST /:id/extra-payment ───

const extraPaymentRoute = createRoute({
  method: 'post',
  path: '/{id}/extra-payment',
  tags: ['Debts'],
  summary: 'Make an extra payment on a debt',
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: ExtraPaymentSchema } } },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: ExtraPaymentResponseSchema } },
      description: 'Extra payment created',
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

app.openapi(extraPaymentRoute, async (c) => {
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');

  const outcome = await applyExtraPayment(id, body);
  if (!outcome.ok) return c.json({ error: outcome.error }, outcome.status);
  return c.json(outcome.result, 201);
});

export default app;
