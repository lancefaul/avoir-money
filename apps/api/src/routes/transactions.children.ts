import { createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { prisma, Prisma } from '@budget-tracker/db';
import {
  CreateChildTransactionSchema,
  UpdateChildTransactionSchema,
  ChildTransactionSchema,
  ChildrenResponseSchema,
  computeLineTotal,
  roundCurrency,
  sumCurrency,
} from '@budget-tracker/core';
import { ErrorSchema, createRouter } from '../lib/errors.js';
import {
  serializeChildTransaction,
  validateSplittableParent,
} from '../lib/transaction-serialization.js';

const app = createRouter();

// ─── GET /:id/children ───

const listChildrenRoute = createRoute({
  method: 'get',
  path: '/{id}/children',
  tags: ['Transactions'],
  summary: 'List child transactions',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      content: { 'application/json': { schema: ChildrenResponseSchema } },
      description: 'Children list with remaining amount',
    },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Not Found',
    },
  },
});

app.openapi(listChildrenRoute, async (c) => {
  const { id } = c.req.valid('param');

  const parent = await prisma.transaction.findUnique({ where: { id } });
  if (!parent) return c.json({ error: 'Transaction not found' }, 404);

  const children = await prisma.transaction.findMany({
    where: { parentId: id },
    orderBy: { createdAt: 'asc' },
  });

  const parentAmount = Number(parent.amount);
  const sumChildren = sumCurrency(children.map((ch) => Number(ch.amount)));
  const remainingAmount = roundCurrency(parentAmount - sumChildren);

  return c.json(
    {
      children: children.map(serializeChildTransaction),
      remainingAmount,
      parentAmount,
    },
    200,
  );
});

// ─── POST /:id/children ───

const createChildRoute = createRoute({
  method: 'post',
  path: '/{id}/children',
  tags: ['Transactions'],
  summary: 'Create a child transaction',
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: CreateChildTransactionSchema } } },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: ChildTransactionSchema } },
      description: 'Child transaction created',
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

app.openapi(createChildRoute, async (c) => {
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');

  const result = validateSplittableParent(id);
  const validation = await result;
  if (!validation.ok) return c.json({ error: validation.error }, validation.status);
  const { parent } = validation;

  // Compute line total
  const lineResult = computeLineTotal({
    preTaxAmount: body.preTaxAmount,
    taxAmount: body.taxAmount,
    taxRate: body.taxRate,
  });

  // Sum existing children
  const existingChildren = await prisma.transaction.findMany({
    where: { parentId: id },
    select: { amount: true },
  });
  const sumExisting = sumCurrency(existingChildren.map((ch) => Number(ch.amount)));
  const parentAmount = Number(parent.amount);
  const remaining = roundCurrency(parentAmount - sumExisting);

  if (roundCurrency(sumExisting + lineResult.lineTotal) > parentAmount) {
    return c.json({ error: `Child amount exceeds remaining amount of ${remaining}` }, 400);
  }

  try {
    const child = await prisma.transaction.create({
      data: {
        parentId: id,
        type: parent.type,
        name: parent.name,
        amount: lineResult.lineTotal,
        netAmount: lineResult.lineTotal,
        date: parent.date,
        accountId: parent.accountId,
        payPeriodId: parent.payPeriodId,
        budgetId: body.budgetId,
        // computeLineTotal returns the rounded pre-tax value; store that rather
        // than the raw request value so it agrees with taxAmount and lineTotal.
        preTaxAmount: lineResult.preTaxAmount,
        taxAmount: lineResult.taxAmount,
        taxRate: body.taxRate ?? null,
        note: body.note ?? null,
      },
    });

    return c.json(serializeChildTransaction(child), 201);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') return c.json({ error: 'Related resource not found' }, 404);
      if (err.code === 'P2002')
        return c.json({ error: 'Duplicate record', details: err.meta }, 409);
    }
    throw err;
  }
});

// ─── PUT /:id/children/:childId ───

const updateChildRoute = createRoute({
  method: 'put',
  path: '/{id}/children/{childId}',
  tags: ['Transactions'],
  summary: 'Update a child transaction',
  request: {
    params: z.object({ id: z.string(), childId: z.string() }),
    body: { content: { 'application/json': { schema: UpdateChildTransactionSchema } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: ChildTransactionSchema } },
      description: 'Child transaction updated',
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

app.openapi(updateChildRoute, async (c) => {
  const { id, childId } = c.req.valid('param');
  const body = c.req.valid('json');

  const parent = await prisma.transaction.findUnique({ where: { id } });
  if (!parent) return c.json({ error: 'Transaction not found' }, 404);

  const child = await prisma.transaction.findUnique({ where: { id: childId } });
  if (!child || child.parentId !== id) return c.json({ error: 'Child transaction not found' }, 404);

  // Merge existing values with update body
  const preTaxAmount = body.preTaxAmount ?? Number(child.preTaxAmount ?? 0);
  const taxAmount = body.taxAmount;
  const taxRate = body.taxRate;

  // Determine effective tax inputs: use updated values, fall back to existing
  const effectiveTaxAmount =
    taxAmount !== undefined
      ? taxAmount
      : taxRate !== undefined
        ? undefined
        : child.taxRate
          ? undefined
          : child.taxAmount
            ? Number(child.taxAmount)
            : undefined;
  const effectiveTaxRate =
    taxRate !== undefined
      ? taxRate
      : taxAmount !== undefined
        ? undefined
        : child.taxRate
          ? Number(child.taxRate)
          : undefined;

  const lineResult = computeLineTotal({
    preTaxAmount,
    taxAmount: effectiveTaxAmount,
    taxRate: effectiveTaxRate,
  });

  // Sum existing children excluding the one being updated
  const siblings = await prisma.transaction.findMany({
    where: { parentId: id, id: { not: childId } },
    select: { amount: true },
  });
  const sumSiblings = sumCurrency(siblings.map((ch) => Number(ch.amount)));
  const parentAmount = Number(parent.amount);

  if (roundCurrency(sumSiblings + lineResult.lineTotal) > parentAmount) {
    return c.json({ error: 'Updated amount would exceed parent total' }, 400);
  }

  try {
    const updated = await prisma.transaction.update({
      where: { id: childId },
      data: {
        ...(body.budgetId !== undefined ? { budgetId: body.budgetId } : {}),
        preTaxAmount: lineResult.preTaxAmount,
        taxAmount: lineResult.taxAmount,
        taxRate: effectiveTaxRate ?? null,
        amount: lineResult.lineTotal,
        netAmount: lineResult.lineTotal,
        ...(body.note !== undefined ? { note: body.note } : {}),
      },
    });

    return c.json(serializeChildTransaction(updated), 200);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') return c.json({ error: 'Child transaction not found' }, 404);
      if (err.code === 'P2002')
        return c.json({ error: 'Duplicate record', details: err.meta }, 409);
    }
    throw err;
  }
});

// ─── DELETE /:id/children/:childId ───

const deleteChildRoute = createRoute({
  method: 'delete',
  path: '/{id}/children/{childId}',
  tags: ['Transactions'],
  summary: 'Delete a child transaction',
  request: {
    params: z.object({ id: z.string(), childId: z.string() }),
  },
  responses: {
    204: { description: 'Child transaction deleted' },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Not Found',
    },
  },
});

app.openapi(deleteChildRoute, async (c) => {
  const { id, childId } = c.req.valid('param');

  const parent = await prisma.transaction.findUnique({ where: { id } });
  if (!parent) return c.json({ error: 'Transaction not found' }, 404);

  const child = await prisma.transaction.findUnique({ where: { id: childId } });
  if (!child || child.parentId !== id) return c.json({ error: 'Child transaction not found' }, 404);

  try {
    await prisma.transaction.delete({ where: { id: childId } });
    return c.body(null, 204);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') return c.json({ error: 'Child transaction not found' }, 404);
    }
    throw err;
  }
});

export default app;
