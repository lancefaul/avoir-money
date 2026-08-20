/**
 * Custodian + Wallet CRUD routes, split from routes/investments.ts
 * (sub-resource route-split pattern). Mounted at /investments alongside the
 * main router.
 */
import { createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { prisma, Prisma } from '@budget-tracker/db';
import {
  CustodianSchema,
  CreateCustodianSchema,
  UpdateCustodianSchema,
  WalletSchema,
  CreateWalletSchema,
  UpdateWalletSchema,
} from '@budget-tracker/core';
import { ErrorSchema, createRouter } from '../lib/errors.js';

const app = createRouter();

// ─── Custodian CRUD ───

const listCustodiansRoute = createRoute({
  method: 'get',
  path: '/custodians',
  tags: ['Investments'],
  summary: 'List all custodians',
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(CustodianSchema) } },
      description: 'List of custodians',
    },
  },
});

app.openapi(listCustodiansRoute, async (c) => {
  const custodians = await prisma.custodian.findMany({ orderBy: { name: 'asc' } });
  return c.json(custodians, 200);
});

const createCustodianRoute = createRoute({
  method: 'post',
  path: '/custodians',
  tags: ['Investments'],
  summary: 'Create a custodian',
  request: {
    body: { content: { 'application/json': { schema: CreateCustodianSchema } } },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: CustodianSchema } },
      description: 'Custodian created',
    },
    409: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Duplicate name',
    },
  },
});

app.openapi(createCustodianRoute, async (c) => {
  const body = c.req.valid('json');
  try {
    const custodian = await prisma.custodian.create({ data: body });
    return c.json(custodian, 201);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2002')
        return c.json(
          { error: 'A custodian with this name already exists', details: err.meta },
          409,
        );
    }
    throw err;
  }
});

const updateCustodianRoute = createRoute({
  method: 'put',
  path: '/custodians/{id}',
  tags: ['Investments'],
  summary: 'Update a custodian',
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: UpdateCustodianSchema } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: CustodianSchema } },
      description: 'Custodian updated',
    },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Not Found',
    },
    409: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Duplicate name',
    },
  },
});

app.openapi(updateCustodianRoute, async (c) => {
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');
  try {
    const custodian = await prisma.custodian.update({ where: { id }, data: body });
    return c.json(custodian, 200);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') return c.json({ error: 'Custodian not found' }, 404);
      if (err.code === 'P2002')
        return c.json(
          { error: 'A custodian with this name already exists', details: err.meta },
          409,
        );
    }
    throw err;
  }
});

const deleteCustodianRoute = createRoute({
  method: 'delete',
  path: '/custodians/{id}',
  tags: ['Investments'],
  summary: 'Delete a custodian',
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    204: { description: 'Custodian deleted' },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Not Found',
    },
    409: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Referenced by holdings or trades',
    },
  },
});

app.openapi(deleteCustodianRoute, async (c) => {
  const { id } = c.req.valid('param');

  // Check if any holding with non-zero quantity references this custodian
  const activeHolding = await prisma.investmentHolding.findFirst({
    where: { custodianId: id, quantity: { gt: 0 } },
  });
  if (activeHolding) {
    return c.json({ error: 'Cannot delete: referenced by active holdings' }, 409);
  }

  // Check if any trade references this custodian (real FK on TradeDetail)
  const referencingTrade = await prisma.tradeDetail.findFirst({ where: { custodianId: id } });
  if (referencingTrade) {
    return c.json({ error: 'Cannot delete: referenced by existing trades' }, 409);
  }

  try {
    // Delete zero-quantity holdings first, then the custodian
    await prisma.investmentHolding.deleteMany({ where: { custodianId: id, quantity: 0 } });
    await prisma.custodian.delete({ where: { id } });
    return c.body(null, 204);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') return c.json({ error: 'Custodian not found' }, 404);
    }
    throw err;
  }
});

// ─── Wallet CRUD ───

const listWalletsRoute = createRoute({
  method: 'get',
  path: '/wallets',
  tags: ['Investments'],
  summary: 'List all wallets',
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(WalletSchema) } },
      description: 'List of wallets',
    },
  },
});

app.openapi(listWalletsRoute, async (c) => {
  const wallets = await prisma.wallet.findMany({ orderBy: { name: 'asc' } });
  return c.json(wallets, 200);
});

const createWalletRoute = createRoute({
  method: 'post',
  path: '/wallets',
  tags: ['Investments'],
  summary: 'Create a wallet',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            name: z.string().min(1).max(100),
            managementUrl: z.string().url().optional(),
            custodyType: z.enum(['CUSTODIAL', 'NON_CUSTODIAL']).optional(),
            storageType: z.enum(['HOT', 'COLD']).optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: WalletSchema } },
      description: 'Wallet created',
    },
    400: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Validation failed',
    },
    409: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Duplicate name',
    },
  },
});

app.openapi(createWalletRoute, async (c) => {
  const raw = c.req.valid('json');
  // Validate with the full schema (applies defaults + custody-storage invariant)
  const result = CreateWalletSchema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    }));
    return c.json({ error: 'Validation failed', details }, 400);
  }
  try {
    const wallet = await prisma.wallet.create({ data: result.data });
    return c.json(wallet, 201);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2002')
        return c.json({ error: 'A wallet with this name already exists', details: err.meta }, 409);
    }
    throw err;
  }
});

const updateWalletRoute = createRoute({
  method: 'put',
  path: '/wallets/{id}',
  tags: ['Investments'],
  summary: 'Update a wallet',
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            name: z.string().min(1).max(100).optional(),
            managementUrl: z.string().url().optional(),
            custodyType: z.enum(['CUSTODIAL', 'NON_CUSTODIAL']).optional(),
            storageType: z.enum(['HOT', 'COLD']).optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: WalletSchema } },
      description: 'Wallet updated',
    },
    400: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Validation failed',
    },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Not Found',
    },
    409: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Duplicate name',
    },
  },
});

app.openapi(updateWalletRoute, async (c) => {
  const { id } = c.req.valid('param');
  const raw = c.req.valid('json');
  // Validate with the full schema (custody-storage invariant)
  const result = UpdateWalletSchema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    }));
    return c.json({ error: 'Validation failed', details }, 400);
  }
  try {
    // When custodyType changes to NON_CUSTODIAL, clear storageType regardless of request body
    const data =
      result.data.custodyType === 'NON_CUSTODIAL'
        ? { ...result.data, storageType: null }
        : result.data;
    const wallet = await prisma.wallet.update({ where: { id }, data });
    return c.json(wallet, 200);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') return c.json({ error: 'Wallet not found' }, 404);
      if (err.code === 'P2002')
        return c.json({ error: 'A wallet with this name already exists', details: err.meta }, 409);
    }
    throw err;
  }
});

const deleteWalletRoute = createRoute({
  method: 'delete',
  path: '/wallets/{id}',
  tags: ['Investments'],
  summary: 'Delete a wallet',
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    204: { description: 'Wallet deleted' },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Not Found',
    },
    409: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Referenced by holdings or trades',
    },
  },
});

app.openapi(deleteWalletRoute, async (c) => {
  const { id } = c.req.valid('param');

  // Check if any holding with non-zero quantity references this wallet
  const activeHolding = await prisma.investmentHolding.findFirst({
    where: { walletId: id, quantity: { gt: 0 } },
  });
  if (activeHolding) {
    return c.json({ error: 'Cannot delete: referenced by active holdings' }, 409);
  }

  // Check if any trade or bitcoin payment references this wallet (real FKs)
  const [referencingTrade, referencingPayment] = await Promise.all([
    prisma.tradeDetail.findFirst({ where: { walletId: id } }),
    prisma.bitcoinPaymentDetail.findFirst({ where: { walletId: id } }),
  ]);
  if (referencingTrade || referencingPayment) {
    return c.json({ error: 'Cannot delete: referenced by existing trades or payments' }, 409);
  }

  try {
    // Delete zero-quantity holdings first, then the wallet
    await prisma.investmentHolding.deleteMany({ where: { walletId: id, quantity: 0 } });
    await prisma.wallet.delete({ where: { id } });
    return c.body(null, 204);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') return c.json({ error: 'Wallet not found' }, 404);
    }
    throw err;
  }
});

export default app;
