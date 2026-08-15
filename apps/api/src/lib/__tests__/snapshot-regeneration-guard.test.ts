/**
 * A failed price fetch must not reach the rebuild.
 *
 * `regenerateAllSnapshots` deletes every `InvestmentSnapshot` before it writes,
 * so the price history is not an input it can do without — an empty one turns a
 * rebuild into an erasure. `fetchHistoricalBtcPrices` used to return an empty
 * map on any failure, documented as "caller handles missing prices gracefully",
 * and the caller's handling was to delete everything and write nothing.
 *
 * That is how the production database reached zero snapshot rows on 2026-08-13:
 * pressing refresh on the chart rate-limited CoinGecko, and the app reported
 * "Snapshots regenerated". The portfolio then had no recorded figure to fall
 * back on and displayed a near-total loss.
 *
 * These tests own the boundary that decision is made at. `fetch` is stubbed
 * because that is the only way to produce the failure deliberately — waiting
 * for a real 429 is not a test.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { prisma } from '@budget-tracker/db';
import { regenerateAllSnapshots, PriceHistoryUnavailable } from '../snapshot-generator.js';

/**
 * A holding, a real BTC trade, and an existing snapshot.
 *
 * The trade is not decoration: `regenerateAllSnapshots` returns early — after
 * deleting everything — when there are no balance EVENTS, so a holding with no
 * transactions never reaches the price fetch at all. The first version of this
 * file seeded only the holding and every test failed with `{ count: 0 }`,
 * having proved nothing about the guard.
 */
async function seedOneHolding() {
  const wallet = await prisma.wallet.create({
    data: { name: `Wallet ${Math.random().toString(36).slice(2, 8)}` },
  });
  const holding = await prisma.investmentHolding.create({
    data: { name: 'Bitcoin', type: 'BITCOIN', quantity: 1, walletId: wallet.id },
  });
  const account = await prisma.account.create({
    data: { name: `Acct ${Math.random().toString(36).slice(2, 8)}`, type: 'CHECKING' },
  });
  await prisma.transaction.create({
    data: {
      type: 'TRADE',
      name: 'Buy BTC',
      amount: 50000,
      date: new Date(Date.UTC(2026, 0, 1)),
      accountId: account.id,
      tradeDetail: {
        create: {
          direction: 'BUY',
          assetType: 'Bitcoin',
          unitPrice: 50000,
          quantity: 1,
          bitcoinUnit: 'BTC',
          walletId: wallet.id,
        },
      },
    },
  });
  await prisma.investmentSnapshot.create({
    data: {
      holdingId: holding.id,
      date: new Date(Date.UTC(2026, 0, 1)),
      quantity: 1,
      value: 50000,
    },
  });
  return holding;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('regenerateAllSnapshots — the price history is not optional', () => {
  it('refuses on a rate limit rather than rebuilding from nothing', async () => {
    const holding = await seedOneHolding();
    const before = await prisma.investmentSnapshot.count({ where: { holdingId: holding.id } });
    expect(before).toBeGreaterThan(0);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"status":{"error_code":429}}', { status: 429 })),
    );

    await expect(regenerateAllSnapshots()).rejects.toBeInstanceOf(PriceHistoryUnavailable);
    await expect(regenerateAllSnapshots()).rejects.toMatchObject({ reason: 'rate-limited' });

    // The point of the whole change: the history the rebuild could not
    // reconstruct is still there.
    const after = await prisma.investmentSnapshot.count({ where: { holdingId: holding.id } });
    expect(after).toBe(before);
  });

  it('classifies a refused key separately from an outage', async () => {
    await seedOneHolding();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"error":"bad key"}', { status: 401 })),
    );
    await expect(regenerateAllSnapshots()).rejects.toMatchObject({ reason: 'rejected' });
  });

  it('treats a network failure as unavailable, not as an empty history', async () => {
    const holding = await seedOneHolding();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );
    await expect(regenerateAllSnapshots()).rejects.toMatchObject({ reason: 'unavailable' });
    expect(await prisma.investmentSnapshot.count({ where: { holdingId: holding.id } })).toBe(1);
  });

  it('treats a body that does not parse as unavailable, not as a 500', async () => {
    // Without this the raw parse error escapes and the route answers "internal
    // server error", which reads as a bug in the app rather than an outage —
    // and loses the "nothing was changed" that is the useful part.
    await seedOneHolding();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>gateway timeout</html>', { status: 200 })),
    );
    await expect(regenerateAllSnapshots()).rejects.toBeInstanceOf(PriceHistoryUnavailable);
  });

  it('refuses a successful response carrying no prices', async () => {
    // A 200 with an empty list is not a failure and is still not a mandate to
    // wipe: the service had nothing for this window.
    const holding = await seedOneHolding();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"prices":[]}', { status: 200 })),
    );
    await expect(regenerateAllSnapshots()).rejects.toBeInstanceOf(PriceHistoryUnavailable);
    expect(await prisma.investmentSnapshot.count({ where: { holdingId: holding.id } })).toBe(1);
  });
});
