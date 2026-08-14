/**
 * Investment transfer routes (bitcoin, stock, reversal), split from
 * routes/investments.ts (sub-resource route-split pattern). Mounted at
 * /investments alongside the main router.
 */
import { createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { prisma, Prisma } from '@budget-tracker/db';
import {
  BitcoinTransferSchema,
  BitcoinTransferResponseSchema,
  StockTransferSchema,
  StockTransferResponseSchema,
} from '@budget-tracker/core';
import { ErrorSchema, createRouter } from '../lib/errors.js';
import { executeBitcoinTransfer, executeStockTransfer, reverseTransfer } from '../lib/transfers.js';

const app = createRouter();

// ─── POST /transfers/bitcoin ───

const bitcoinTransferRoute = createRoute({
  method: 'post',
  path: '/transfers/bitcoin',
  tags: ['Investments'],
  summary: 'Transfer bitcoin between wallets',
  request: {
    body: { content: { 'application/json': { schema: BitcoinTransferSchema } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: BitcoinTransferResponseSchema } },
      description: 'Bitcoin transfer completed',
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

app.openapi(bitcoinTransferRoute, async (c) => {
  const body = c.req.valid('json');

  try {
    const transfer = await prisma.$transaction(async (tx) => {
      return executeBitcoinTransfer(body, tx);
    });

    return c.json(
      {
        id: transfer.id,
        fromWalletId: body.fromWalletId,
        toWalletId: body.toWalletId,
        quantity: body.quantity,
        bitcoinUnit: body.bitcoinUnit,
        bitcoinPrice: body.bitcoinPrice ?? null,
        feeAmount: transfer.feeAmount !== null ? Number(transfer.feeAmount) : null,
        feeUnit: transfer.feeUnit as 'Bitcoin' | 'Sats' | 'USD' | null,
        feeBtc: transfer.feeBtc !== null ? Number(transfer.feeBtc) : null,
        createdAt: transfer.createdAt.toISOString(),
      },
      200,
    );
  } catch (err: unknown) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') return c.json({ error: 'Resource not found' }, 404);
    }
    if (err instanceof Error) {
      if (err.message === 'Source wallet has no bitcoin holding') {
        return c.json({ error: err.message }, 404);
      }
      if (err.message.startsWith('Insufficient balance')) {
        return c.json({ error: err.message }, 400);
      }
    }
    throw err;
  }
});

// ─── POST /transfers/stock ───

const stockTransferRoute = createRoute({
  method: 'post',
  path: '/transfers/stock',
  tags: ['Investments'],
  summary: 'Transfer stock between custodians',
  request: {
    body: { content: { 'application/json': { schema: StockTransferSchema } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: StockTransferResponseSchema } },
      description: 'Stock transfer completed',
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

app.openapi(stockTransferRoute, async (c) => {
  const body = c.req.valid('json');

  try {
    const transfer = await prisma.$transaction(async (tx) => {
      return executeStockTransfer(body, tx);
    });

    return c.json(
      {
        id: transfer.id,
        fromCustodianId: body.fromCustodianId,
        toCustodianId: body.toCustodianId,
        holdingId: body.holdingId,
        ticker: transfer.ticker,
        quantity: Number(transfer.quantity),
        feeAmount: transfer.feeAmount !== null ? Number(transfer.feeAmount) : null,
        feeTransactionId: transfer.feeTransactionId,
        createdAt: transfer.createdAt.toISOString(),
      },
      200,
    );
  } catch (err: unknown) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') return c.json({ error: 'Resource not found' }, 404);
    }
    if (err instanceof Error) {
      if (err.message === 'Holding not found at source custodian') {
        return c.json({ error: err.message }, 404);
      }
      if (err.message.startsWith('Insufficient balance')) {
        return c.json({ error: err.message }, 400);
      }
    }
    throw err;
  }
});

// ─── DELETE /transfers/:id ───

const deleteTransferRoute = createRoute({
  method: 'delete',
  path: '/transfers/{id}',
  tags: ['Investments'],
  summary: 'Delete an investment transfer with full reversal',
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    204: { description: 'Transfer deleted and reversed' },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Not Found',
    },
  },
});

app.openapi(deleteTransferRoute, async (c) => {
  const { id } = c.req.valid('param');

  const transfer = await prisma.investmentTransfer.findUnique({ where: { id } });
  if (!transfer) return c.json({ error: 'Investment transfer not found' }, 404);

  await prisma.$transaction(async (tx) => {
    await reverseTransfer(transfer, tx);
    await tx.investmentTransfer.delete({ where: { id } });
  });

  return c.body(null, 204);
});

export default app;
