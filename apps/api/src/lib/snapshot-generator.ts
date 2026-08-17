/**
 * Investment snapshot generation — extracted from scripts/generate-snapshots.ts.
 *
 * Two entry points:
 * - regenerateAllSnapshots(): full backfill (delete all + recompute from history)
 * - regenerateHoldingSnapshot(holdingId): targeted single-holding regen for today
 */
import { prisma, Prisma } from '@budget-tracker/db';
import { today } from './dates.js';

// ─── Helpers ───

function toDateKey(d: Date): string {
  return d.toISOString().split('T')[0]!;
}

function addDays(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n));
}

// ─── Types ───

interface BalanceEvent {
  date: Date;
  holdingId: string;
  delta: number;
}

// ─── Balance Events ───

async function getBalanceEvents(): Promise<BalanceEvent[]> {
  const events: BalanceEvent[] = [];

  const holdings = await prisma.investmentHolding.findMany({
    where: { type: 'BITCOIN' },
    select: { id: true, walletId: true, quantity: true },
  });
  const holdingByWallet = new Map(holdings.map((h) => [h.walletId!, h.id]));
  const holdingActualQty = new Map(holdings.map((h) => [h.id, Number(h.quantity)]));

  // BTC trades
  const trades = await prisma.transaction.findMany({
    where: { type: 'TRADE', tradeDetail: { assetType: 'Bitcoin' } },
    select: { date: true, tradeDetail: true },
    orderBy: { date: 'asc' },
  });

  for (const tx of trades) {
    const d = tx.tradeDetail;
    if (!d || !d.walletId) continue;
    const holdingId = holdingByWallet.get(d.walletId);
    if (!holdingId) continue;

    let qty = Number(d.quantity);
    if (d.bitcoinUnit === 'Sats') qty = qty / 100_000_000;

    events.push({ date: tx.date, holdingId, delta: d.direction === 'BUY' ? qty : -qty });
  }

  // BTC income (rewards/airdrops)
  const incomes = await prisma.transaction.findMany({
    where: { type: 'INCOME', bitcoinPaymentDetail: { isNot: null } },
    select: { date: true, bitcoinPaymentDetail: true },
    orderBy: { date: 'asc' },
  });

  for (const tx of incomes) {
    const d = tx.bitcoinPaymentDetail;
    if (!d) continue;
    const holdingId = holdingByWallet.get(d.walletId);
    if (!holdingId) continue;

    let qty = Number(d.quantity);
    if (d.bitcoinUnit === 'Sats') qty = qty / 100_000_000;

    events.push({ date: tx.date, holdingId, delta: qty });
  }

  // BTC transfers between wallets
  const transfers = await prisma.investmentTransfer.findMany({
    where: { type: 'BITCOIN' },
    select: { createdAt: true, fromHoldingId: true, toHoldingId: true, quantity: true },
    orderBy: { createdAt: 'asc' },
  });

  for (const t of transfers) {
    const qty = Number(t.quantity);
    // Subtract from source holding
    events.push({ date: t.createdAt, holdingId: t.fromHoldingId, delta: -qty });
    // Add to destination holding
    events.push({ date: t.createdAt, holdingId: t.toHoldingId, delta: qty });
  }

  // Reconciliation: if computed running balance doesn't match actual holding quantity,
  // add a correction event on the last event date for that holding.
  // This handles untracked outflows (manual adjustments, unrecorded transfers).
  const computedTotals = new Map<string, number>();
  for (const ev of events) {
    computedTotals.set(ev.holdingId, (computedTotals.get(ev.holdingId) ?? 0) + ev.delta);
  }

  for (const [holdingId, computedQty] of computedTotals) {
    const actualQty = holdingActualQty.get(holdingId) ?? 0;
    const diff = actualQty - computedQty;
    if (Math.abs(diff) > 0.000001) {
      // Find the last event date for this holding to place the correction
      const lastEvent = events.filter((e) => e.holdingId === holdingId).at(-1);
      const correctionDate = lastEvent?.date ?? today();
      events.push({ date: correctionDate, holdingId, delta: diff });
    }
  }

  events.sort((a, b) => a.date.getTime() - b.date.getTime());
  return events;
}

async function getBalanceEventsForHolding(holdingId: string): Promise<BalanceEvent[]> {
  const events: BalanceEvent[] = [];

  const holding = await prisma.investmentHolding.findUnique({
    where: { id: holdingId },
    select: { walletId: true },
  });
  if (!holding?.walletId) return events;

  const walletId = holding.walletId;

  // BTC trades for this wallet
  const trades = await prisma.transaction.findMany({
    where: {
      type: 'TRADE',
      tradeDetail: { assetType: 'Bitcoin', walletId },
    },
    select: { date: true, tradeDetail: true },
    orderBy: { date: 'asc' },
  });

  for (const tx of trades) {
    const d = tx.tradeDetail;
    if (!d) continue;

    let qty = Number(d.quantity);
    if (d.bitcoinUnit === 'Sats') qty = qty / 100_000_000;

    events.push({ date: tx.date, holdingId, delta: d.direction === 'BUY' ? qty : -qty });
  }

  // BTC income for this wallet
  const incomes = await prisma.transaction.findMany({
    where: { type: 'INCOME', bitcoinPaymentDetail: { walletId } },
    select: { date: true, bitcoinPaymentDetail: true },
    orderBy: { date: 'asc' },
  });

  for (const tx of incomes) {
    const d = tx.bitcoinPaymentDetail;
    if (!d) continue;

    let qty = Number(d.quantity);
    if (d.bitcoinUnit === 'Sats') qty = qty / 100_000_000;

    events.push({ date: tx.date, holdingId, delta: qty });
  }

  // BTC transfers involving this holding
  const transfers = await prisma.investmentTransfer.findMany({
    where: {
      type: 'BITCOIN',
      OR: [{ fromHoldingId: holdingId }, { toHoldingId: holdingId }],
    },
    select: { createdAt: true, fromHoldingId: true, toHoldingId: true, quantity: true },
    orderBy: { createdAt: 'asc' },
  });

  for (const t of transfers) {
    const qty = Number(t.quantity);
    if (t.fromHoldingId === holdingId) {
      events.push({ date: t.createdAt, holdingId, delta: -qty });
    }
    if (t.toHoldingId === holdingId) {
      events.push({ date: t.createdAt, holdingId, delta: qty });
    }
  }

  events.sort((a, b) => a.date.getTime() - b.date.getTime());
  return events;
}

// ─── Compute Daily Balances ───

function computeDailyBalances(
  events: BalanceEvent[],
  startDate: Date,
  endDate: Date,
): Map<string, Map<string, number>> {
  const dailyBalances = new Map<string, Map<string, number>>();
  const runningBalance = new Map<string, number>();

  const holdingIds = new Set(events.map((e) => e.holdingId));
  for (const id of holdingIds) runningBalance.set(id, 0);

  let eventIdx = 0;
  let current = startDate;

  while (current <= endDate) {
    const dateKey = toDateKey(current);

    while (eventIdx < events.length && toDateKey(events[eventIdx]!.date) <= dateKey) {
      const ev = events[eventIdx]!;
      runningBalance.set(ev.holdingId, (runningBalance.get(ev.holdingId) ?? 0) + ev.delta);
      eventIdx++;
    }

    const dayBalances = new Map<string, number>();
    for (const [holdingId, balance] of runningBalance) {
      if (balance > 0.000001) dayBalances.set(holdingId, balance);
    }
    if (dayBalances.size > 0) {
      dailyBalances.set(dateKey, dayBalances);
    }

    current = addDays(current, 1);
  }

  return dailyBalances;
}

// ─── CoinGecko Price Fetching ───

const COINGECKO_MARKET_CHART_URL = 'https://api.coingecko.com/api/v3/coins/bitcoin/market_chart';
const COINGECKO_SIMPLE_PRICE_URL =
  'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd';

/**
 * Thrown when the price history could not be fetched at all.
 *
 * An empty map and a failed fetch used to be the same value here, and the
 * comment claimed "caller handles missing prices gracefully". The caller
 * deletes every snapshot before writing, so what it actually did with an empty
 * map was erase the entire history — see `regenerateAllSnapshots`.
 */
export class PriceHistoryUnavailable extends Error {
  constructor(public readonly reason: 'rate-limited' | 'rejected' | 'unavailable') {
    super(reason);
    this.name = 'PriceHistoryUnavailable';
  }
}

async function fetchHistoricalBtcPrices(days: number): Promise<Map<string, number>> {
  const prices = new Map<string, number>();
  const url = `${COINGECKO_MARKET_CHART_URL}?vs_currency=usd&days=${days}&interval=daily`;

  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    throw new PriceHistoryUnavailable('unavailable');
  }
  if (!res.ok) {
    throw new PriceHistoryUnavailable(
      res.status === 429
        ? 'rate-limited'
        : res.status === 401 || res.status === 403
          ? 'rejected'
          : 'unavailable',
    );
  }

  // A body that does not parse is an unavailable service, not a 500. Without
  // this the throw escapes as an unhandled error and the route answers "internal
  // server error" — which reads as a bug in the app rather than an outage, and
  // loses the "nothing was changed" reassurance that matters most here.
  let data: { prices?: [number, number][] };
  try {
    data = (await res.json()) as { prices?: [number, number][] };
  } catch {
    throw new PriceHistoryUnavailable('unavailable');
  }
  if (!Array.isArray(data.prices)) throw new PriceHistoryUnavailable('unavailable');

  for (const [ts, price] of data.prices) {
    prices.set(toDateKey(new Date(ts)), price);
  }

  return prices;
}

async function fetchCurrentBtcPrice(): Promise<number | null> {
  try {
    const res = await fetch(COINGECKO_SIMPLE_PRICE_URL);
    if (!res.ok) return null;
    const data = (await res.json()) as { bitcoin?: { usd?: number } };
    return data.bitcoin?.usd ?? null;
  } catch {
    return null;
  }
}

// ─── Public API ───

/**
 * Full backfill: deletes all existing snapshots and regenerates from transaction history.
 * Fetches up to 365 days of historical BTC prices from CoinGecko.
 */
export async function regenerateAllSnapshots(): Promise<{ count: number }> {
  const events = await getBalanceEvents();

  if (events.length === 0) {
    await prisma.investmentSnapshot.deleteMany({});
    return { count: 0 };
  }

  const startDate = new Date(
    Date.UTC(
      events[0]!.date.getUTCFullYear(),
      events[0]!.date.getUTCMonth(),
      events[0]!.date.getUTCDate(),
    ),
  );
  const endDate = today();

  const dailyBalances = computeDailyBalances(events, startDate, endDate);

  // Calculate days for CoinGecko API (capped at 365)
  const now = new Date();
  const totalDays = Math.ceil((now.getTime() - startDate.getTime()) / (86400 * 1000));
  const days = Math.min(totalDays + 1, 365);
  // Throws rather than returning an empty map. The delete below is
  // unconditional, so reaching it with a history we failed to fetch destroys
  // the record instead of rebuilding it.
  const prices = await fetchHistoricalBtcPrices(days);
  if (prices.size === 0) {
    // A successful fetch with nothing in it is a different thing and still not
    // a reason to wipe: the service had no data for this window.
    throw new PriceHistoryUnavailable('unavailable');
  }

  // Build snapshot records
  const snapshots: { holdingId: string; date: Date; quantity: number; value: number }[] = [];

  for (const [dateKey, holdingBalances] of dailyBalances) {
    const price = prices.get(dateKey);
    if (!price) continue;

    for (const [holdingId, quantity] of holdingBalances) {
      snapshots.push({
        holdingId,
        date: new Date(dateKey + 'T00:00:00.000Z'),
        quantity,
        value: quantity * price,
      });
    }
  }

  // Delete all and batch-insert
  await prisma.investmentSnapshot.deleteMany({});

  const BATCH_SIZE = 500;
  for (let i = 0; i < snapshots.length; i += BATCH_SIZE) {
    await prisma.investmentSnapshot.createMany({ data: snapshots.slice(i, i + BATCH_SIZE) });
  }

  return { count: snapshots.length };
}

/**
 * Targeted regen for a single holding — only upserts today's snapshot.
 * Used by the lifecycle hook path for fast, non-blocking updates.
 */
export async function regenerateHoldingSnapshot(holdingId: string): Promise<void> {
  const events = await getBalanceEventsForHolding(holdingId);
  if (events.length === 0) return;

  const endDate = today();
  const startDate = new Date(
    Date.UTC(
      events[0]!.date.getUTCFullYear(),
      events[0]!.date.getUTCMonth(),
      events[0]!.date.getUTCDate(),
    ),
  );

  const dailyBalances = computeDailyBalances(events, startDate, endDate);
  const todayKey = toDateKey(endDate);
  const todayBalances = dailyBalances.get(todayKey);

  if (!todayBalances) return;

  const quantity = todayBalances.get(holdingId);
  if (!quantity || quantity <= 0.000001) return;

  const price = await fetchCurrentBtcPrice();
  if (!price) return;

  const value = quantity * price;

  // Delete existing snapshot for today + create new one
  await prisma.investmentSnapshot.deleteMany({
    where: { holdingId, date: endDate },
  });

  try {
    await prisma.investmentSnapshot.create({
      data: { holdingId, date: endDate, quantity, value },
    });
  } catch (err) {
    // FK violation means the holding was deleted between our check and the create.
    // This is expected in fire-and-forget contexts (e.g., test teardown races).
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      (err.code === 'P2003' || err.code === 'P2025')
    ) {
      return;
    }
    throw err;
  }
}
