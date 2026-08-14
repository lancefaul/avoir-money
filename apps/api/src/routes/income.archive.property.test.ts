/**
 * Property-based tests for archive/restore API endpoints on income.
 * Feature: archive-recurring
 *
 * These tests hit the real API routes against the test database (port 5433).
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { prisma } from '@budget-tracker/db';
import {
  get,
  post,
  createGroup,
  createCategory,
  createIncome,
  createAccount,
} from '../test/helpers.js';
import { makeDate } from '../lib/dates.js';

async function setupBase() {
  const group = await createGroup();
  const cat = await createCategory(group.id);
  const acct = await createAccount();
  return { group, cat, acct };
}

// ─── Property 3: List filtering by archive status ───

describe('Feature: archive-recurring, Property 3: List filtering by archive status', () => {
  /**
   * **Validates: Requirements 3.1, 3.2, 4.3, 4.4, 5.3**
   *
   * For any set of income sources with mixed archive states, querying with
   * archived=false (or no parameter) SHALL return exactly those sources where
   * archivedAt is null, and querying with archived=true SHALL return exactly
   * those sources where archivedAt is non-null. The two result sets SHALL be
   * disjoint and their union SHALL equal the full set of sources.
   */
  it('active and archived lists are disjoint and partition all sources', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 1, max: 5 }),
        async (activeCount, archivedCount) => {
          const { cat } = await setupBase();

          // Create active income sources
          const activeIds: string[] = [];
          for (let i = 0; i < activeCount; i++) {
            const income = await createIncome(cat.id, {
              amount: 1000 + i * 100,
              frequency: 'MONTHLY',
            });
            activeIds.push(income.id);
          }

          // Create income sources and then archive them
          const archivedIds: string[] = [];
          for (let i = 0; i < archivedCount; i++) {
            const income = await createIncome(cat.id, {
              amount: 2000 + i * 100,
              frequency: 'WEEKLY',
            });
            const archiveRes = await post(`/income/${income.id}/archive`, {});
            expect(archiveRes.status).toBe(200);
            archivedIds.push(income.id);
          }

          // Query active sources (default / archived=false)
          const activeRes = await get(`/income?archived=false&limit=500`);
          expect(activeRes.status).toBe(200);
          const activeSources = (await activeRes.json()) as Array<Record<string, unknown>>;

          // Query archived sources
          const archivedRes = await get(`/income?archived=true&limit=500`);
          expect(archivedRes.status).toBe(200);
          const archivedSources = (await archivedRes.json()) as Array<Record<string, unknown>>;

          // Every active source must have archivedAt = null
          for (const src of activeSources) {
            expect(src.archivedAt).toBeNull();
          }

          // Every archived source must have archivedAt non-null
          for (const src of archivedSources) {
            expect(src.archivedAt).not.toBeNull();
          }

          // The two sets must be disjoint (no ID appears in both)
          const activeResultIds = activeSources.map((s) => s.id as string);
          const archivedResultIds = archivedSources.map((s) => s.id as string);
          const activeResultSet = new Set(activeResultIds);
          const archivedResultSet = new Set(archivedResultIds);

          for (const id of archivedResultIds) {
            expect(activeResultSet.has(id)).toBe(false);
          }

          // Each of our created active IDs must appear in the active list
          for (const id of activeIds) {
            expect(activeResultSet.has(id)).toBe(true);
          }

          // Each of our archived IDs must appear in the archived list
          for (const id of archivedIds) {
            expect(archivedResultSet.has(id)).toBe(true);
          }

          // None of the active IDs should appear in archived list
          for (const id of activeIds) {
            expect(archivedResultSet.has(id)).toBe(false);
          }

          // None of the archived IDs should appear in active list
          for (const id of archivedIds) {
            expect(activeResultSet.has(id)).toBe(false);
          }
        },
      ),
      { numRuns: 20 },
    );
  });
});

// ─── Property 2: Transactions preserved after archive ───

describe('Feature: archive-recurring, Property 2: Transactions preserved after archive', () => {
  /**
   * **Validates: Requirements 1.2**
   *
   * For any recurring income source with linked transactions, archiving the
   * source SHALL leave all linked transactions unchanged — same IDs, amounts,
   * dates, names, and foreign key references.
   */
  it('archiving a source leaves all linked transactions unchanged', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 100, max: 9000 }),
        async (txCount, amount) => {
          const { cat, acct } = await setupBase();
          const income = await createIncome(cat.id, {
            amount,
            frequency: 'MONTHLY',
            accountId: acct.id,
          });

          // Create linked transactions
          const txIds: string[] = [];
          for (let i = 0; i < txCount; i++) {
            const tx = await prisma.transaction.create({
              data: {
                type: 'INCOME',
                name: income.name,
                amount,
                date: makeDate(2026, 2, Math.min(i + 1, 28)),
                accountId: acct.id,
                incomeId: income.id,
              },
            });
            txIds.push(tx.id);
          }

          // Snapshot all transactions before archive
          const before = await prisma.transaction.findMany({
            where: { incomeId: income.id },
            orderBy: { id: 'asc' },
          });
          expect(before.length).toBe(txCount);

          // Archive the income source
          const archiveRes = await post(`/income/${income.id}/archive`, {});
          expect(archiveRes.status).toBe(200);

          // Verify all transactions are unchanged
          const after = await prisma.transaction.findMany({
            where: { incomeId: income.id },
            orderBy: { id: 'asc' },
          });

          expect(after.length).toBe(before.length);

          for (let i = 0; i < before.length; i++) {
            const bTx = before[i]!;
            const aTx = after[i]!;
            expect(aTx.id).toBe(bTx.id);
            expect(Number(aTx.amount)).toBe(Number(bTx.amount));
            expect(aTx.date.getTime()).toBe(bTx.date.getTime());
            expect(aTx.name).toBe(bTx.name);
            expect(aTx.incomeId).toBe(bTx.incomeId);
            expect(aTx.accountId).toBe(bTx.accountId);
            expect(aTx.type).toBe(bTx.type);
          }
        },
      ),
      { numRuns: 20 },
    );
  });
});
