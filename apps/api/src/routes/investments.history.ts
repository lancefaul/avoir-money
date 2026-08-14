/**
 * Investment history routes (per-holding + portfolio), split from
 * routes/investments.ts (sub-resource route-split pattern). Mounted at
 * /investments alongside the main router.
 */
import { createRoute } from '@hono/zod-openapi';

import { prisma } from '@budget-tracker/db';
import {
  HistoryQuerySchema,
  HistoryResponseSchema,
  PortfolioHistoryQuerySchema,
  PortfolioHistoryResponseSchema,
} from '@budget-tracker/core';
import { ErrorSchema, createRouter } from '../lib/errors.js';
import { today, localDate, makeDate } from '../lib/dates.js';
import {
  normalizeTradeEntry,
  normalizeTransferEntry,
  normalizePaymentEntry,
  tradeMetadataFromDetail,
  bitcoinPaymentMetaFromDetail,
  mergeAndSort,
  decodeCursor,
} from '../lib/investment-history.js';
import type { TransferWithNames } from '../lib/investment-history.js';

const app = createRouter();

// ─── GET /history ───

const historyRoute = createRoute({
  method: 'get',
  path: '/history',
  tags: ['Investments'],
  summary: 'Get unified investment history (trades + transfers)',
  request: {
    query: HistoryQuerySchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: HistoryResponseSchema } },
      description: 'Paginated investment history',
    },
    400: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Invalid cursor',
    },
  },
});

app.openapi(historyRoute, async (c) => {
  const { type, assetType, limit, cursor } = c.req.valid('query');

  // Decode cursor if provided
  let cursorData: ReturnType<typeof decodeCursor> | undefined;
  if (cursor) {
    try {
      cursorData = decodeCursor(cursor);
    } catch {
      return c.json({ error: 'Invalid cursor' }, 400);
    }
  }

  const fetchLimit = limit + 1;

  // Build trade query
  let trades: ReturnType<typeof normalizeTradeEntry>[] = [];
  if (type !== 'TRANSFER') {
    const tradeWhere: Record<string, unknown> = {
      type: 'TRADE',
      tradeDetail: { isNot: null },
    };

    // Asset type filter via the typed detail relation
    if (assetType === 'BITCOIN') {
      tradeWhere.tradeDetail = { assetType: 'Bitcoin' };
    } else if (assetType === 'STOCK') {
      tradeWhere.tradeDetail = { assetType: 'Stock' };
    }

    if (cursorData && cursorData.source === 'trade') {
      tradeWhere.OR = [
        { date: { lt: new Date(cursorData.date) } },
        { date: new Date(cursorData.date), id: { lt: cursorData.id } },
      ];
    }

    const rawTrades = await prisma.transaction.findMany({
      where: tradeWhere,
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      take: fetchLimit,
      include: { account: { select: { name: true } }, tradeDetail: true },
    });

    trades = rawTrades
      .filter((tx) => tx.tradeDetail != null)
      .map((tx) =>
        normalizeTradeEntry({
          id: tx.id,
          date: tx.date,
          amount: tx.amount,
          tradeMetadata: tradeMetadataFromDetail(tx.tradeDetail!),
          costBasisAllocated: tx.costBasisAllocated,
          accountName: tx.account?.name ?? null,
        }),
      );
  }

  // Build transfer query
  let transfers: ReturnType<typeof normalizeTransferEntry>[] = [];
  if (type !== 'TRADE') {
    const transferWhere: Record<string, unknown> = {};

    // Asset type filter: transfer type values match query param directly
    if (assetType) {
      transferWhere.type = assetType;
    }

    if (cursorData && cursorData.source === 'transfer') {
      transferWhere.OR = [
        { createdAt: { lt: new Date(cursorData.date) } },
        { createdAt: new Date(cursorData.date), id: { lt: cursorData.id } },
      ];
    }

    const rawTransfers = await prisma.investmentTransfer.findMany({
      where: transferWhere,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: fetchLimit,
    });

    // Resolve holding names by fetching related holdings with wallet/custodian
    const holdingIds = [...new Set(rawTransfers.flatMap((t) => [t.fromHoldingId, t.toHoldingId]))];
    const holdings =
      holdingIds.length > 0
        ? await prisma.investmentHolding.findMany({
            where: { id: { in: holdingIds } },
            include: { wallet: true, custodian: true },
          })
        : [];
    const holdingMap = new Map(holdings.map((h) => [h.id, h]));

    transfers = rawTransfers.map((t) => {
      const fromHolding = holdingMap.get(t.fromHoldingId);
      const toHolding = holdingMap.get(t.toHoldingId);
      const transferWithNames: TransferWithNames = {
        id: t.id,
        type: t.type,
        createdAt: t.createdAt,
        quantity: t.quantity,
        ticker: t.ticker,
        feeAmount: t.feeAmount,
        feeBtc: t.feeBtc,
        fromName: fromHolding?.wallet?.name ?? fromHolding?.custodian?.name ?? 'Unknown',
        toName: toHolding?.wallet?.name ?? toHolding?.custodian?.name ?? 'Unknown',
      };
      return normalizeTransferEntry(transferWithNames);
    });
  }

  // Build bitcoin payment query (EXPENSE/INCOME/REFUND with bitcoinMetadata)
  let payments: ReturnType<typeof normalizePaymentEntry>[] = [];
  if (type !== 'TRADE' && type !== 'TRANSFER' && assetType !== 'STOCK') {
    const paymentWhere: Record<string, unknown> = {
      type: { in: ['EXPENSE', 'INCOME', 'REFUND'] },
      bitcoinPaymentDetail: { isNot: null },
      accountId: null,
    };

    if (cursorData && cursorData.source === 'payment') {
      paymentWhere.OR = [
        { date: { lt: new Date(cursorData.date) } },
        { date: new Date(cursorData.date), id: { lt: cursorData.id } },
      ];
    }

    const rawPayments = await prisma.transaction.findMany({
      where: paymentWhere,
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      take: fetchLimit,
      include: { bitcoinPaymentDetail: true },
    });

    // Resolve wallet names
    const walletIds = [
      ...new Set(
        rawPayments.map((tx) => tx.bitcoinPaymentDetail?.walletId).filter((w): w is string => !!w),
      ),
    ];
    const wallets =
      walletIds.length > 0
        ? await prisma.wallet.findMany({ where: { id: { in: walletIds } } })
        : [];
    const walletMap = new Map(wallets.map((w) => [w.id, w.name]));

    payments = rawPayments
      .filter((tx) => tx.bitcoinPaymentDetail != null)
      .map((tx) => {
        const meta = bitcoinPaymentMetaFromDetail(tx.bitcoinPaymentDetail!);
        return normalizePaymentEntry({
          id: tx.id,
          type: tx.type,
          date: tx.date,
          name: tx.name,
          amount: tx.amount,
          bitcoinMetadata: meta,
          walletName: walletMap.get(meta.walletId) ?? 'Unknown',
        });
      });
  }

  const result = mergeAndSort(trades, transfers, limit, cursor, payments);
  return c.json(result, 200);
});

// ─── GET /portfolio-history ───

function periodStartDate(period: '1W' | '1M' | '3M' | '6M' | '1Y' | 'ALL'): Date | null {
  if (period === 'ALL') return null;
  const t = today();
  const { year, month, day } = localDate(t);
  switch (period) {
    case '1W':
      return makeDate(year, month, day - 7);
    case '1M':
      return makeDate(year, month - 1, day);
    case '3M':
      return makeDate(year, month - 3, day);
    case '6M':
      return makeDate(year, month - 6, day);
    case '1Y':
      return makeDate(year - 1, month, day);
  }
}

const portfolioHistoryRoute = createRoute({
  method: 'get',
  path: '/portfolio-history',
  tags: ['Investments'],
  summary: 'Get aggregated portfolio value over time',
  request: {
    query: PortfolioHistoryQuerySchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: PortfolioHistoryResponseSchema } },
      description: 'Portfolio history entries',
    },
  },
});

app.openapi(portfolioHistoryRoute, async (c) => {
  const { period } = c.req.valid('query');
  const startDate = periodStartDate(period);

  const where: Record<string, unknown> = {
    value: { not: null },
  };
  if (startDate) {
    where.date = { gte: startDate };
  }

  const grouped = await prisma.investmentSnapshot.groupBy({
    by: ['date'],
    where,
    _sum: { value: true },
    orderBy: { date: 'asc' },
  });

  const entries = grouped.map((row) => ({
    date: row.date,
    totalValue: row._sum.value !== null ? Number(row._sum.value) : 0,
  }));

  return c.json({ entries }, 200);
});

export default app;
