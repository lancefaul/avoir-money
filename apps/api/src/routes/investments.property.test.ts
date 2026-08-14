/**
 * Property-based tests for investment holdings API.
 * Feature: holdings-overhaul, Property 1: Type-FK invariant
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { prisma } from '@budget-tracker/db';
import { del, get, post, put } from '../test/helpers.js';

// ─── Types ───

const CUSTODIAN_TYPES = ['STOCK'] as const;
const ALL_TYPES = ['STOCK', 'BITCOIN'] as const;

type InvestmentType = (typeof ALL_TYPES)[number];

// ─── Helpers ───

async function createCustodian(name: string) {
  return prisma.custodian.create({ data: { name } });
}

async function createWallet(name: string) {
  return prisma.wallet.create({ data: { name } });
}

/**
 * Determines whether a given type + FK combination is valid per the invariant:
 * - STOCK/ETF/MUTUAL_FUND → custodianId only (no walletId)
 * - CRYPTO → walletId only (no custodianId)
 */
function isValidCombo(
  type: InvestmentType,
  fk: 'custodianOnly' | 'walletOnly' | 'both' | 'neither',
): boolean {
  const isCustodianType = (CUSTODIAN_TYPES as readonly string[]).includes(type);
  if (isCustodianType) return fk === 'custodianOnly';
  if (type === 'BITCOIN') return fk === 'walletOnly';
  return false;
}

// ─── Arbitraries ───

const investmentTypeArb = fc.constantFrom(...ALL_TYPES);
const fkAssignmentArb = fc.constantFrom(
  'custodianOnly',
  'walletOnly',
  'both',
  'neither',
) as fc.Arbitrary<'custodianOnly' | 'walletOnly' | 'both' | 'neither'>;

// ─── Property 1: Type-FK invariant ───

describe('Feature: holdings-overhaul, Property 1: Type-FK invariant', () => {
  /**
   * **Validates: Requirements 1.3, 1.4, 2.1, 2.2, 3.1**
   *
   * For any investment type and FK assignment combination:
   * - Valid combos (custodian types + custodianId, CRYPTO + walletId) → 201
   * - Invalid combos → 400
   */
  it('valid type-FK combinations are accepted on create', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...CUSTODIAN_TYPES),
        fc.string({ minLength: 1, maxLength: 10 }).map((s) => `Hold_${s}`),
        fc.integer({ min: 1, max: 1000 }),
        async (type, name, quantity) => {
          const custodian = await createCustodian(`C_${Date.now()}_${Math.random()}`);

          const res = await post('/investments', {
            name,
            type,
            quantity,
            custodianId: custodian.id,
          });
          expect(res.status).toBe(201);

          const body = (await res.json()) as Record<string, unknown>;
          expect(body.custodianId).toBe(custodian.id);
          expect(body.walletId).toBeNull();
        },
      ),
      { numRuns: 20 },
    );
  });

  it('valid CRYPTO + walletId combination is accepted on create', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 10 }).map((s) => `Bitcoin_${s}`),
        fc.integer({ min: 1, max: 1000 }),
        async (name, quantity) => {
          const wallet = await createWallet(`W_${Date.now()}_${Math.random()}`);

          const res = await post('/investments', {
            name,
            type: 'BITCOIN',
            quantity,
            walletId: wallet.id,
          });
          expect(res.status).toBe(201);

          const body = (await res.json()) as Record<string, unknown>;
          expect(body.walletId).toBe(wallet.id);
          expect(body.custodianId).toBeNull();
        },
      ),
      { numRuns: 20 },
    );
  });

  it('invalid type-FK combinations are rejected on create', async () => {
    await fc.assert(
      fc.asyncProperty(
        investmentTypeArb,
        fkAssignmentArb,
        fc.integer({ min: 1, max: 1000 }),
        async (type, fkAssignment, quantity) => {
          // Skip valid combos — we only want to test invalid ones
          if (isValidCombo(type, fkAssignment)) return;

          const custodian = await createCustodian(`C_${Date.now()}_${Math.random()}`);
          const wallet = await createWallet(`W_${Date.now()}_${Math.random()}`);

          const body: Record<string, unknown> = {
            name: 'TestHolding',
            type,
            quantity,
          };

          if (fkAssignment === 'custodianOnly') body.custodianId = custodian.id;
          else if (fkAssignment === 'walletOnly') body.walletId = wallet.id;
          else if (fkAssignment === 'both') {
            body.custodianId = custodian.id;
            body.walletId = wallet.id;
          }
          // 'neither' → no FK set

          const res = await post('/investments', body);
          expect(res.status).toBe(400);
        },
      ),
      { numRuns: 20 },
    );
  });

  it('type-FK invariant holds on update: mismatched FK is rejected', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...CUSTODIAN_TYPES),
        fc.integer({ min: 1, max: 1000 }),
        async (type, quantity) => {
          // Create a valid holding first
          const custodian = await createCustodian(`C_${Date.now()}_${Math.random()}`);
          const wallet = await createWallet(`W_${Date.now()}_${Math.random()}`);

          const createRes = await post('/investments', {
            name: 'ValidHolding',
            type,
            quantity,
            custodianId: custodian.id,
          });
          expect(createRes.status).toBe(201);
          const { id } = (await createRes.json()) as { id: string };

          // Try to update with walletId + type → should be rejected
          const res = await put(`/investments/${id}`, { type, walletId: wallet.id });
          expect(res.status).toBe(400);
        },
      ),
      { numRuns: 20 },
    );
  });

  it('type-FK invariant holds on update: CRYPTO with custodianId is rejected', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 1000 }), async (quantity) => {
        const custodian = await createCustodian(`C_${Date.now()}_${Math.random()}`);
        const wallet = await createWallet(`W_${Date.now()}_${Math.random()}`);

        // Create a valid CRYPTO holding
        const createRes = await post('/investments', {
          name: 'BitcoinHolding',
          type: 'BITCOIN',
          quantity,
          walletId: wallet.id,
        });
        expect(createRes.status).toBe(201);
        const { id } = (await createRes.json()) as { id: string };

        // Try to update with custodianId + CRYPTO type → should be rejected
        const res = await put(`/investments/${id}`, { type: 'BITCOIN', custodianId: custodian.id });
        expect(res.status).toBe(400);
      }),
      { numRuns: 20 },
    );
  });
});

// ─── Property 2: Valid create round-trip ───

describe('Feature: holdings-overhaul, Property 2: Valid create round-trip', () => {
  /**
   * **Validates: Requirements 2.3**
   *
   * For any valid create payload (with correct type-FK pairing and an existing
   * custodian/wallet), the Holdings API returns a 201 response, and the returned
   * holding contains the same name, ticker, type, quantity, cost basis, and FK
   * values that were submitted.
   */

  // ─── Arbitraries ───

  /** Name: 1-200 printable chars, no leading/trailing whitespace issues */
  const nameArb = fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0);

  /** Optional ticker: up to 20 chars */
  const tickerArb = fc.option(
    fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0),
    { nil: undefined },
  );

  /** Non-negative quantity (integer for simplicity, avoids floating-point noise) */
  const quantityArb = fc.integer({ min: 0, max: 1_000_000 });

  /** Optional non-negative cost basis */
  const costBasisArb = fc.option(fc.integer({ min: 0, max: 10_000_000 }), {
    nil: undefined,
  });

  it('custodian-type holdings round-trip correctly', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...CUSTODIAN_TYPES),
        nameArb,
        tickerArb,
        quantityArb,
        costBasisArb,
        async (type, name, ticker, quantity, costBasis) => {
          // Create a real custodian for this iteration
          const custodian = await createCustodian(`C_${Date.now()}_${Math.random()}`);

          const payload: Record<string, unknown> = {
            name,
            type,
            quantity,
            custodianId: custodian.id,
          };
          if (ticker !== undefined) payload.ticker = ticker;
          if (costBasis !== undefined) payload.costBasis = costBasis;

          const res = await post('/investments', payload);
          expect(res.status).toBe(201);

          const body = (await res.json()) as Record<string, unknown>;

          // Round-trip: response matches input
          expect(body.name).toBe(name);
          expect(body.ticker).toBe(ticker ?? null);
          expect(body.type).toBe(type);
          expect(body.quantity).toBe(quantity);
          expect(body.costBasis).toBe(costBasis ?? null);
          expect(body.custodianId).toBe(custodian.id);
          expect(body.walletId).toBeNull();
        },
      ),
      { numRuns: 20 },
    );
  });

  it('CRYPTO holdings round-trip correctly', async () => {
    await fc.assert(
      fc.asyncProperty(
        nameArb,
        tickerArb,
        quantityArb,
        costBasisArb,
        async (name, ticker, quantity, costBasis) => {
          // Create a real wallet for this iteration
          const wallet = await createWallet(`W_${Date.now()}_${Math.random()}`);

          const payload: Record<string, unknown> = {
            name,
            type: 'BITCOIN',
            quantity,
            walletId: wallet.id,
          };
          if (ticker !== undefined) payload.ticker = ticker;
          if (costBasis !== undefined) payload.costBasis = costBasis;

          const res = await post('/investments', payload);
          expect(res.status).toBe(201);

          const body = (await res.json()) as Record<string, unknown>;

          // Round-trip: response matches input
          expect(body.name).toBe(name);
          expect(body.ticker).toBe(ticker ?? null);
          expect(body.type).toBe('BITCOIN');
          expect(body.quantity).toBe(quantity);
          expect(body.costBasis).toBe(costBasis ?? null);
          expect(body.walletId).toBe(wallet.id);
          expect(body.custodianId).toBeNull();
        },
      ),
      { numRuns: 20 },
    );
  });
});

// ─── Property 3: List response completeness ───

describe('Feature: holdings-overhaul, Property 3: List response completeness', () => {
  /**
   * **Validates: Requirements 4.1, 4.2**
   *
   * For any holding returned by the list endpoint:
   * - If custodianId is set, custodianName matches the Custodian's actual name
   * - If walletId is set, walletName matches the Wallet's actual name
   * - If snapshots exist, latestSnapshot is the most recent by date
   */

  /** Arbitrary for a small positive integer of holdings to create */
  const holdingCountArb = fc.integer({ min: 1, max: 5 });

  /** Arbitrary for number of snapshots per holding (0 = no snapshots) */
  const snapshotCountArb = fc.integer({ min: 0, max: 4 });

  /** Arbitrary for a snapshot date within a reasonable range (filter out NaN) */
  const snapshotDateArb = fc
    .date({
      min: new Date('2020-01-01'),
      max: new Date('2026-12-31'),
    })
    .filter((d) => !isNaN(d.getTime()));

  /** Arbitrary for snapshot value (nullable) */
  const snapshotValueArb = fc.option(fc.integer({ min: 1, max: 1_000_000 }), { nil: null });

  /** Arbitrary for holding type — determines custodian vs wallet */
  const holdingTypeArb = fc.constantFrom(...ALL_TYPES);

  it('list response includes correct custodianName, walletName, and latestSnapshot', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.tuple(
            holdingTypeArb,
            snapshotCountArb,
            fc.array(fc.tuple(snapshotDateArb, snapshotValueArb), { minLength: 0, maxLength: 4 }),
          ),
          { minLength: 1, maxLength: 5 },
        ),
        async (holdingSpecs) => {
          // Track what we create so we can verify the list response
          const created: Array<{
            holdingId: string;
            custodianId: string | null;
            walletId: string | null;
            custodianName: string | null;
            walletName: string | null;
            snapshots: Array<{ date: Date; quantity: number; value: number | null }>;
          }> = [];

          for (const [type, _snapshotCount, snapshotDateValues] of holdingSpecs) {
            const isCustodianType = (CUSTODIAN_TYPES as readonly string[]).includes(type);

            let custodianId: string | null = null;
            let walletId: string | null = null;
            let custodianName: string | null = null;
            let walletName: string | null = null;

            if (isCustodianType) {
              const name = `Cust_${Date.now()}_${Math.random()}`;
              const c = await createCustodian(name);
              custodianId = c.id;
              custodianName = name;
            } else {
              const name = `Wal_${Date.now()}_${Math.random()}`;
              const w = await createWallet(name);
              walletId = w.id;
              walletName = name;
            }

            // Create the holding via API
            const payload: Record<string, unknown> = {
              name: `Holding_${Date.now()}_${Math.random()}`,
              type,
              quantity: 10,
            };
            if (custodianId) payload.custodianId = custodianId;
            if (walletId) payload.walletId = walletId;

            const createRes = await post('/investments', payload);
            expect(createRes.status).toBe(201);
            const holding = (await createRes.json()) as { id: string };

            // Create snapshots directly via prisma
            const snapshots: Array<{ date: Date; quantity: number; value: number | null }> = [];
            for (const [date, value] of snapshotDateValues) {
              const snap = { date, quantity: 10, value };
              await prisma.investmentSnapshot.create({
                data: {
                  holdingId: holding.id,
                  date: snap.date,
                  quantity: snap.quantity,
                  value: snap.value,
                },
              });
              snapshots.push(snap);
            }

            created.push({
              holdingId: holding.id,
              custodianId,
              walletId,
              custodianName,
              walletName,
              snapshots,
            });
          }

          // GET the list
          const listRes = await get('/investments');
          expect(listRes.status).toBe(200);
          const listings = (await listRes.json()) as Array<Record<string, unknown>>;

          // Verify each created holding appears in the response with correct data
          for (const entry of created) {
            const found = listings.find((l) => l.id === entry.holdingId);
            expect(found).toBeDefined();
            if (!found) continue;

            // Verify custodianName
            if (entry.custodianId) {
              expect(found.custodianName).toBe(entry.custodianName);
            }

            // Verify walletName
            if (entry.walletId) {
              expect(found.walletName).toBe(entry.walletName);
            }

            // Verify latestSnapshot
            if (entry.snapshots.length === 0) {
              expect(found.latestSnapshot).toBeNull();
            } else {
              // Find the most recent snapshot by date
              const mostRecent = entry.snapshots.reduce((latest, s) =>
                s.date.getTime() > latest.date.getTime() ? s : latest,
              );

              expect(found.latestSnapshot).not.toBeNull();
              const snap = found.latestSnapshot as Record<string, unknown>;
              // Compare dates (API returns ISO string)
              expect(new Date(snap.date as string).getTime()).toBe(mostRecent.date.getTime());
            }
          }
        },
      ),
      { numRuns: 20 },
    );
  });
});

// ─── Property 7: Deletion protection for entities with holdings ───

describe('Feature: holdings-overhaul, Property 7: Deletion protection for entities with holdings', () => {
  /**
   * **Validates: Requirements 8.1, 8.2**
   *
   * For any Custodian or Wallet that has at least one linked InvestmentHolding,
   * attempting to delete that entity via the API returns a 409 status code.
   * Conversely, for any Custodian or Wallet with zero linked holdings (and zero
   * linked trades), deletion succeeds with 204.
   */

  const entityTypeArb = fc.constantFrom('custodian', 'wallet') as fc.Arbitrary<
    'custodian' | 'wallet'
  >;

  it('entities with holdings cannot be deleted (409), entities without can be deleted (204)', async () => {
    await fc.assert(
      fc.asyncProperty(entityTypeArb, fc.boolean(), async (entityType, hasHoldings) => {
        // Create the entity
        const uniqueSuffix = `${Date.now()}_${Math.random()}`;

        let entityId: string;
        let deletePath: string;

        if (entityType === 'custodian') {
          const custodian = await createCustodian(`DelTest_C_${uniqueSuffix}`);
          entityId = custodian.id;
          deletePath = `/investments/custodians/${entityId}`;
        } else {
          const wallet = await createWallet(`DelTest_W_${uniqueSuffix}`);
          entityId = wallet.id;
          deletePath = `/investments/wallets/${entityId}`;
        }

        // If hasHoldings, create a holding linked to this entity
        if (hasHoldings) {
          if (entityType === 'custodian') {
            await prisma.investmentHolding.create({
              data: {
                name: `Hold_${uniqueSuffix}`,
                type: 'STOCK',
                quantity: 1,
                custodianId: entityId,
              },
            });
          } else {
            await prisma.investmentHolding.create({
              data: {
                name: `Hold_${uniqueSuffix}`,
                type: 'BITCOIN',
                quantity: 1,
                walletId: entityId,
              },
            });
          }
        }

        // Attempt to delete the entity
        const res = await del(deletePath);

        if (hasHoldings) {
          expect(res.status).toBe(409);
        } else {
          expect(res.status).toBe(204);
        }
      }),
      { numRuns: 20 },
    );
  });
});
