/**
 * REFERENCE ONLY — do not delete until the investment snapshot automation feature is built.
 * See BACKLOG.md: "Investment snapshot automation"
 *
 * Once the lifecycle hook + regenerate endpoint are implemented, this script
 * is superseded and should be removed.
 *
 * Generate historical InvestmentSnapshot records for the portfolio chart.
 *
 * 1. Computes daily BTC balance per holding from transaction history
 * 2. Fetches historical daily BTC prices from CoinGecko
 * 3. Creates snapshot records: balance × price for each day
 *
 * Usage: DATABASE_URL="postgresql://budget:budget@localhost:5433/budget_tracker_test" npx tsx scripts/generate-snapshots.ts
 */
import { PrismaClient } from '@prisma/client';

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://budget:budget@localhost:5433/budget_tracker_test';
if (DATABASE_URL.includes(':5432/') && !process.env.ALLOW_PROD) {
  console.error('ABORT: Set ALLOW_PROD=1 to run against production.');
  process.exit(1);
}

const prisma = new PrismaClient({ datasourceUrl: DATABASE_URL });

// ─── Helpers ───

function toDateKey(d: Date): string {
  return d.toISOString().split('T')[0]!;
}

function addDays(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Fetch Historical BTC Prices from CoinGecko ───

async function fetchBtcPrices(fromDate: Date, toDate: Date): Promise<Map<string, number>> {
  const prices = new Map<string, number>();

  // Calculate days from today back to start
  const now = new Date();
  const totalDays = Math.ceil((now.getTime() - fromDate.getTime()) / (86400 * 1000));

  // CoinGecko free API: /market_chart?days=N&interval=daily (no key needed)
  // Free tier limited to 365 days max
  const days = Math.min(totalDays + 1, 365);
  const url = `https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=${days}&interval=daily`;

  console.log(`  Fetching ${days} days of BTC prices...`);

  const res = await fetch(url);
  if (!res.ok) {
    console.error(`  CoinGecko error: ${res.status} ${res.statusText}`);
    return prices;
  }

  const data = (await res.json()) as { prices: [number, number][] };
  for (const [ts, price] of data.prices) {
    prices.set(toDateKey(new Date(ts)), price);
  }

  return prices;
}

// ─── Compute Daily Balances ───

interface BalanceEvent {
  date: Date;
  holdingId: string;
  delta: number;
}

async function getBalanceEvents(): Promise<BalanceEvent[]> {
  const events: BalanceEvent[] = [];

  const holdings = await prisma.investmentHolding.findMany({
    where: { type: 'BITCOIN' },
    select: { id: true, walletId: true },
  });
  const holdingByWallet = new Map(holdings.map((h) => [h.walletId!, h.id]));

  // BTC trades
  const trades = await prisma.transaction.findMany({
    where: { type: 'TRADE', tradeMetadata: { path: ['assetType'], equals: 'Bitcoin' } },
    select: { date: true, tradeMetadata: true },
    orderBy: { date: 'asc' },
  });

  for (const tx of trades) {
    const meta = tx.tradeMetadata as {
      direction: string;
      quantity: number;
      bitcoinUnit?: string;
      walletId: string;
    };
    const holdingId = holdingByWallet.get(meta.walletId);
    if (!holdingId) continue;

    let qty = meta.quantity;
    if (meta.bitcoinUnit === 'Sats') qty = qty / 100_000_000;

    events.push({ date: tx.date, holdingId, delta: meta.direction === 'BUY' ? qty : -qty });
  }

  // BTC income (rewards/airdrops)
  const incomes = await prisma.transaction.findMany({
    where: { type: 'INCOME', bitcoinMetadata: { not: null } },
    select: { date: true, bitcoinMetadata: true },
    orderBy: { date: 'asc' },
  });

  for (const tx of incomes) {
    const meta = tx.bitcoinMetadata as { walletId: string; quantity: number; bitcoinUnit?: string };
    const holdingId = holdingByWallet.get(meta.walletId);
    if (!holdingId) continue;

    let qty = meta.quantity;
    if (meta.bitcoinUnit === 'Sats') qty = qty / 100_000_000;

    events.push({ date: tx.date, holdingId, delta: qty });
  }

  events.sort((a, b) => a.date.getTime() - b.date.getTime());
  return events;
}

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

// ─── Main ───

async function main() {
  console.log('=== Generate Investment Snapshots ===');
  console.log(`Database: ${DATABASE_URL}`);
  console.log('');

  console.log('1. Computing balance events from transactions...');
  const events = await getBalanceEvents();
  console.log(`  Found ${events.length} balance events`);

  if (events.length === 0) {
    console.log('  No events found. Nothing to do.');
    return;
  }

  const startDate = new Date(
    Date.UTC(
      events[0]!.date.getUTCFullYear(),
      events[0]!.date.getUTCMonth(),
      events[0]!.date.getUTCDate(),
    ),
  );
  const endDate = new Date(
    Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()),
  );
  console.log(`  Date range: ${toDateKey(startDate)} to ${toDateKey(endDate)}`);

  console.log('2. Computing daily balances...');
  const dailyBalances = computeDailyBalances(events, startDate, endDate);
  console.log(`  Days with holdings: ${dailyBalances.size}`);

  console.log('3. Fetching historical BTC prices from CoinGecko...');
  const prices = await fetchBtcPrices(startDate, endDate);
  console.log(`  Got ${prices.size} daily prices`);

  console.log('4. Generating snapshots...');
  const deleted = await prisma.investmentSnapshot.deleteMany({});
  console.log(`  Cleared ${deleted.count} existing snapshots`);

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

  console.log(`  Generated ${snapshots.length} snapshot records`);

  const BATCH_SIZE = 500;
  for (let i = 0; i < snapshots.length; i += BATCH_SIZE) {
    await prisma.investmentSnapshot.createMany({ data: snapshots.slice(i, i + BATCH_SIZE) });
    if (i % 2000 === 0 && i > 0) console.log(`  Inserted ${i}/${snapshots.length}...`);
  }

  console.log(`  Inserted all ${snapshots.length} snapshots`);
  console.log('');
  console.log('=== Done ===');
  console.log(`  Days with price data: ${new Set(snapshots.map((s) => toDateKey(s.date))).size}`);
  console.log(`  Snapshot records: ${snapshots.length}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
