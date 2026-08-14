import { describe, it, expect } from 'vitest';
import { liveValue, type ValuableHolding } from './liveValue.js';

/**
 * These pin a distinction, not an arithmetic. See `liveValue.ts` for the
 * incident: a 429 from the price service, an empty snapshot table, and a page
 * that reported a near-total loss because `?? 0` let "no price" become a
 * number. The figures below are invented; the arithmetic is the real bug.
 */

const stock = (over: Partial<ValuableHolding> = {}): ValuableHolding => ({
  type: 'STOCK',
  ticker: 'AAAA',
  quantity: 40,
  latestSnapshot: null,
  ...over,
});
const btc = (over: Partial<ValuableHolding> = {}): ValuableHolding => ({
  type: 'BITCOIN',
  ticker: null,
  quantity: 0.5,
  latestSnapshot: null,
  ...over,
});

describe('liveValue', () => {
  it('uses the live price when there is one', () => {
    expect(liveValue(btc(), { BTC: 60000 })).toBe(30000);
    expect(liveValue(stock(), { AAAA: 2.5 })).toBeCloseTo(100, 2);
  });

  it('falls back to the last recorded figure when the price is missing', () => {
    expect(liveValue(btc({ latestSnapshot: { value: 25000 } }), { BTC: null })).toBe(25000);
  });

  it('returns null — not zero — with no price and nothing recorded', () => {
    // The shape of the reported bug.
    expect(liveValue(btc({ quantity: 0.4 }), { BTC: null })).toBeNull();
    expect(liveValue(stock(), {})).toBeNull();
  });

  it('treats an empty price table the same as a null price', () => {
    // 429 produces no entry at all; a rejected ticker produces a null one.
    // Both mean the same thing and must not diverge.
    expect(liveValue(btc(), {})).toBeNull();
    expect(liveValue(btc(), { BTC: null })).toBeNull();
    expect(liveValue(btc(), { BTC: undefined })).toBeNull();
  });

  it('still reports zero for a holding of nothing', () => {
    // Zero quantity IS worth zero — knowledge, not absence of it. Rendering
    // "—" against a sold-out position forever would be the mirror bug.
    expect(liveValue(btc({ quantity: 0 }), { BTC: null })).toBe(0);
  });

  it('does not look up a stock with no ticker', () => {
    // A private holding has no symbol to price. It must reach the snapshot
    // fallback, not accidentally read `prices[undefined]`.
    expect(liveValue(stock({ ticker: null, latestSnapshot: { value: 500 } }), {})).toBe(500);
    expect(liveValue(stock({ ticker: null }), {})).toBeNull();
  });
});

describe('the totals built on it', () => {
  const prices = { AAAA: 2.5, BTC: null };
  const holdings = [stock(), btc({ quantity: 0.4 })];

  it('sums only what is known, and counts the rest separately', () => {
    const valued = holdings.filter((h) => liveValue(h, prices) !== null);
    const unvalued = holdings.filter((h) => liveValue(h, prices) === null);

    expect(valued.reduce((s, h) => s + (liveValue(h, prices) ?? 0), 0)).toBeCloseTo(100, 2);
    expect(unvalued).toHaveLength(1);
  });

  it('measures value against the cost basis of the SAME holdings', () => {
    // This is the step that turned a missing price into a near-total loss: a
    // partial value compared against a complete cost basis.
    const basisOf = (h: ValuableHolding) => (h.type === 'BITCOIN' ? 20000 : 80);
    const valued = holdings.filter((h) => liveValue(h, prices) !== null);

    const partialBasis = valued.reduce((s, h) => s + basisOf(h), 0);
    const wholeBasis = holdings.reduce((s, h) => s + basisOf(h), 0);

    expect(partialBasis).toBe(80);
    // Against the basis of what it could actually value: a modest gain.
    expect(100 - partialBasis).toBeCloseTo(20, 2);
    // Against the basis of EVERYTHING: a catastrophe that never happened.
    // That difference is the entire bug.
    expect(100 - wholeBasis).toBeCloseTo(-19980, 2);
  });
});
