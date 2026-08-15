/**
 * Property-based tests for healthcare insurance policy API.
 * Feature: healthcare-page-revamp (v2 — status-based model)
 *
 * Property 1: Policy creation and update round-trip
 * Property 2: Multiple active policies allowed per year per type
 * Property 4: Closed policy immutability
 * Property 10: Override persistence and independence
 * Property 12: Years endpoint returns distinct policy years
 * Property 14: End coverage and close lifecycle
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { get, post, put, patch } from '../../test/helpers.js';
import { prisma } from '@budget-tracker/db';

// ─── Arbitraries ───

/** Generate valid MEDICAL policy creation input (requires limits) */
const validMedicalPolicyArb = fc
  .record({
    type: fc.constant('MEDICAL' as const),
    year: fc.integer({ min: 2000, max: 2100 }),
    employer: fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
    premium: fc.double({ min: 0, max: 100_000, noNaN: true }),
    deductibleLimit: fc.double({ min: 0, max: 50_000, noNaN: true }),
    metadata: fc.record({
      insurer: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
      policyId: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
      groupNumber: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
    }),
  })
  .chain((base) =>
    fc
      .double({ min: base.deductibleLimit, max: base.deductibleLimit + 50_000, noNaN: true })
      .map((oopmLimit) => ({ ...base, oopmLimit })),
  );

/** Generate valid policy creation input for any type */
const validPolicyArb = validMedicalPolicyArb;

// ─── Types ───

interface PolicyWithBalance {
  id: string;
  type: string;
  year: number;
  employer: string;
  premium: number;
  deductibleLimit: number | null;
  oopmLimit: number | null;
  status: 'ACTIVE' | 'ENDED' | 'CLOSED';
  endedOn: string | null;
  closedOn: string | null;
  deductibleOverride: boolean;
  oopmOverride: boolean;
  metadata: unknown;
  budgetId: string | null;
  balance: {
    deductibleSpent: number | null;
    deductibleRaw: number;
    deductibleLimit: number | null;
    oopmSpent: number | null;
    oopmRaw: number;
    oopmLimit: number | null;
  };
}

// ─── Helper: create a MEDICAL policy for tests ───
const medicalPolicyInput = (
  year: number,
  employer: string,
  deductibleLimit: number,
  oopmLimit: number,
) => ({
  type: 'MEDICAL' as const,
  year,
  employer,
  premium: 0,
  deductibleLimit,
  oopmLimit,
  metadata: { insurer: 'PBT_Insurer', policyId: 'PBT_POL', groupNumber: 'PBT_GRP' },
});

// ─── Property 1: Policy creation and update round-trip ───

describe('Feature: healthcare-page-revamp, Property 1: Policy creation and update round-trip', () => {
  it('creating a policy and reading it back preserves all fields with status=ACTIVE', async () => {
    await fc.assert(
      fc.asyncProperty(validPolicyArb, async (input) => {
        const createRes = await post('/healthcare/policies', input);
        expect(createRes.status).toBe(201);
        const created = (await createRes.json()) as PolicyWithBalance;

        const getRes = await get(`/healthcare/policies/${created.id}`);
        expect(getRes.status).toBe(200);
        const fetched = (await getRes.json()) as PolicyWithBalance;

        expect(fetched.type).toBe(input.type);
        expect(fetched.year).toBe(input.year);
        expect(fetched.employer).toBe(input.employer);
        expect(fetched.premium).toBeCloseTo(input.premium, 2);
        expect(fetched.deductibleLimit).toBeCloseTo(input.deductibleLimit, 2);
        expect(fetched.oopmLimit).toBeCloseTo(input.oopmLimit, 2);

        expect(fetched.status).toBe('ACTIVE');
        expect(fetched.endedOn).toBeNull();
        expect(fetched.closedOn).toBeNull();
        expect(fetched.deductibleOverride).toBe(false);
        expect(fetched.oopmOverride).toBe(false);
        expect(fetched.budgetId).not.toBeNull();

        expect(fetched.balance.deductibleSpent).toBe(0);
        expect(fetched.balance.deductibleRaw).toBe(0);
        expect(fetched.balance.oopmSpent).toBe(0);
        expect(fetched.balance.oopmRaw).toBe(0);
      }),
      { numRuns: 20 },
    );
  });
});

// ─── Property 2: Multiple active policies allowed per year per type ───

describe('Feature: healthcare-page-revamp, Property 2: Multiple active policies allowed per year per type', () => {
  it('creating multiple policies for the same year and type keeps all active', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2000, max: 2100 }),
        fc.array(
          fc
            .record({
              employer: fc
                .string({ minLength: 1, maxLength: 50 })
                .filter((s) => s.trim().length > 0),
              premium: fc.double({ min: 0, max: 10_000, noNaN: true }),
              deductibleLimit: fc.double({ min: 0, max: 10_000, noNaN: true }),
            })
            .chain((base) =>
              fc
                .double({
                  min: base.deductibleLimit,
                  max: base.deductibleLimit + 10_000,
                  noNaN: true,
                })
                .map((oopmLimit) => ({ ...base, oopmLimit })),
            ),
          { minLength: 2, maxLength: 5 },
        ),
        async (year, policyInputs) => {
          await prisma.$executeRawUnsafe(
            'TRUNCATE TABLE "PolicyBudgetLink", "InsurancePolicy" CASCADE',
          );

          for (const input of policyInputs) {
            const createRes = await post('/healthcare/policies', {
              ...input,
              type: 'MEDICAL',
              year,
              metadata: { insurer: 'PBT_Insurer', policyId: 'PBT_POL', groupNumber: 'PBT_GRP' },
            });
            expect(createRes.status).toBe(201);
          }

          const listRes = await get(`/healthcare/policies?year=${year}`);
          expect(listRes.status).toBe(200);
          const policies = (await listRes.json()) as PolicyWithBalance[];

          const medicalPolicies = policies.filter((p) => p.type === 'MEDICAL');
          // All should be ACTIVE — no auto-freeze
          const activePolicies = medicalPolicies.filter((p) => p.status === 'ACTIVE');
          expect(activePolicies).toHaveLength(policyInputs.length);
        },
      ),
      { numRuns: 20 },
    );
  });
});

// ─── Property 4: Closed policy immutability ───

describe('Feature: healthcare-page-revamp, Property 4: Closed policy immutability', () => {
  it('rejects all updates on closed policies', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 2000, max: 2100 }), async (year) => {
        await prisma.$executeRawUnsafe(
          'TRUNCATE TABLE "PolicyBudgetLink", "InsurancePolicy" CASCADE',
        );

        const res1 = await post(
          '/healthcare/policies',
          medicalPolicyInput(year, 'EMP1', 5000, 10000),
        );
        expect(res1.status).toBe(201);
        const policy = (await res1.json()) as PolicyWithBalance;

        // End coverage
        const endRes = await post(`/healthcare/policies/${policy.id}/end-coverage`, {});
        expect(endRes.status).toBe(200);

        // Close
        const closeRes = await post(`/healthcare/policies/${policy.id}/close`, {});
        expect(closeRes.status).toBe(200);

        // Verify it's closed
        const getRes = await get(`/healthcare/policies/${policy.id}`);
        const closed = (await getRes.json()) as PolicyWithBalance;
        expect(closed.status).toBe('CLOSED');

        // Attempt updates — should all be 403
        const putRes = await put(`/healthcare/policies/${policy.id}`, {
          employer: 'NewCorp',
        });
        expect(putRes.status).toBe(403);

        const patchRes = await patch(`/healthcare/policies/${policy.id}/overrides`, {
          deductibleOverride: true,
        });
        expect(patchRes.status).toBe(403);
      }),
      { numRuns: 20 },
    );
  });
});

// ─── Property 14: End coverage and close lifecycle ───

describe('Feature: healthcare-page-revamp, Property 14: End coverage and close lifecycle', () => {
  it('policy follows ACTIVE → ENDED → CLOSED lifecycle correctly', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 2000, max: 2100 }), async (year) => {
        await prisma.$executeRawUnsafe(
          'TRUNCATE TABLE "PolicyBudgetLink", "InsurancePolicy" CASCADE',
        );

        const res1 = await post(
          '/healthcare/policies',
          medicalPolicyInput(year, 'EMP1', 5000, 10000),
        );
        expect(res1.status).toBe(201);
        const policy = (await res1.json()) as PolicyWithBalance;
        expect(policy.status).toBe('ACTIVE');

        // Cannot close an ACTIVE policy directly
        const closeFirst = await post(`/healthcare/policies/${policy.id}/close`, {});
        expect(closeFirst.status).toBe(400);

        // End coverage
        const endRes = await post(`/healthcare/policies/${policy.id}/end-coverage`, {});
        expect(endRes.status).toBe(200);
        const ended = (await endRes.json()) as PolicyWithBalance;
        expect(ended.status).toBe('ENDED');
        expect(ended.endedOn).not.toBeNull();

        // Cannot end coverage again
        const endAgain = await post(`/healthcare/policies/${policy.id}/end-coverage`, {});
        expect(endAgain.status).toBe(400);

        // Close the ended policy
        const closeRes = await post(`/healthcare/policies/${policy.id}/close`, {});
        expect(closeRes.status).toBe(200);
        const closed = (await closeRes.json()) as PolicyWithBalance;
        expect(closed.status).toBe('CLOSED');
        expect(closed.closedOn).not.toBeNull();
      }),
      { numRuns: 20 },
    );
  });
});

// ─── Property 10: Override persistence and independence ───

describe('Feature: healthcare-page-revamp, Property 10: Override persistence and independence', () => {
  it('toggling deductible override persists and does not affect OOPM override, and vice versa', async () => {
    await fc.assert(
      fc.asyncProperty(
        validPolicyArb,
        fc.boolean(),
        fc.boolean(),
        async (policyInput, deductibleFlag, oopmFlag) => {
          await prisma.$executeRawUnsafe(
            'TRUNCATE TABLE "PolicyBudgetLink", "InsurancePolicy" CASCADE',
          );

          const createRes = await post('/healthcare/policies', policyInput);
          expect(createRes.status).toBe(201);
          const policy = (await createRes.json()) as PolicyWithBalance;

          expect(policy.deductibleOverride).toBe(false);
          expect(policy.oopmOverride).toBe(false);

          const patchDeductible = await patch(`/healthcare/policies/${policy.id}/overrides`, {
            deductibleOverride: deductibleFlag,
          });
          expect(patchDeductible.status).toBe(200);
          const afterDeductible = (await patchDeductible.json()) as PolicyWithBalance;
          expect(afterDeductible.deductibleOverride).toBe(deductibleFlag);
          expect(afterDeductible.oopmOverride).toBe(false);

          const patchOopm = await patch(`/healthcare/policies/${policy.id}/overrides`, {
            oopmOverride: oopmFlag,
          });
          expect(patchOopm.status).toBe(200);
          const afterOopm = (await patchOopm.json()) as PolicyWithBalance;
          expect(afterOopm.oopmOverride).toBe(oopmFlag);
          expect(afterOopm.deductibleOverride).toBe(deductibleFlag);

          const getRes = await get(`/healthcare/policies/${policy.id}`);
          const reread = (await getRes.json()) as PolicyWithBalance;
          expect(reread.deductibleOverride).toBe(deductibleFlag);
          expect(reread.oopmOverride).toBe(oopmFlag);
        },
      ),
      { numRuns: 20 },
    );
  });
});

// ─── Property 12: Years endpoint returns distinct policy years ───

describe('Feature: healthcare-page-revamp, Property 12: Years endpoint returns distinct policy years', () => {
  it('returns exactly the distinct set of years from created policies', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 2000, max: 2100 }), { minLength: 2, maxLength: 8 }),
        async (years) => {
          await prisma.$executeRawUnsafe(
            'TRUNCATE TABLE "PolicyBudgetLink", "InsurancePolicy" CASCADE',
          );

          for (const year of years) {
            const createRes = await post(
              '/healthcare/policies',
              medicalPolicyInput(year, 'PBT_EMP', 1000, 2000),
            );
            expect(createRes.status).toBe(201);
          }

          const yearsRes = await get('/healthcare/years');
          expect(yearsRes.status).toBe(200);
          const returnedYears = (await yearsRes.json()) as number[];

          const expectedYears = [...new Set(years)].sort((a, b) => b - a);

          const uniqueReturned = [...new Set(returnedYears)];
          expect(returnedYears).toHaveLength(uniqueReturned.length);
          expect(returnedYears).toEqual(expectedYears);
        },
      ),
      { numRuns: 20 },
    );
  });
});
