import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { CustodyTypeSchema, StorageTypeSchema } from './enums.js';
import { CreateWalletSchema } from './wallet.js';

// ─── Property 1: Enum validation ───

describe('Feature: wallet-custody-type, Property 1: Enum validation', () => {
  /**
   * **Validates: Requirements 1.1, 3.1, 3.3**
   *
   * For any arbitrary string, the schema accepts it as custodyType iff it is
   * CUSTODIAL or NON_CUSTODIAL, and as storageType iff it is HOT or COLD.
   */
  const VALID_CUSTODY = ['CUSTODIAL', 'NON_CUSTODIAL'];
  const VALID_STORAGE = ['HOT', 'COLD'];

  it('CustodyTypeSchema accepts a string iff it is CUSTODIAL or NON_CUSTODIAL', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const result = CustodyTypeSchema.safeParse(s);
        if (VALID_CUSTODY.includes(s)) {
          expect(result.success).toBe(true);
        } else {
          expect(result.success).toBe(false);
        }
      }),
      { numRuns: 20 },
    );
  });

  it('StorageTypeSchema accepts a string iff it is HOT or COLD', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const result = StorageTypeSchema.safeParse(s);
        if (VALID_STORAGE.includes(s)) {
          expect(result.success).toBe(true);
        } else {
          expect(result.success).toBe(false);
        }
      }),
      { numRuns: 20 },
    );
  });
});

// ─── Property 2: Custody-storage invariant ───

describe('Feature: wallet-custody-type, Property 2: Custody-storage invariant', () => {
  /**
   * **Validates: Requirements 2.1, 2.2, 2.3, 3.2**
   *
   * For any combination of custodyType and storageType, the CreateWalletSchema
   * accepts iff custodial wallets have a non-null storageType and non-custodial
   * wallets have no storageType.
   */

  const custodyTypeArb = fc.constantFrom('CUSTODIAL', 'NON_CUSTODIAL');
  const storageTypeArb = fc.constantFrom('HOT', 'COLD');
  const optionalStorageArb = fc.oneof(
    storageTypeArb.map((s) => s as string | undefined),
    fc.constant(undefined as string | undefined),
  );

  it('CreateWalletSchema accepts iff the custody-storage invariant holds', () => {
    fc.assert(
      fc.property(
        custodyTypeArb,
        optionalStorageArb,
        fc.string({ minLength: 1, maxLength: 50 }),
        (custodyType, storageType, name) => {
          const input: Record<string, unknown> = { name, custodyType };
          if (storageType !== undefined) {
            input.storageType = storageType;
          }

          const result = CreateWalletSchema.safeParse(input);

          const shouldAccept =
            (custodyType === 'CUSTODIAL' && storageType !== undefined) ||
            (custodyType === 'NON_CUSTODIAL' && storageType === undefined);

          expect(result.success).toBe(shouldAccept);
        },
      ),
      { numRuns: 20 },
    );
  });

  it('CreateWalletSchema defaults to NON_CUSTODIAL when custodyType is omitted', () => {
    fc.assert(
      fc.property(
        optionalStorageArb,
        fc.string({ minLength: 1, maxLength: 50 }),
        (storageType, name) => {
          const input: Record<string, unknown> = { name };
          if (storageType !== undefined) {
            input.storageType = storageType;
          }

          const result = CreateWalletSchema.safeParse(input);

          // Omitted custodyType defaults to NON_CUSTODIAL, so storageType must be absent
          const shouldAccept = storageType === undefined;
          expect(result.success).toBe(shouldAccept);
        },
      ),
      { numRuns: 20 },
    );
  });
});
