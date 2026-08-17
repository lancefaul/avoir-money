import { createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { prisma, Prisma } from '@budget-tracker/db';
import { fetchPrices } from '../lib/prices.js';
import {
  InvestmentHoldingSchema,
  CreateInvestmentHoldingSchema,
  UpdateInvestmentHoldingSchema,
  InvestmentSnapshotSchema,
  CreateInvestmentSnapshotSchema,
  InvestmentHoldingWithSnapshotSchema,
  PriceResponseSchema,
} from '@budget-tracker/core';
import { ErrorSchema, createRouter } from '../lib/errors.js';
import { regenerateAllSnapshots, PriceHistoryUnavailable } from '../lib/snapshot-generator.js';

type InvestmentHolding = z.infer<typeof InvestmentHoldingSchema>;
type InvestmentSnapshot = z.infer<typeof InvestmentSnapshotSchema>;

const app = createRouter();

function serializeHolding(r: {
  id: string;
  name: string;
  ticker: string | null;
  type: string;
  quantity: { toNumber(): number };
  costBasis: { toNumber(): number } | null;
  custodianId: string | null;
  walletId: string | null;
  custodian?: { name: string } | null;
  wallet?: { name: string } | null;
  createdAt: Date;
  updatedAt: Date;
}): InvestmentHolding & { custodianName: string | null; walletName: string | null } {
  return {
    id: r.id,
    name: r.name,
    ticker: r.ticker,
    type: r.type as InvestmentHolding['type'],
    quantity: Number(r.quantity),
    costBasis: r.costBasis !== null ? Number(r.costBasis) : null,
    custodianId: r.custodianId,
    walletId: r.walletId,
    custodianName: r.custodian?.name ?? null,
    walletName: r.wallet?.name ?? null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function serializeSnapshot(r: {
  id: string;
  holdingId: string;
  date: Date;
  quantity: { toNumber(): number };
  value: { toNumber(): number } | null;
  createdAt: Date;
}): InvestmentSnapshot {
  return {
    id: r.id,
    holdingId: r.holdingId,
    date: r.date,
    quantity: Number(r.quantity),
    value: r.value !== null ? Number(r.value) : null,
    createdAt: r.createdAt,
  };
}

// ─── GET / ───

const listHoldingsRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Investments'],
  summary: 'List all investment holdings with their latest snapshot',
  responses: {
    200: {
      content: {
        'application/json': { schema: z.array(InvestmentHoldingWithSnapshotSchema) },
      },
      description: 'List of investment holdings',
    },
  },
});

app.openapi(listHoldingsRoute, async (c) => {
  const holdings = await prisma.investmentHolding.findMany({
    where: { quantity: { gt: 0 } },
    orderBy: { name: 'asc' },
    include: { custodian: true, wallet: true },
  });

  const withSnapshots = await Promise.all(
    holdings.map(async (holding) => {
      const latestSnapshot = await prisma.investmentSnapshot.findFirst({
        where: { holdingId: holding.id },
        orderBy: { date: 'desc' },
      });
      return {
        ...serializeHolding(holding),
        latestSnapshot: latestSnapshot ? serializeSnapshot(latestSnapshot) : null,
      };
    }),
  );

  return c.json(withSnapshots, 200);
});

// ─── POST / ───

const createHoldingRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['Investments'],
  summary: 'Create an investment holding',
  request: {
    body: { content: { 'application/json': { schema: CreateInvestmentHoldingSchema } } },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: InvestmentHoldingSchema } },
      description: 'Investment holding created',
    },
    400: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Bad Request',
    },
  },
});

app.openapi(createHoldingRoute, async (c) => {
  const body = c.req.valid('json');

  // Validate FK existence
  if (body.custodianId) {
    const custodian = await prisma.custodian.findUnique({ where: { id: body.custodianId } });
    if (!custodian) return c.json({ error: 'Custodian not found' }, 400);
  }
  if (body.walletId) {
    const wallet = await prisma.wallet.findUnique({ where: { id: body.walletId } });
    if (!wallet) return c.json({ error: 'Wallet not found' }, 400);
  }

  const holding = await prisma.investmentHolding.create({
    data: body,
    include: { custodian: true, wallet: true },
  });
  return c.json(serializeHolding(holding), 201);
});

// ─── PUT /:id ───

const updateHoldingRoute = createRoute({
  method: 'put',
  path: '/{id}',
  tags: ['Investments'],
  summary: 'Update an investment holding',
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: UpdateInvestmentHoldingSchema } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: InvestmentHoldingSchema } },
      description: 'Investment holding updated',
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

app.openapi(updateHoldingRoute, async (c) => {
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');

  // Validate FK existence
  if (body.custodianId) {
    const custodian = await prisma.custodian.findUnique({ where: { id: body.custodianId } });
    if (!custodian) return c.json({ error: 'Custodian not found' }, 400);
  }
  if (body.walletId) {
    const wallet = await prisma.wallet.findUnique({ where: { id: body.walletId } });
    if (!wallet) return c.json({ error: 'Wallet not found' }, 400);
  }

  try {
    const holding = await prisma.investmentHolding.update({
      where: { id },
      data: body,
      include: { custodian: true, wallet: true },
    });
    return c.json(serializeHolding(holding), 200);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') return c.json({ error: 'Investment holding not found' }, 404);
      if (err.code === 'P2002')
        return c.json({ error: 'Duplicate record', details: err.meta }, 409);
    }
    throw err;
  }
});

// ─── POST /:id/snapshot ───

const createSnapshotRoute = createRoute({
  method: 'post',
  path: '/{id}/snapshot',
  tags: ['Investments'],
  summary: 'Create a snapshot for an investment holding',
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: CreateInvestmentSnapshotSchema } } },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: InvestmentSnapshotSchema } },
      description: 'Investment snapshot created',
    },
    400: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Bad Request',
    },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Holding not found',
    },
  },
});

app.openapi(createSnapshotRoute, async (c) => {
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');

  const holding = await prisma.investmentHolding.findUnique({ where: { id } });
  if (!holding) return c.json({ error: 'Investment holding not found' }, 404);

  const snapshot = await prisma.investmentSnapshot.create({
    data: { ...body, holdingId: id },
  });
  return c.json(serializeSnapshot(snapshot), 201);
});

// ─── GET /prices ───

const pricesRoute = createRoute({
  method: 'get',
  path: '/prices',
  tags: ['Investments'],
  summary: 'Fetch current market prices for all holdings',
  responses: {
    200: {
      content: { 'application/json': { schema: PriceResponseSchema } },
      description: 'Current prices, plus which tickers had no live figure',
    },
  },
});

app.openapi(pricesRoute, async (c) => {
  const holdings = await prisma.investmentHolding.findMany({
    select: { ticker: true, type: true },
  });

  const hasBitcoin = holdings.some((h) => h.type === 'BITCOIN');
  const tickers = [
    ...new Set(holdings.filter((h) => h.type === 'STOCK' && h.ticker).map((h) => h.ticker!)),
  ];

  const result = await fetchPrices(tickers, hasBitcoin);
  return c.json(result, 200);
});

// ─── POST /snapshots/regenerate ───

const regenerateSnapshotsRoute = createRoute({
  method: 'post',
  path: '/snapshots/regenerate',
  tags: ['Investments'],
  summary: 'Regenerate all investment snapshots from transaction history',
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({ message: z.string(), count: z.number() }),
        },
      },
      description: 'Snapshots regenerated',
    },
    503: {
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      description: 'The price history could not be fetched — nothing was changed',
    },
  },
});

app.openapi(regenerateSnapshotsRoute, async (c) => {
  try {
    const { count } = await regenerateAllSnapshots();
    return c.json({ message: `Regenerated ${count} snapshots`, count }, 200);
  } catch (err) {
    // A rebuild deletes before it writes, so failing partway is not an option:
    // either the history was fetched or nothing happens at all.
    if (err instanceof PriceHistoryUnavailable) {
      return c.json({ error: MESSAGE_FOR[err.reason] }, 503);
    }
    throw err;
  }
});

const MESSAGE_FOR: Record<PriceHistoryUnavailable['reason'], string> = {
  'rate-limited':
    'The price service is rate-limiting requests. Nothing was changed — wait about a minute and try again.',
  rejected:
    'The price service refused the CoinGecko key. Nothing was changed — check the key in Settings.',
  unavailable:
    'Could not reach the price service. Nothing was changed — the existing history is intact.',
};

// ─── DELETE /:id ───

const deleteHoldingRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Investments'],
  summary: 'Delete an investment holding',
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    204: { description: 'Holding deleted' },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Not Found',
    },
    409: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Has transfer history',
    },
  },
});

app.openapi(deleteHoldingRoute, async (c) => {
  const { id } = c.req.valid('param');

  const holding = await prisma.investmentHolding.findUnique({ where: { id } });
  if (!holding) return c.json({ error: 'Investment holding not found' }, 404);

  // Check for transfer references
  const transferRef = await prisma.investmentTransfer.findFirst({
    where: { OR: [{ fromHoldingId: id }, { toHoldingId: id }] },
  });
  if (transferRef) {
    return c.json(
      { error: 'Cannot delete holding with transfer history. Delete transfers first.' },
      409,
    );
  }

  await prisma.$transaction([
    prisma.investmentSnapshot.deleteMany({ where: { holdingId: id } }),
    prisma.investmentHolding.delete({ where: { id } }),
  ]);

  return c.body(null, 204);
});

export default app;
