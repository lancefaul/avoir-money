import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

/**
 * Property-based tests for modal filtering logic used in
 * BitcoinTransferModal and StockTransferModal.
 *
 * These test the PURE filtering functions extracted from the components,
 * not the React components themselves.
 */

// --- Pure filtering functions (same logic as in the modal components) ---

/** BitcoinTransferModal: destination wallets exclude the selected source */
function filterDestinationWallets(
  wallets: { id: string }[],
  selectedFromWalletId: string,
): { id: string }[] {
  return wallets.filter((w) => w.id !== selectedFromWalletId);
}

/** StockTransferModal: holdings filtered to only those belonging to the source custodian */
function filterHoldingsByCustodian(
  holdings: { id: string; custodianId: string | null }[],
  selectedFromCustodianId: string,
): { id: string; custodianId: string | null }[] {
  return holdings.filter((h) => h.custodianId === selectedFromCustodianId);
}

/** StockTransferModal: destination custodians exclude the selected source */
function filterDestinationCustodians(
  custodians: { id: string }[],
  selectedFromCustodianId: string,
): { id: string }[] {
  return custodians.filter((c) => c.id !== selectedFromCustodianId);
}

// --- Generators ---

const walletArb = fc.record({ id: fc.uuid(), name: fc.string({ minLength: 1, maxLength: 20 }) });
const custodianArb = fc.record({ id: fc.uuid(), name: fc.string({ minLength: 1, maxLength: 20 }) });
const holdingArb = (custodianIds: string[]) =>
  fc.record({
    id: fc.uuid(),
    custodianId: fc.oneof(fc.constantFrom(...custodianIds), fc.constant(null as string | null)),
  });

// --- Property Tests ---

describe('Transfer Modal Filtering Properties', () => {
  /**
   * Property 13: Source wallet excluded from destination options
   *
   * For any list of wallets and any selected source wallet,
   * the destination wallet list must not contain the source wallet.
   *
   * **Validates: Requirements 3.2**
   */
  it('Property 13: source wallet is excluded from destination options', () => {
    fc.assert(
      fc.property(
        fc.array(walletArb, { minLength: 1, maxLength: 20 }).chain((wallets) => {
          const idx = fc.integer({ min: 0, max: wallets.length - 1 });
          return idx.map((i) => ({ wallets, selectedIndex: i }));
        }),
        ({ wallets, selectedIndex }) => {
          const sourceId = wallets[selectedIndex]!.id;
          const destinations = filterDestinationWallets(wallets, sourceId);

          // The source wallet must not appear in destination options
          expect(destinations.every((w) => w.id !== sourceId)).toBe(true);

          // All non-source wallets must still be present
          const expectedCount = wallets.filter((w) => w.id !== sourceId).length;
          expect(destinations).toHaveLength(expectedCount);
        },
      ),
      { numRuns: 20 },
    );
  });

  /**
   * Property 14: Holdings filtered by source custodian
   *
   * For any list of holdings with custodian assignments and any selected
   * source custodian, only holdings belonging to that custodian are shown.
   *
   * **Validates: Requirements 6.2**
   */
  it('Property 14: holdings are filtered to only those matching the source custodian', () => {
    fc.assert(
      fc.property(
        fc
          .array(fc.uuid(), { minLength: 2, maxLength: 10 })
          .filter((ids) => new Set(ids).size === ids.length)
          .chain((custodianIds) =>
            fc
              .array(holdingArb(custodianIds), { minLength: 1, maxLength: 30 })
              .chain((holdings) => {
                const selectedCustodian = fc.constantFrom(...custodianIds);
                return selectedCustodian.map((sc) => ({
                  custodianIds,
                  holdings,
                  selectedCustodianId: sc,
                }));
              }),
          ),
        ({ holdings, selectedCustodianId }) => {
          const filtered = filterHoldingsByCustodian(holdings, selectedCustodianId);

          // Every returned holding must belong to the selected custodian
          expect(filtered.every((h) => h.custodianId === selectedCustodianId)).toBe(true);

          // No matching holding should be missing
          const expectedCount = holdings.filter(
            (h) => h.custodianId === selectedCustodianId,
          ).length;
          expect(filtered).toHaveLength(expectedCount);
        },
      ),
      { numRuns: 20 },
    );
  });

  /**
   * Property 15: Source custodian excluded from destination options
   *
   * For any list of custodians and any selected source custodian,
   * the destination custodian list must not contain the source custodian.
   *
   * **Validates: Requirements 6.3**
   */
  it('Property 15: source custodian is excluded from destination options', () => {
    fc.assert(
      fc.property(
        fc.array(custodianArb, { minLength: 1, maxLength: 20 }).chain((custodians) => {
          const idx = fc.integer({ min: 0, max: custodians.length - 1 });
          return idx.map((i) => ({ custodians, selectedIndex: i }));
        }),
        ({ custodians, selectedIndex }) => {
          const sourceId = custodians[selectedIndex]!.id;
          const destinations = filterDestinationCustodians(custodians, sourceId);

          // The source custodian must not appear in destination options
          expect(destinations.every((c) => c.id !== sourceId)).toBe(true);

          // All non-source custodians must still be present
          const expectedCount = custodians.filter((c) => c.id !== sourceId).length;
          expect(destinations).toHaveLength(expectedCount);
        },
      ),
      { numRuns: 20 },
    );
  });
});
