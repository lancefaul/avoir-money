import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { CreateCustodianSchema } from './custodian.js';
import { CreateWalletSchema } from './wallet.js';

/**
 * Feature: trade-transactions, Property 5: Custodian and Wallet name validation
 * Validates: Requirements 5.3, 6.3
 *
 * For any string, CreateCustodianSchema and CreateWalletSchema should accept names
 * that are non-empty and at most 100 characters. Empty strings and strings longer
 * than 100 characters should be rejected.
 */
describe('Property 5: Custodian and Wallet name validation', () => {
  const validName = fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.length >= 1);

  it('accepts non-empty names up to 100 characters for Custodian', () => {
    fc.assert(
      fc.property(validName, (name) => {
        const result = CreateCustodianSchema.safeParse({ name });
        expect(result.success).toBe(true);
      }),
      { numRuns: 20 },
    );
  });

  it('accepts non-empty names up to 100 characters for Wallet', () => {
    fc.assert(
      fc.property(validName, (name) => {
        const result = CreateWalletSchema.safeParse({ name });
        expect(result.success).toBe(true);
      }),
      { numRuns: 20 },
    );
  });

  it('rejects empty names for Custodian', () => {
    const result = CreateCustodianSchema.safeParse({ name: '' });
    expect(result.success).toBe(false);
  });

  it('rejects empty names for Wallet', () => {
    const result = CreateWalletSchema.safeParse({ name: '' });
    expect(result.success).toBe(false);
  });

  it('rejects names longer than 100 characters for Custodian', () => {
    const longName = fc.string({ minLength: 101, maxLength: 300 }).filter((s) => s.length > 100);
    fc.assert(
      fc.property(longName, (name) => {
        const result = CreateCustodianSchema.safeParse({ name });
        expect(result.success).toBe(false);
      }),
      { numRuns: 20 },
    );
  });

  it('rejects names longer than 100 characters for Wallet', () => {
    const longName = fc.string({ minLength: 101, maxLength: 300 }).filter((s) => s.length > 100);
    fc.assert(
      fc.property(longName, (name) => {
        const result = CreateWalletSchema.safeParse({ name });
        expect(result.success).toBe(false);
      }),
      { numRuns: 20 },
    );
  });
});
