import { createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { prisma, Prisma } from '@budget-tracker/db';
import {
  DescriptionSchema,
  CreateDescriptionSchema,
  RenameDescriptionSchema,
  MergeDescriptionsSchema,
} from '@budget-tracker/core';
import { ErrorSchema, createRouter } from '../lib/errors.js';
import { ledgerUpdate } from '../lib/lifecycle/index.js';

const app = createRouter();

// ─── GET / ───

const listDescriptionsRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Descriptions'],
  summary: 'List all transaction descriptions',
  request: {
    query: z.object({
      search: z.string().optional(),
    }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(DescriptionSchema) } },
      description: 'List of descriptions',
    },
  },
});

app.openapi(listDescriptionsRoute, async (c) => {
  const { search } = c.req.valid('query');

  const where: Prisma.TransactionDescriptionWhereInput = search
    ? { name: { contains: search, mode: 'insensitive' } }
    : {};

  const descriptions = await prisma.transactionDescription.findMany({
    where,
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });

  return c.json(descriptions, 200);
});

// ─── POST / ───

const createDescriptionRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['Descriptions'],
  summary: 'Create a transaction description',
  request: {
    body: { content: { 'application/json': { schema: CreateDescriptionSchema } } },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: DescriptionSchema } },
      description: 'Description created',
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

app.openapi(createDescriptionRoute, async (c) => {
  const { name } = c.req.valid('json');

  // Case-insensitive uniqueness check
  const existing = await prisma.transactionDescription.findFirst({
    where: { name: { equals: name, mode: 'insensitive' } },
  });

  if (existing) {
    return c.json({ error: 'A description with this name already exists' }, 409);
  }

  const description = await prisma.transactionDescription.create({
    data: { name },
    select: { id: true, name: true },
  });

  return c.json(description, 201);
});

// ─── PUT /:id ───

const renameDescriptionRoute = createRoute({
  method: 'put',
  path: '/{id}',
  tags: ['Descriptions'],
  summary: 'Rename a transaction description',
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: RenameDescriptionSchema } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: DescriptionSchema } },
      description: 'Description renamed',
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

app.openapi(renameDescriptionRoute, async (c) => {
  const { id } = c.req.valid('param');
  const { name } = c.req.valid('json');

  // Case-insensitive uniqueness check (exclude self)
  const existing = await prisma.transactionDescription.findFirst({
    where: {
      name: { equals: name, mode: 'insensitive' },
      id: { not: id },
    },
  });

  if (existing) {
    return c.json({ error: 'A description with this name already exists' }, 409);
  }

  try {
    const description = await prisma.transactionDescription.update({
      where: { id },
      data: { name },
      select: { id: true, name: true },
    });

    // Update all linked transactions through the ledger gate
    const txs = await prisma.transaction.findMany({
      where: { descriptionId: id },
      select: { id: true },
    });
    for (const tx of txs) {
      await ledgerUpdate(tx.id, { name });
    }

    return c.json(description, 200);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') return c.json({ error: 'Description not found' }, 404);
      if (err.code === 'P2002')
        return c.json({ error: 'A description with this name already exists' }, 409);
    }
    throw err;
  }
});

// ─── POST /merge ───

const mergeDescriptionsRoute = createRoute({
  method: 'post',
  path: '/merge',
  tags: ['Descriptions'],
  summary: 'Merge multiple descriptions into one',
  request: {
    body: { content: { 'application/json': { schema: MergeDescriptionsSchema } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: DescriptionSchema } },
      description: 'Merge completed, returns the target description',
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

app.openapi(mergeDescriptionsRoute, async (c) => {
  const { sourceIds, targetId } = c.req.valid('json');

  // Validate target exists
  const target = await prisma.transactionDescription.findUnique({
    where: { id: targetId },
    select: { id: true, name: true },
  });

  if (!target) {
    return c.json({ error: 'Target description not found' }, 404);
  }

  // Filter out targetId from sourceIds to avoid self-merge
  const filteredSourceIds = sourceIds.filter((id) => id !== targetId);

  if (filteredSourceIds.length === 0) {
    return c.json(target, 200);
  }

  // Verify all source descriptions exist
  const sources = await prisma.transactionDescription.findMany({
    where: { id: { in: filteredSourceIds } },
    select: { id: true },
  });

  if (sources.length !== filteredSourceIds.length) {
    return c.json({ error: 'One or more source descriptions not found' }, 404);
  }

  // Move all transactions from sources to target through the ledger gate
  const txs = await prisma.transaction.findMany({
    where: { descriptionId: { in: filteredSourceIds } },
    select: { id: true },
  });
  for (const t of txs) {
    await ledgerUpdate(t.id, { descriptionId: targetId, name: target.name });
  }

  // Delete source descriptions (safe now that no transactions reference them)
  await prisma.transactionDescription.deleteMany({
    where: { id: { in: filteredSourceIds } },
  });

  return c.json(target, 200);
});

// ─── POST /:id/merge ───

const mergeIntoDescriptionRoute = createRoute({
  method: 'post',
  path: '/{id}/merge',
  tags: ['Descriptions'],
  summary: 'Merge another description into this one',
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: z.object({ mergeId: z.string() }) } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: DescriptionSchema } },
      description: 'Merge completed, returns the target description',
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

app.openapi(mergeIntoDescriptionRoute, async (c) => {
  const { id } = c.req.valid('param');
  const { mergeId } = c.req.valid('json');

  if (id === mergeId) {
    return c.json({ error: 'Cannot merge a description into itself' }, 400);
  }

  // Validate target exists
  const target = await prisma.transactionDescription.findUnique({
    where: { id },
    select: { id: true, name: true },
  });

  if (!target) {
    return c.json({ error: 'Target description not found' }, 404);
  }

  // Validate source exists
  const source = await prisma.transactionDescription.findUnique({
    where: { id: mergeId },
    select: { id: true },
  });

  if (!source) {
    return c.json({ error: 'Source description not found' }, 404);
  }

  // Move all transactions from source to target through the ledger gate
  const txs = await prisma.transaction.findMany({
    where: { descriptionId: mergeId },
    select: { id: true },
  });
  for (const t of txs) {
    await ledgerUpdate(t.id, { descriptionId: id, name: target.name });
  }

  // Delete the source description (safe now that no transactions reference it)
  await prisma.transactionDescription.delete({
    where: { id: mergeId },
  });

  return c.json(target, 200);
});

// ─── DELETE /:id ───

const deleteDescriptionRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Descriptions'],
  summary: 'Delete a description (only if no transactions reference it)',
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    204: { description: 'Deleted' },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Not Found',
    },
    409: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Conflict — transactions still reference this description',
    },
  },
});

app.openapi(deleteDescriptionRoute, async (c) => {
  const { id } = c.req.valid('param');

  // Check if description exists
  const description = await prisma.transactionDescription.findUnique({
    where: { id },
    select: { id: true },
  });

  if (!description) {
    return c.json({ error: 'Description not found' }, 404);
  }

  // Check if any transactions reference it
  const txCount = await prisma.transaction.count({
    where: { descriptionId: id },
  });

  if (txCount > 0) {
    return c.json(
      { error: `Cannot delete: ${txCount} transaction(s) still reference this description` },
      409,
    );
  }

  await prisma.transactionDescription.delete({ where: { id } });
  return c.body(null, 204);
});

export default app;
