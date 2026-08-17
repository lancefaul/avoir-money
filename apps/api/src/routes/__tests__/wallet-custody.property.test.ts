/**
 * Property-based tests for wallet custody type API behavior.
 * Feature: wallet-custody-type
 *
 * Property 3: Custody type change clears storage type
 * **Validates: Requirements 2.4, 5.4**
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { prisma } from '@budget-tracker/db';
import { put } from '../../test/helpers.js';

// ─── Helpers ───

let counter = 0;
function uniqueName() {
  return `PBT_WALLET_${++counter}_${Date.now()}`;
}

// ─── Property 3: Custody type change clears storage type ───

describe('Feature: wallet-custody-type, Property 3: Custody type change clears storage type', () => {
  /**
   * **Validates: Requirements 2.4, 5.4**
   *
   * For any custodial wallet with HOT or COLD storageType, updating
   * to NON_CUSTODIAL results in storageType being null — regardless
   * of what the update request body contains.
   */
  const storageTypeArb = fc.constantFrom('HOT' as const, 'COLD' as const);

  it('updating a custodial wallet to NON_CUSTODIAL always clears storageType', async () => {
    await fc.assert(
      fc.asyncProperty(storageTypeArb, async (storageType) => {
        // 1. Create a custodial wallet directly via Prisma
        const wallet = await prisma.wallet.create({
          data: {
            name: uniqueName(),
            custodyType: 'CUSTODIAL',
            storageType,
          },
        });
        expect(wallet.custodyType).toBe('CUSTODIAL');
        expect(wallet.storageType).toBe(storageType);

        // 2. Update to NON_CUSTODIAL via the API
        const updateRes = await put(`/investments/wallets/${wallet.id}`, {
          custodyType: 'NON_CUSTODIAL',
        });
        expect(updateRes.status).toBe(200);
        const updated = (await updateRes.json()) as {
          id: string;
          custodyType: string;
          storageType: string | null;
        };

        // 3. Verify the invariant: storageType must be null
        expect(updated.custodyType).toBe('NON_CUSTODIAL');
        expect(updated.storageType).toBeNull();

        // 4. Double-check the database record directly
        const dbRecord = await prisma.wallet.findUnique({ where: { id: wallet.id } });
        expect(dbRecord).not.toBeNull();
        expect(dbRecord!.storageType).toBeNull();
      }),
      { numRuns: 20 },
    );
  });
});
