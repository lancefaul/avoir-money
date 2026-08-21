/**
 * Property-based tests for Bitcoin Zod validation (pure, no DB).
 * Feature: expanded-bitcoin-features
 *
 * Property 6: Sats Quantity Integer Enforcement — **Validates: Requirements 4.2**
 * Property 7: Type-Based BitcoinMetadata Acceptance — **Validates: Requirements 4.3, 4.5, 4.6**
 * Property 8: Mutual Exclusivity of BitcoinMetadata and AccountId — **Validates: Requirements 4.7**
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { BitcoinPaymentMetadataSchema, CreateTransactionSchema } from '@budget-tracker/core';

// ─── Generators ───

/** Positive non-integer double for Sats rejection tests */
const nonIntegerPositiveArb = fc
  .double({ min: 0.01, max: 1_000_000, noNaN: true, noDefaultInfinity: true })
  .filter((n) => !Number.isInteger(n) && n > 0);

/** Valid walletId (non-empty string) */
const walletIdArb = fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0);

/** Positive price */
const unitPriceArb = fc.double({ min: 0.01, max: 200_000, noNaN: true, noDefaultInfinity: true });

/** Positive integer quantity (valid for Sats) */
const satsQuantityArb = fc.integer({ min: 1, max: 100_000_000 });

/** Bitcoin unit */
const bitcoinUnitArb = fc.constantFrom('Bitcoin' as const, 'Sats' as const);

/** Transaction types that accept bitcoinMetadata */
const acceptedTypeArb = fc.constantFrom('EXPENSE' as const, 'INCOME' as const, 'REFUND' as const);

/** Transaction types that reject bitcoinMetadata */
const rejectedTypeArb = fc.constantFrom('TRADE' as const, 'TRANSFER' as const);

/** Valid transaction name */
const nameArb = fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0);

/** Non-negative amount */
const amountArb = fc.double({ min: 0, max: 999_999, noNaN: true, noDefaultInfinity: true });

/** UUID-like accountId for mutual exclusivity tests */
const realAccountIdArb = fc.uuid();

/** Build a valid bitcoinMetadata object */
function validBitcoinMetadataArb() {
  return fc.record({
    walletId: walletIdArb,
    quantity: satsQuantityArb,
    bitcoinUnit: fc.constant('Sats' as const),
    unitPrice: unitPriceArb,
  });
}

// ─── Property 6: Sats Quantity Integer Enforcement ───

describe('Feature: expanded-bitcoin-features, Property 6: Sats Quantity Integer Enforcement', () => {
  /**
   * **Validates: Requirements 4.2**
   *
   * For any bitcoinMetadata where bitcoinUnit is "Sats" and quantity is not
   * a whole number, the Validation_Layer SHALL reject the input.
   */
  it('rejects non-integer quantity when bitcoinUnit is Sats', () => {
    fc.assert(
      fc.property(
        nonIntegerPositiveArb,
        walletIdArb,
        unitPriceArb,
        (quantity, walletId, unitPrice) => {
          const result = BitcoinPaymentMetadataSchema.safeParse({
            walletId,
            quantity,
            bitcoinUnit: 'Sats',
            unitPrice,
          });

          expect(result.success).toBe(false);
        },
      ),
      { numRuns: 20 },
    );
  });
});

// ─── Property 7: Type-Based BitcoinMetadata Acceptance ───

describe('Feature: expanded-bitcoin-features, Property 7: Type-Based BitcoinMetadata Acceptance', () => {
  /**
   * **Validates: Requirements 4.3, 4.5, 4.6**
   *
   * For any transaction with bitcoinMetadata present, the Validation_Layer
   * SHALL accept the transaction if and only if the type is EXPENSE, INCOME,
   * or REFUND. Transactions of type TRADE or TRANSFER with bitcoinMetadata
   * SHALL be rejected.
   */
  it('accepts bitcoinMetadata for EXPENSE, INCOME, and REFUND types', () => {
    fc.assert(
      fc.property(
        acceptedTypeArb,
        validBitcoinMetadataArb(),
        nameArb,
        amountArb,
        (type, bitcoinMetadata, name, amount) => {
          const result = CreateTransactionSchema.safeParse({
            type,
            name,
            amount,
            date: new Date().toISOString(),
            bitcoinMetadata,
          });

          expect(result.success).toBe(true);
        },
      ),
      { numRuns: 20 },
    );
  });

  it('rejects bitcoinMetadata for TRADE and TRANSFER types', () => {
    fc.assert(
      fc.property(
        rejectedTypeArb,
        validBitcoinMetadataArb(),
        nameArb,
        amountArb,
        (type, bitcoinMetadata, name, amount) => {
          const input: Record<string, unknown> = {
            type,
            name,
            amount,
            date: new Date().toISOString(),
            bitcoinMetadata,
          };

          // TRADE also requires tradeMetadata, but we're testing that
          // bitcoinMetadata is rejected regardless — so we add minimal
          // tradeMetadata for TRADE to avoid a different validation error
          // masking the one we care about.
          if (type === 'TRADE') {
            input.tradeMetadata = {
              direction: 'BUY',
              assetType: 'Stock',
              ticker: 'AAPL',
              unitPrice: 100,
              quantity: 1,
              custodianId: 'test',
            };
          }

          const result = CreateTransactionSchema.safeParse(input);

          // Should fail — bitcoinMetadata not allowed for TRADE/TRANSFER
          expect(result.success).toBe(false);
          if (!result.success) {
            const messages = result.error.issues.map((i) => i.message);
            if (type === 'TRADE') {
              expect(messages).toContain(
                'Bitcoin metadata is not allowed for TRADE transactions; use tradeMetadata',
              );
            } else {
              expect(messages).toContain(
                'Bitcoin metadata is not allowed for TRANSFER transactions; use the transfer endpoint',
              );
            }
          }
        },
      ),
      { numRuns: 20 },
    );
  });
});

// ─── Property 8: Mutual Exclusivity of BitcoinMetadata and AccountId ───

describe('Feature: expanded-bitcoin-features, Property 8: Mutual Exclusivity of BitcoinMetadata and AccountId', () => {
  /**
   * **Validates: Requirements 4.7**
   *
   * For any transaction that includes bitcoinMetadata, providing an
   * accountId SHALL cause the Validation_Layer to reject the transaction.
   * Bitcoin transactions use walletId in bitcoinMetadata, not accountId.
   */
  it('rejects when both bitcoinMetadata and accountId are provided', () => {
    fc.assert(
      fc.property(
        acceptedTypeArb,
        validBitcoinMetadataArb(),
        realAccountIdArb,
        nameArb,
        amountArb,
        (type, bitcoinMetadata, accountId, name, amount) => {
          const result = CreateTransactionSchema.safeParse({
            type,
            name,
            amount,
            date: new Date().toISOString(),
            accountId,
            bitcoinMetadata,
          });

          expect(result.success).toBe(false);
          if (!result.success) {
            const messages = result.error.issues.map((i) => i.message);
            expect(messages).toContain('Cannot provide both bitcoinMetadata and accountId');
          }
        },
      ),
      { numRuns: 20 },
    );
  });
});
