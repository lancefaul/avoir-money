import { createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { prisma, Prisma } from '@budget-tracker/db';
import {
  EscrowRecordSchema,
  CreateEscrowRecordSchema,
  UpdateEscrowRecordSchema,
  EscrowRecordListResponseSchema,
} from '@budget-tracker/core';
import { ErrorSchema, createRouter } from '../lib/errors.js';

type EscrowRecord = z.infer<typeof EscrowRecordSchema>;

const app = createRouter();

function serializeEscrowRecord(r: {
  id: string;
  debtId: string;
  monthlyAmount: { toNumber(): number };
  periodStartDate: Date;
  periodEndDate: Date;
  createdAt: Date;
  updatedAt: Date;
}): EscrowRecord {
  return {
    id: r.id,
    debtId: r.debtId,
    monthlyAmount: r.monthlyAmount.toNumber(),
    periodStartDate: r.periodStartDate,
    periodEndDate: r.periodEndDate,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/**
 * Validates that the debt exists and is a MORTGAGE type.
 * Returns the debt record on success, or an error result on failure.
 */
async function validateMortgageDebt(
  debtId: string,
): Promise<{ error: string; status: 400 | 404 } | { debt: { id: string; type: string } }> {
  const debt = await prisma.debt.findUnique({
    where: { id: debtId },
    select: { id: true, type: true },
  });
  if (!debt) return { error: 'Debt not found', status: 404 };
  if (debt.type !== 'MORTGAGE')
    return { error: 'Escrow is only available for mortgage debts', status: 400 };
  return { debt };
}

// ─── Shared param schemas ───

const debtIdParam = z.object({ id: z.string() });
const escrowIdParam = z.object({ id: z.string(), escrowId: z.string() });

// ─── POST /{id}/escrow ───

const createEscrowRoute = createRoute({
  method: 'post',
  path: '/{id}/escrow',
  tags: ['Escrow'],
  summary: 'Create an escrow record for a mortgage debt',
  request: {
    params: debtIdParam,
    body: { content: { 'application/json': { schema: CreateEscrowRecordSchema } } },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: EscrowRecordSchema } },
      description: 'Escrow record created',
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

app.openapi(createEscrowRoute, async (c) => {
  const { id: debtId } = c.req.valid('param');
  const result = await validateMortgageDebt(debtId);
  if ('error' in result) return c.json({ error: result.error }, result.status);

  const body = c.req.valid('json');
  /*
   * Upsert on (debtId, periodStartDate) — one escrow figure per period.
   *
   * This used to create unconditionally. Editing a mortgage re-posts its escrow
   * with the period already in the form, so every debt save added another row
   * for the same period; production reached five for 2026-08-01. Because the
   * "current escrow" read could then pick an arbitrary one of the tied rows, an
   * edit could appear not to have saved at all.
   *
   * Revising a period is therefore an update, while genuinely starting a new
   * period (the update modal sets start = the previous period's end) still
   * inserts. The matching DB constraint makes the duplicate state
   * unrepresentable rather than merely unlikely.
   */
  const record = await prisma.escrowRecord.upsert({
    where: {
      debtId_periodStartDate: { debtId, periodStartDate: body.periodStartDate },
    },
    create: {
      debtId,
      monthlyAmount: body.monthlyAmount,
      periodStartDate: body.periodStartDate,
      periodEndDate: body.periodEndDate,
    },
    update: {
      monthlyAmount: body.monthlyAmount,
      periodEndDate: body.periodEndDate,
    },
  });
  return c.json(serializeEscrowRecord(record), 201);
});

// ─── GET /{id}/escrow ───

const listEscrowRoute = createRoute({
  method: 'get',
  path: '/{id}/escrow',
  tags: ['Escrow'],
  summary: 'List escrow history for a debt',
  request: { params: debtIdParam },
  responses: {
    200: {
      content: { 'application/json': { schema: EscrowRecordListResponseSchema } },
      description: 'Escrow record list',
    },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Not Found',
    },
  },
});

app.openapi(listEscrowRoute, async (c) => {
  const { id: debtId } = c.req.valid('param');
  const debt = await prisma.debt.findUnique({
    where: { id: debtId },
    select: { id: true },
  });
  if (!debt) return c.json({ error: 'Debt not found' }, 404);

  const records = await prisma.escrowRecord.findMany({
    where: { debtId },
    orderBy: [{ periodStartDate: 'desc' }, { createdAt: 'desc' }],
  });
  return c.json(records.map(serializeEscrowRecord), 200);
});

// ─── PUT /{id}/escrow/{escrowId} ───

const updateEscrowRoute = createRoute({
  method: 'put',
  path: '/{id}/escrow/{escrowId}',
  tags: ['Escrow'],
  summary: 'Update an escrow record',
  request: {
    params: escrowIdParam,
    body: { content: { 'application/json': { schema: UpdateEscrowRecordSchema } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: EscrowRecordSchema } },
      description: 'Escrow record updated',
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
      description: 'Another record already covers that period',
    },
  },
});

app.openapi(updateEscrowRoute, async (c) => {
  const { id: debtId, escrowId } = c.req.valid('param');
  const debt = await prisma.debt.findUnique({
    where: { id: debtId },
    select: { id: true },
  });
  if (!debt) return c.json({ error: 'Debt not found' }, 404);

  const body = c.req.valid('json');
  try {
    const record = await prisma.escrowRecord.update({
      where: { id: escrowId, debtId },
      data: body,
    });
    return c.json(serializeEscrowRecord(record), 200);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') return c.json({ error: 'Escrow record not found' }, 404);
      // Moving a record onto a period another record already covers. Reachable
      // only since (debtId, periodStartDate) became unique — without this it
      // surfaces as a 500 for what is an ordinary, explainable conflict.
      if (err.code === 'P2002') {
        return c.json({ error: 'An escrow record already exists for that period' }, 409);
      }
    }
    throw err;
  }
});

// ─── DELETE /{id}/escrow/{escrowId} ───

const deleteEscrowRoute = createRoute({
  method: 'delete',
  path: '/{id}/escrow/{escrowId}',
  tags: ['Escrow'],
  summary: 'Delete an escrow record',
  request: { params: escrowIdParam },
  responses: {
    204: { description: 'Escrow record deleted' },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Not Found',
    },
  },
});

app.openapi(deleteEscrowRoute, async (c) => {
  const { id: debtId, escrowId } = c.req.valid('param');
  const debt = await prisma.debt.findUnique({
    where: { id: debtId },
    select: { id: true },
  });
  if (!debt) return c.json({ error: 'Debt not found' }, 404);

  try {
    await prisma.escrowRecord.delete({ where: { id: escrowId, debtId } });
    return c.body(null, 204);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') return c.json({ error: 'Escrow record not found' }, 404);
    }
    throw err;
  }
});

export default app;
