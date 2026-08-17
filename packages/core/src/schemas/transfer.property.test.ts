import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { BitcoinTransferSchema, StockTransferSchema } from './transfer';

// ─── Generators ───

/** Non-empty string ID generator */
const idArb = fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0);

/** Valid base bitcoin transfer (distinct wallets, positive nums, Bitcoin unit) */
function validBitcoinBase(overrides: Record<string, unknown> = {}) {
  return {
    fromWalletId: 'wallet-a',
    toWalletId: 'wallet-b',
    quantity: 1.5,
    bitcoinUnit: 'Bitcoin' as const,
    bitcoinPrice: 65000,
    ...overrides,
  };
}

/** Valid base stock transfer (distinct custodians) */
function validStockBase(overrides: Record<string, unknown> = {}) {
  return {
    fromCustodianId: 'cust-a',
    toCustodianId: 'cust-b',
    holdingId: 'holding-1',
    ...overrides,
  };
}

/**
 * Feature: investment-transfers, Property 5: Same-location rejection
 * Validates: Requirements 1.5, 4.5
 *
 * For any transfer request where the source and destination are the same entity
 * (same walletId for bitcoin, same custodianId for stock), the validation schema
 * rejects the request.
 */
describe('Property 5: Same-location rejection', () => {
  it('rejects bitcoin transfers where fromWalletId === toWalletId', () => {
    fc.assert(
      fc.property(idArb, (walletId) => {
        const result = BitcoinTransferSchema.safeParse(
          validBitcoinBase({ fromWalletId: walletId, toWalletId: walletId }),
        );
        expect(result.success).toBe(false);
      }),
      { numRuns: 20 },
    );
  });

  it('rejects stock transfers where fromCustodianId === toCustodianId', () => {
    fc.assert(
      fc.property(idArb, (custodianId) => {
        const result = StockTransferSchema.safeParse(
          validStockBase({ fromCustodianId: custodianId, toCustodianId: custodianId }),
        );
        expect(result.success).toBe(false);
      }),
      { numRuns: 20 },
    );
  });

  it('accepts bitcoin transfers where fromWalletId !== toWalletId', () => {
    const distinctPair = fc.tuple(idArb, idArb).filter(([a, b]) => a !== b);
    fc.assert(
      fc.property(distinctPair, ([from, to]) => {
        const result = BitcoinTransferSchema.safeParse(
          validBitcoinBase({ fromWalletId: from, toWalletId: to }),
        );
        expect(result.success).toBe(true);
      }),
      { numRuns: 20 },
    );
  });

  it('accepts stock transfers where fromCustodianId !== toCustodianId', () => {
    const distinctPair = fc.tuple(idArb, idArb).filter(([a, b]) => a !== b);
    fc.assert(
      fc.property(distinctPair, ([from, to]) => {
        const result = StockTransferSchema.safeParse(
          validStockBase({ fromCustodianId: from, toCustodianId: to }),
        );
        expect(result.success).toBe(true);
      }),
      { numRuns: 20 },
    );
  });
});

/**
 * Feature: investment-transfers, Property 11: Numeric input validation
 * Validates: Requirements 7.1, 7.2, 7.3, 1.7
 *
 * For any transfer request with a non-positive quantity, or a bitcoin transfer
 * with a non-positive bitcoin price, or any transfer with a negative fee amount,
 * or a bitcoin transfer with bitcoinUnit=Sats and a non-integer quantity,
 * the validation schema rejects the request.
 */
describe('Property 11: Numeric input validation', () => {
  it('rejects bitcoin transfers with non-positive quantity', () => {
    fc.assert(
      fc.property(fc.double({ min: -1e9, max: 0, noNaN: true }), (quantity) => {
        const result = BitcoinTransferSchema.safeParse(validBitcoinBase({ quantity }));
        expect(result.success).toBe(false);
      }),
      { numRuns: 20 },
    );
  });

  it('rejects bitcoin transfers with non-positive bitcoinPrice', () => {
    fc.assert(
      fc.property(fc.double({ min: -1e9, max: 0, noNaN: true }), (bitcoinPrice) => {
        const result = BitcoinTransferSchema.safeParse(validBitcoinBase({ bitcoinPrice }));
        expect(result.success).toBe(false);
      }),
      { numRuns: 20 },
    );
  });

  it('rejects bitcoin transfers with negative feeAmount', () => {
    fc.assert(
      fc.property(fc.double({ min: -1e9, max: -0.01, noNaN: true }), (feeAmount) => {
        const result = BitcoinTransferSchema.safeParse(
          validBitcoinBase({ feeAmount, feeUnit: 'USD' }),
        );
        expect(result.success).toBe(false);
      }),
      { numRuns: 20 },
    );
  });

  it('rejects bitcoin transfers with Sats unit and non-integer quantity', () => {
    const nonInteger = fc
      .double({ min: 0.01, max: 1e6, noNaN: true })
      .filter((n) => !Number.isInteger(n) && n > 0);
    fc.assert(
      fc.property(nonInteger, (quantity) => {
        const result = BitcoinTransferSchema.safeParse(
          validBitcoinBase({ quantity, bitcoinUnit: 'Sats' }),
        );
        expect(result.success).toBe(false);
      }),
      { numRuns: 20 },
    );
  });

  it('rejects stock transfers with negative feeAmount', () => {
    fc.assert(
      fc.property(fc.double({ min: -1e9, max: -0.01, noNaN: true }), (feeAmount) => {
        const result = StockTransferSchema.safeParse(
          validStockBase({ feeAmount, feeBudgetId: 'cat-1', feeAccountId: 'acc-1' }),
        );
        expect(result.success).toBe(false);
      }),
      { numRuns: 20 },
    );
  });

  it('accepts bitcoin transfers with Sats unit and integer quantity', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_000_000_000 }), (quantity) => {
        const result = BitcoinTransferSchema.safeParse(
          validBitcoinBase({ quantity, bitcoinUnit: 'Sats' }),
        );
        expect(result.success).toBe(true);
      }),
      { numRuns: 20 },
    );
  });
});

/**
 * Feature: investment-transfers, Property 9: Stock fee requires category and account
 * Validates: Requirements 5.2
 *
 * For any stock transfer request with a fee amount > 0 but missing feeBudgetId
 * or feeAccountId, the validation schema rejects the request.
 */
describe('Property 9: Stock fee requires category and account', () => {
  it('rejects stock transfers with fee > 0 but missing feeBudgetId', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: 1e6, noNaN: true }),
        idArb,
        (feeAmount, feeAccountId) => {
          const result = StockTransferSchema.safeParse(validStockBase({ feeAmount, feeAccountId }));
          expect(result.success).toBe(false);
        },
      ),
      { numRuns: 20 },
    );
  });

  it('rejects stock transfers with fee > 0 but missing feeAccountId', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: 1e6, noNaN: true }),
        idArb,
        (feeAmount, feeBudgetId) => {
          const result = StockTransferSchema.safeParse(validStockBase({ feeAmount, feeBudgetId }));
          expect(result.success).toBe(false);
        },
      ),
      { numRuns: 20 },
    );
  });

  it('rejects stock transfers with fee > 0 but missing both feeBudgetId and feeAccountId', () => {
    fc.assert(
      fc.property(fc.double({ min: 0.01, max: 1e6, noNaN: true }), (feeAmount) => {
        const result = StockTransferSchema.safeParse(validStockBase({ feeAmount }));
        expect(result.success).toBe(false);
      }),
      { numRuns: 20 },
    );
  });

  it('accepts stock transfers with fee > 0 and both feeBudgetId and feeAccountId', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: 1e6, noNaN: true }),
        idArb,
        idArb,
        (feeAmount, feeBudgetId, feeAccountId) => {
          const result = StockTransferSchema.safeParse(
            validStockBase({ feeAmount, feeBudgetId, feeAccountId }),
          );
          expect(result.success).toBe(true);
        },
      ),
      { numRuns: 20 },
    );
  });

  it('accepts stock transfers with no fee (fee omitted)', () => {
    const result = StockTransferSchema.safeParse(validStockBase());
    expect(result.success).toBe(true);
  });

  it('accepts stock transfers with zero fee and no category/account', () => {
    const result = StockTransferSchema.safeParse(validStockBase({ feeAmount: 0 }));
    expect(result.success).toBe(true);
  });
});
