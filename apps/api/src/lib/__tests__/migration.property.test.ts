/**
 * Property-based tests for migration script.
 * Feature: holdings-overhaul
 *
 * Property 6: Migration maps accountName to FK — **Validates: Requirements 7.1, 7.2, 7.3**
 *
 * Since the `accountName` column has been dropped, the migration script derives
 * the entity name from the holding's `name` field using `deriveEntityName()`.
 * This test validates both the derivation logic and the full migration flow
 * (creating holdings with null FKs, running the migration logic, verifying FKs).
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { prisma } from '@budget-tracker/db';

type InvestmentType = 'STOCK' | 'BITCOIN';

/**
 * Inline copy of deriveEntityName from scripts/migrate-holdings-fks.ts.
 * We inline it here because the migration script imports PrismaClient and
 * readline which aren't resolvable from the API vitest context.
 *
 * The canonical implementation lives in scripts/migrate-holdings-fks.ts.
 */
function deriveEntityName(holdingName: string): string {
  const trimmed = holdingName.trim();
  const lastSpace = trimmed.lastIndexOf(' ');
  if (lastSpace <= 0) return trimmed;
  return trimmed.substring(0, lastSpace).trim();
}

// ─── Constants ───

const CUSTODIAN_TYPES: InvestmentType[] = ['STOCK'];
const BITCOIN_TYPES: InvestmentType[] = ['BITCOIN'];

// ─── Generators ───

/** Generate a non-empty entity name (1-3 words, no leading/trailing spaces). */
const entityNameArb = fc
  .array(fc.stringMatching(/^[A-Za-z]{2,10}$/), { minLength: 1, maxLength: 3 })
  .map((words) => words.join(' '));

/** Generate a ticker-like suffix (e.g. "BTC", "$TCKB", "AAPL"). */
const tickerArb = fc.oneof(fc.stringMatching(/^[A-Z]{2,5}$/), fc.stringMatching(/^\$[A-Z]{2,5}$/));

/** Generate a holding name like "Fidelity $TCKB" or "Cash Wallet BTC". */
const holdingNameArb = fc
  .tuple(entityNameArb, tickerArb)
  .map(([entity, ticker]) => `${entity} ${ticker}`);

/** Generate a custodian-type holding type. */
const custodianTypeArb = fc.constantFrom<InvestmentType>(...CUSTODIAN_TYPES);

/** Generate a bitcoin-type holding type. */
const bitcoinTypeArb = fc.constant<InvestmentType>('BITCOIN');

// ─── Property 6 Part 1: deriveEntityName ───

describe('Feature: holdings-overhaul, Property 6: Migration maps accountName to FK', () => {
  describe('deriveEntityName extracts entity name from holding name', () => {
    /**
     * **Validates: Requirements 7.1, 7.2, 7.3**
     *
     * For any holding name of the form "EntityName TICKER", deriveEntityName
     * returns "EntityName" (everything before the last space-separated token).
     */
    it('extracts everything before the last space-separated token', () => {
      fc.assert(
        fc.property(holdingNameArb, (holdingName) => {
          const result = deriveEntityName(holdingName);
          const lastSpace = holdingName.trim().lastIndexOf(' ');
          const expected = holdingName.trim().substring(0, lastSpace).trim();
          expect(result).toBe(expected);
        }),
        { numRuns: 20 },
      );
    });

    it('returns the full name for single-word inputs', () => {
      fc.assert(
        fc.property(fc.stringMatching(/^[A-Za-z]{2,10}$/), (singleWord) => {
          expect(deriveEntityName(singleWord)).toBe(singleWord);
        }),
        { numRuns: 20 },
      );
    });
  });

  // ─── Property 6 Part 2: Full migration flow ───

  describe('migration logic sets correct FK for custodian-type holdings', () => {
    /**
     * **Validates: Requirements 7.1, 7.2, 7.3**
     *
     * For any holding with a custodian type (STOCK/ETF/MUTUAL_FUND) and null FKs,
     * after running the migration logic, the holding has custodianId set to the
     * Custodian whose name matches the derived entity name. If no matching
     * Custodian existed, one is created.
     */
    it('maps custodian-type holdings to the correct custodian FK', async () => {
      await fc.assert(
        fc.asyncProperty(
          entityNameArb,
          tickerArb,
          custodianTypeArb,
          fc.boolean(),
          async (entityName, ticker, holdingType, preCreateCustodian) => {
            // Use unique names to avoid collisions between iterations
            const uniqueEntity = `${entityName}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const holdingName = `${uniqueEntity} ${ticker}`;

            // Optionally pre-create the custodian to test both paths
            let preExistingCustodianId: string | null = null;
            if (preCreateCustodian) {
              const c = await prisma.custodian.create({ data: { name: uniqueEntity } });
              preExistingCustodianId = c.id;
            }

            // Create a holding with null FKs (simulating pre-migration state)
            const holding = await prisma.investmentHolding.create({
              data: {
                name: holdingName,
                ticker,
                type: holdingType,
                quantity: 10,
                costBasis: 100,
                custodianId: null,
                walletId: null,
              },
            });

            // ── Replicate the migration logic ──
            // This mirrors what the migration script does:
            // 1. Find holdings with null FKs
            // 2. Derive entity name
            // 3. Look up or create the entity
            // 4. Set the FK
            const derivedName = deriveEntityName(holding.name);
            expect(derivedName).toBe(uniqueEntity);

            let custodian = await prisma.custodian.findUnique({
              where: { name: derivedName },
            });
            if (!custodian) {
              custodian = await prisma.custodian.create({
                data: { name: derivedName },
              });
            }

            await prisma.investmentHolding.update({
              where: { id: holding.id },
              data: { custodianId: custodian.id },
            });

            // ── Verify ──
            const updated = await prisma.investmentHolding.findUnique({
              where: { id: holding.id },
              include: { custodian: true },
            });

            expect(updated).toBeDefined();
            expect(updated!.custodianId).toBe(custodian.id);
            expect(updated!.walletId).toBeNull();
            expect(updated!.custodian!.name).toBe(uniqueEntity);

            // If we pre-created the custodian, it should have been reused (not duplicated)
            if (preCreateCustodian) {
              expect(updated!.custodianId).toBe(preExistingCustodianId);
            }
          },
        ),
        { numRuns: 20 },
      );
    });
  });

  describe('migration logic sets correct FK for bitcoin-type holdings', () => {
    /**
     * **Validates: Requirements 7.1, 7.2, 7.3**
     *
     * For any holding with type CRYPTO and null FKs, after running the migration
     * logic, the holding has walletId set to the Wallet whose name matches the
     * derived entity name. If no matching Wallet existed, one is created.
     */
    it('maps bitcoin-type holdings to the correct wallet FK', async () => {
      await fc.assert(
        fc.asyncProperty(
          entityNameArb,
          tickerArb,
          bitcoinTypeArb,
          fc.boolean(),
          async (entityName, ticker, holdingType, preCreateWallet) => {
            const uniqueEntity = `${entityName}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const holdingName = `${uniqueEntity} ${ticker}`;

            // Optionally pre-create the wallet to test both paths
            let preExistingWalletId: string | null = null;
            if (preCreateWallet) {
              const w = await prisma.wallet.create({ data: { name: uniqueEntity } });
              preExistingWalletId = w.id;
            }

            // Create a holding with null FKs (simulating pre-migration state)
            const holding = await prisma.investmentHolding.create({
              data: {
                name: holdingName,
                ticker,
                type: holdingType,
                quantity: 5,
                costBasis: 50,
                custodianId: null,
                walletId: null,
              },
            });

            // ── Replicate the migration logic ──
            const derivedName = deriveEntityName(holding.name);
            expect(derivedName).toBe(uniqueEntity);

            let wallet = await prisma.wallet.findUnique({
              where: { name: derivedName },
            });
            if (!wallet) {
              wallet = await prisma.wallet.create({
                data: { name: derivedName },
              });
            }

            await prisma.investmentHolding.update({
              where: { id: holding.id },
              data: { walletId: wallet.id },
            });

            // ── Verify ──
            const updated = await prisma.investmentHolding.findUnique({
              where: { id: holding.id },
              include: { wallet: true },
            });

            expect(updated).toBeDefined();
            expect(updated!.walletId).toBe(wallet.id);
            expect(updated!.custodianId).toBeNull();
            expect(updated!.wallet!.name).toBe(uniqueEntity);

            // If we pre-created the wallet, it should have been reused (not duplicated)
            if (preCreateWallet) {
              expect(updated!.walletId).toBe(preExistingWalletId);
            }
          },
        ),
        { numRuns: 20 },
      );
    });
  });
});
