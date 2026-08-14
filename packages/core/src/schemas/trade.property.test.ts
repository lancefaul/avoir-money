import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { TradeDirectionSchema, TradeAssetTypeSchema, TradeMetadataSchema } from './transaction.js';

/**
 * Feature: trade-transactions, Property 1: Trade metadata enum validation
 * Validates: Requirements 1.5, 2.6
 *
 * For any string value, TradeDirectionSchema should accept only "BUY" and "SELL",
 * and TradeAssetTypeSchema should accept only "Bitcoin" and "Stock".
 * All other string values should be rejected.
 */
describe('Property 1: Trade metadata enum validation', () => {
  it('accepts only BUY and SELL for TradeDirection', () => {
    fc.assert(
      fc.property(fc.constantFrom('BUY', 'SELL'), (dir) => {
        expect(TradeDirectionSchema.safeParse(dir).success).toBe(true);
      }),
      { numRuns: 20 },
    );
  });

  it('rejects any other string for TradeDirection', () => {
    const invalidDir = fc.string().filter((s) => s !== 'BUY' && s !== 'SELL');
    fc.assert(
      fc.property(invalidDir, (dir) => {
        expect(TradeDirectionSchema.safeParse(dir).success).toBe(false);
      }),
      { numRuns: 20 },
    );
  });

  it('accepts only Bitcoin and Stock for TradeAssetType', () => {
    fc.assert(
      fc.property(fc.constantFrom('Bitcoin', 'Stock'), (t) => {
        expect(TradeAssetTypeSchema.safeParse(t).success).toBe(true);
      }),
      { numRuns: 20 },
    );
  });

  it('rejects any other string for TradeAssetType', () => {
    const invalidType = fc.string().filter((s) => s !== 'Bitcoin' && s !== 'Stock');
    fc.assert(
      fc.property(invalidType, (t) => {
        expect(TradeAssetTypeSchema.safeParse(t).success).toBe(false);
      }),
      { numRuns: 20 },
    );
  });
});

/**
 * Feature: trade-transactions, Property 2: Trade numeric fields must be positive
 * Validates: Requirements 2.4, 3.4, 3.5, 4.4
 *
 * For any trade metadata object, unitPrice and quantity must be positive numbers.
 * Zero, negative numbers should be rejected by the schema.
 */
describe('Property 2: Trade numeric fields must be positive', () => {
  const validStockBase = {
    direction: 'BUY' as const,
    assetType: 'Stock' as const,
    ticker: 'AAPL',
    custodianId: 'cust-1',
  };

  const validBtcBase = {
    direction: 'BUY' as const,
    assetType: 'Bitcoin' as const,
    bitcoinUnit: 'Bitcoin' as const,
    walletId: 'wallet-1',
  };

  it('accepts positive unitPrice and quantity for stock trades', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: 1e9, noNaN: true }),
        fc.double({ min: 0.01, max: 1e9, noNaN: true }),
        (unitPrice, quantity) => {
          const result = TradeMetadataSchema.safeParse({ ...validStockBase, unitPrice, quantity });
          expect(result.success).toBe(true);
        },
      ),
      { numRuns: 20 },
    );
  });

  it('rejects zero or negative unitPrice for stock trades', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e9, max: 0, noNaN: true }),
        fc.double({ min: 0.01, max: 1e9, noNaN: true }),
        (unitPrice, quantity) => {
          const result = TradeMetadataSchema.safeParse({ ...validStockBase, unitPrice, quantity });
          expect(result.success).toBe(false);
        },
      ),
      { numRuns: 20 },
    );
  });

  it('rejects zero or negative quantity for stock trades', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: 1e9, noNaN: true }),
        fc.double({ min: -1e9, max: 0, noNaN: true }),
        (unitPrice, quantity) => {
          const result = TradeMetadataSchema.safeParse({ ...validStockBase, unitPrice, quantity });
          expect(result.success).toBe(false);
        },
      ),
      { numRuns: 20 },
    );
  });

  it('accepts positive unitPrice and quantity for Bitcoin trades', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: 1e9, noNaN: true }),
        fc.double({ min: 0.01, max: 1e9, noNaN: true }),
        (unitPrice, quantity) => {
          const result = TradeMetadataSchema.safeParse({ ...validBtcBase, unitPrice, quantity });
          expect(result.success).toBe(true);
        },
      ),
      { numRuns: 20 },
    );
  });

  it('rejects zero or negative unitPrice for Bitcoin trades', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e9, max: 0, noNaN: true }),
        fc.double({ min: 0.01, max: 1e9, noNaN: true }),
        (unitPrice, quantity) => {
          const result = TradeMetadataSchema.safeParse({ ...validBtcBase, unitPrice, quantity });
          expect(result.success).toBe(false);
        },
      ),
      { numRuns: 20 },
    );
  });

  it('rejects zero or negative quantity for Bitcoin trades', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: 1e9, noNaN: true }),
        fc.double({ min: -1e9, max: 0, noNaN: true }),
        (unitPrice, quantity) => {
          const result = TradeMetadataSchema.safeParse({ ...validBtcBase, unitPrice, quantity });
          expect(result.success).toBe(false);
        },
      ),
      { numRuns: 20 },
    );
  });
});

/**
 * Feature: trade-transactions, Property 3: Ticker symbol format validation
 * Validates: Requirements 3.3
 *
 * For any string, the stock trade ticker field should accept only strings matching
 * ^[A-Z]{1,10}$ (1-10 uppercase alphabetic characters). All other strings should be rejected.
 */
describe('Property 3: Ticker symbol format validation', () => {
  const stockBase = {
    direction: 'BUY' as const,
    assetType: 'Stock' as const,
    unitPrice: 100,
    quantity: 10,
    custodianId: 'cust-1',
  };

  it('accepts valid ticker symbols (1-10 uppercase letters)', () => {
    const upperChar = fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''));
    const validTicker = fc
      .array(upperChar, { minLength: 1, maxLength: 10 })
      .map((chars) => chars.join(''));
    fc.assert(
      fc.property(validTicker, (ticker) => {
        const result = TradeMetadataSchema.safeParse({ ...stockBase, ticker });
        expect(result.success).toBe(true);
      }),
      { numRuns: 20 },
    );
  });

  it('rejects empty ticker', () => {
    const result = TradeMetadataSchema.safeParse({ ...stockBase, ticker: '' });
    expect(result.success).toBe(false);
  });

  it('rejects tickers with lowercase, digits, or special characters', () => {
    const invalidTicker = fc
      .string({ minLength: 1, maxLength: 10 })
      .filter((s) => s.length > 0 && !/^[A-Z]+$/.test(s));
    fc.assert(
      fc.property(invalidTicker, (ticker) => {
        const result = TradeMetadataSchema.safeParse({ ...stockBase, ticker });
        expect(result.success).toBe(false);
      }),
      { numRuns: 20 },
    );
  });

  it('rejects tickers longer than 10 characters', () => {
    const upperChar = fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''));
    const longTicker = fc
      .array(upperChar, { minLength: 11, maxLength: 30 })
      .map((chars) => chars.join(''));
    fc.assert(
      fc.property(longTicker, (ticker) => {
        const result = TradeMetadataSchema.safeParse({ ...stockBase, ticker });
        expect(result.success).toBe(false);
      }),
      { numRuns: 20 },
    );
  });
});

/**
 * Feature: trade-transactions, Property 4: Bitcoin unit-quantity consistency
 * Validates: Requirements 4.2, 4.3
 *
 * When bitcoinUnit is "Sats", quantity must be a positive integer.
 * When bitcoinUnit is "Bitcoin", quantity can be a positive decimal.
 * Non-integer quantities with "Sats" unit should be rejected.
 */
describe('Property 4: Bitcoin unit-quantity consistency', () => {
  const btcBase = {
    direction: 'BUY' as const,
    assetType: 'Bitcoin' as const,
    unitPrice: 65000,
    walletId: 'wallet-1',
  };

  it('accepts integer quantities when unit is Sats', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_000_000_000 }), (quantity) => {
        const result = TradeMetadataSchema.safeParse({
          ...btcBase,
          bitcoinUnit: 'Sats',
          quantity,
        });
        expect(result.success).toBe(true);
      }),
      { numRuns: 20 },
    );
  });

  it('rejects non-integer quantities when unit is Sats', () => {
    const nonInteger = fc
      .double({ min: 0.01, max: 1e6, noNaN: true })
      .filter((n) => !Number.isInteger(n) && n > 0);
    fc.assert(
      fc.property(nonInteger, (quantity) => {
        const result = TradeMetadataSchema.safeParse({
          ...btcBase,
          bitcoinUnit: 'Sats',
          quantity,
        });
        expect(result.success).toBe(false);
      }),
      { numRuns: 20 },
    );
  });

  it('accepts decimal quantities when unit is Bitcoin', () => {
    fc.assert(
      fc.property(fc.double({ min: 0.00000001, max: 21_000_000, noNaN: true }), (quantity) => {
        const result = TradeMetadataSchema.safeParse({
          ...btcBase,
          bitcoinUnit: 'Bitcoin',
          quantity,
        });
        expect(result.success).toBe(true);
      }),
      { numRuns: 20 },
    );
  });

  it('accepts integer quantities when unit is Bitcoin', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 21_000_000 }), (quantity) => {
        const result = TradeMetadataSchema.safeParse({
          ...btcBase,
          bitcoinUnit: 'Bitcoin',
          quantity,
        });
        expect(result.success).toBe(true);
      }),
      { numRuns: 20 },
    );
  });
});
