/**
 * Unit tests for holdings.ts pure functions.
 *
 * Tests computeUsdAmount and backCalculateUnitPrice — the pure
 * computation helpers that don't touch the database.
 */
import { describe, it, expect } from 'vitest';
import { computeUsdAmount, backCalculateUnitPrice } from '../holdings.js';

describe('computeUsdAmount', () => {
  it('computes USD for Bitcoin unit', () => {
    // 0.5 BTC × $60,000/BTC = $30,000
    expect(computeUsdAmount(0.5, 'Bitcoin', 60_000)).toBe(30_000);
  });

  it('computes USD for Sats unit', () => {
    // 50,000,000 sats = 0.5 BTC × $60,000 = $30,000
    expect(computeUsdAmount(50_000_000, 'Sats', 60_000)).toBe(30_000);
  });

  it('returns 0 when quantity is 0', () => {
    expect(computeUsdAmount(0, 'Bitcoin', 60_000)).toBe(0);
    expect(computeUsdAmount(0, 'Sats', 60_000)).toBe(0);
  });

  it('returns 0 when unitPrice is 0', () => {
    expect(computeUsdAmount(1, 'Bitcoin', 0)).toBe(0);
    expect(computeUsdAmount(100_000_000, 'Sats', 0)).toBe(0);
  });

  it('handles 1 sat correctly', () => {
    // 1 sat = 0.00000001 BTC × $100,000 = $0.001
    expect(computeUsdAmount(1, 'Sats', 100_000)).toBeCloseTo(0.001, 6);
  });

  it('handles 1 BTC correctly', () => {
    expect(computeUsdAmount(1, 'Bitcoin', 100_000)).toBe(100_000);
  });

  it('100_000_000 sats equals 1 BTC', () => {
    const price = 65_432;
    expect(computeUsdAmount(100_000_000, 'Sats', price)).toBe(
      computeUsdAmount(1, 'Bitcoin', price),
    );
  });
});

describe('backCalculateUnitPrice', () => {
  it('back-calculates unit price for Bitcoin', () => {
    // $30,000 / 0.5 BTC = $60,000/BTC
    expect(backCalculateUnitPrice(30_000, 0.5, 'Bitcoin')).toBe(60_000);
  });

  it('back-calculates unit price for Sats', () => {
    // $30,000 / (50,000,000 sats → 0.5 BTC) = $60,000/BTC
    expect(backCalculateUnitPrice(30_000, 50_000_000, 'Sats')).toBe(60_000);
  });

  it('is the inverse of computeUsdAmount for Bitcoin', () => {
    const quantity = 0.75;
    const unitPrice = 58_000;
    const usd = computeUsdAmount(quantity, 'Bitcoin', unitPrice);
    const recovered = backCalculateUnitPrice(usd, quantity, 'Bitcoin');
    expect(recovered).toBeCloseTo(unitPrice, 6);
  });

  it('is the inverse of computeUsdAmount for Sats', () => {
    const quantity = 75_000_000; // 0.75 BTC in sats
    const unitPrice = 58_000;
    const usd = computeUsdAmount(quantity, 'Sats', unitPrice);
    const recovered = backCalculateUnitPrice(usd, quantity, 'Sats');
    expect(recovered).toBeCloseTo(unitPrice, 6);
  });

  it('handles very small quantities', () => {
    // 100 sats = 0.000001 BTC, $0.10 → $100,000/BTC
    const price = backCalculateUnitPrice(0.1, 100, 'Sats');
    expect(price).toBeCloseTo(100_000, 0);
  });

  it('converts Sats to BTC before calculating unit price', () => {
    // 100,000,000 sats = 1 BTC, $60,000 → $60,000/BTC
    expect(backCalculateUnitPrice(60_000, 100_000_000, 'Sats')).toBe(60_000);

    // 50,000,000 sats = 0.5 BTC, $30,000 → $60,000/BTC
    expect(backCalculateUnitPrice(30_000, 50_000_000, 'Sats')).toBe(60_000);

    // 1 sat = 0.00000001 BTC, $0.0006 → $60,000/BTC
    expect(backCalculateUnitPrice(0.0006, 1, 'Sats')).toBeCloseTo(60_000, 0);
  });
});
