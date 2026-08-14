/**
 * Property-based tests for cursor-based pagination on the transactions API.
 * Feature: lazy-load-transactions, Properties 1-4, 6
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { prisma } from '@budget-tracker/db';
import { get, post, createAccount } from '../test/helpers.js';

// ─── Helpers ───

/** Truncate Transaction and Account tables between fast-check iterations (with deadlock retry). */
async function truncateIteration() {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "Transaction", "Account" CASCADE`);
      return;
    } catch (err: unknown) {
      const isRetryable =
        err instanceof Error &&
        'code' in err &&
        ((err as { code: string }).code === '40P01' || (err as { code: string }).code === 'P2025');
      if (isRetryable && attempt < 5) {
        await new Promise((r) => setTimeout(r, 100 * attempt));
        continue;
      }
      throw err;
    }
  }
}

/**
 * Seed N expense transactions directly via Prisma (fast, no API overhead).
 * Each transaction gets a distinct date for deterministic ordering.
 */
async function seedTransactionsDirect(count: number, namePrefix = 'TXN') {
  const acct = await prisma.account.create({
    data: { name: `ACCT_${Date.now()}`, type: 'CHECKING' },
  });
  const baseDate = new Date('2026-01-01T00:00:00.000Z');
  const data = [];
  for (let i = 0; i < count; i++) {
    data.push({
      type: 'EXPENSE' as const,
      name: `${namePrefix}_${i}`,
      amount: (i + 1) * 10,
      date: new Date(baseDate.getTime() + i * 86_400_000),
      accountId: acct.id,
    });
  }
  await prisma.transaction.createMany({ data });
  return acct;
}

interface PaginatedResponse {
  transactions: Array<{
    id: string;
    type: string;
    name: string;
    amount: number;
    date: string;
    payPeriodId: string | null;
    expenseId: string | null;
    incomeId: string | null;
    accountId: string;
    toAccountId: string | null;
    budgetId: string | null;
    note: string | null;
    createdAt: string;
  }>;
  totalCount: number;
  nextCursor: string | null;
  hasMore: boolean;
  anticipations?: unknown[];
}

/** Paginate through all pages and collect every transaction. */
async function paginateAll(
  limit: number,
  extraParams = '',
): Promise<{
  allTransactions: PaginatedResponse['transactions'];
  pages: PaginatedResponse[];
}> {
  const allTransactions: PaginatedResponse['transactions'] = [];
  const pages: PaginatedResponse[] = [];
  let cursor: string | null = null;
  let safety = 0;

  do {
    const params = new URLSearchParams();
    params.set('limit', String(limit));
    params.set('skipGenerate', 'true');
    if (cursor) params.set('cursor', cursor);
    if (extraParams) {
      const extra = new URLSearchParams(extraParams);
      for (const [k, v] of extra) params.set(k, v);
    }

    const res = await get(`/transactions?${params.toString()}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as PaginatedResponse;
    pages.push(body);
    allTransactions.push(...body.transactions);
    cursor = body.nextCursor;

    if (!body.hasMore) break;
    safety++;
  } while (safety < 1000);

  return { allTransactions, pages };
}

// ─── Property 1: Pagination completeness ───

describe('Feature: lazy-load-transactions, Property 1: Pagination completeness', () => {
  it('paginating through all pages returns every record in correct order with no duplicates', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 5, max: 50 }), // total transactions to seed
        fc.integer({ min: 1, max: 15 }), // page size
        async (totalSeed, pageSize) => {
          await truncateIteration();
          const acct = await seedTransactionsDirect(totalSeed);

          const { allTransactions, pages } = await paginateAll(pageSize, `accountId=${acct.id}`);

          // Total records returned equals totalCount from first page
          const expectedTotal = pages[0]!.totalCount;
          expect(allTransactions.length).toBe(expectedTotal);
          expect(allTransactions.length).toBe(totalSeed);

          // No duplicate IDs
          const ids = allTransactions.map((t) => t.id);
          expect(new Set(ids).size).toBe(ids.length);

          // Verify date DESC, createdAt DESC ordering
          for (let i = 1; i < allTransactions.length; i++) {
            const prev = allTransactions[i - 1]!;
            const curr = allTransactions[i]!;
            const prevDate = new Date(prev.date).getTime();
            const currDate = new Date(curr.date).getTime();
            if (prevDate === currDate) {
              expect(new Date(prev.createdAt).getTime()).toBeGreaterThanOrEqual(
                new Date(curr.createdAt).getTime(),
              );
            } else {
              expect(prevDate).toBeGreaterThan(currDate);
            }
          }

          // totalCount is consistent across all pages
          for (const page of pages) {
            expect(page.totalCount).toBe(expectedTotal);
          }
        },
      ),
      { numRuns: 20 },
    );
  }, 120_000);
});

// ─── Property 2: hasMore invariant ───

describe('Feature: lazy-load-transactions, Property 2: hasMore invariant', () => {
  it('hasMore is false when returned count < limit, and true means more exist', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 40 }), // total transactions
        fc.integer({ min: 1, max: 50 }), // page size
        async (totalSeed, pageSize) => {
          await truncateIteration();
          const acct = await seedTransactionsDirect(totalSeed);

          const { pages } = await paginateAll(pageSize, `accountId=${acct.id}`);

          for (let i = 0; i < pages.length; i++) {
            const page = pages[i]!;

            if (page.transactions.length < pageSize) {
              // If we got fewer than limit, hasMore must be false
              expect(page.hasMore).toBe(false);
            }

            if (!page.hasMore) {
              // This should be the last page
              expect(i).toBe(pages.length - 1);

              // If nextCursor is provided on a !hasMore page, fetching should yield 0
              if (page.nextCursor) {
                const params = new URLSearchParams({
                  limit: String(pageSize),
                  cursor: page.nextCursor,
                  skipGenerate: 'true',
                  accountId: acct.id,
                });
                const followup = await get(`/transactions?${params.toString()}`);
                const followupBody = (await followup.json()) as PaginatedResponse;
                expect(followupBody.transactions.length).toBe(0);
              }
            }

            if (page.hasMore) {
              // There must be at least one more page
              expect(i).toBeLessThan(pages.length - 1);
            }
          }
        },
      ),
      { numRuns: 20 },
    );
  }, 120_000);
});

// ─── Property 3: Invalid cursor error ───

describe('Feature: lazy-load-transactions, Property 3: Invalid cursor error', () => {
  it('returns 400 for non-existent cursor IDs', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 40 }).filter(
          // Filter out empty and strings that could plausibly be real CUIDs
          (s) => s.length > 0 && !s.includes('\x00'),
        ),
        async (fakeCursor) => {
          // Verify it doesn't match any existing transaction
          const existing = await prisma.transaction.findUnique({
            where: { id: fakeCursor },
            select: { id: true },
          });
          if (existing) return; // Skip if by chance it matches

          const params = new URLSearchParams({
            limit: '10',
            cursor: fakeCursor,
            skipGenerate: 'true',
          });
          const res = await get(`/transactions?${params.toString()}`);
          expect(res.status).toBe(400);
          const body = (await res.json()) as { error: string };
          expect(body.error).toBe('Invalid cursor: transaction not found');
        },
      ),
      { numRuns: 20 },
    );
  }, 60_000);
});

// ─── Property 4: Response structure completeness ───

describe('Feature: lazy-load-transactions, Property 4: Response structure completeness', () => {
  it('every response has the required top-level fields and transaction shape', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 20 }), // total transactions (including 0)
        fc.integer({ min: 1, max: 50 }), // page size
        async (totalSeed, pageSize) => {
          await truncateIteration();
          let acctId: string | undefined;
          if (totalSeed > 0) {
            const acct = await seedTransactionsDirect(totalSeed);
            acctId = acct.id;
          }

          const params = new URLSearchParams({
            limit: String(pageSize),
            skipGenerate: 'true',
          });
          if (acctId) params.set('accountId', acctId);

          const res = await get(`/transactions?${params.toString()}`);
          expect(res.status).toBe(200);
          const body = (await res.json()) as Record<string, unknown>;

          // Top-level fields
          expect(Array.isArray(body.transactions)).toBe(true);
          expect(typeof body.totalCount).toBe('number');
          expect(body.totalCount as number).toBeGreaterThanOrEqual(0);
          expect(body.nextCursor === null || typeof body.nextCursor === 'string').toBe(true);
          expect(typeof body.hasMore).toBe('boolean');

          // Each transaction has required fields
          const txns = body.transactions as Array<Record<string, unknown>>;
          for (const tx of txns) {
            expect(typeof tx.id).toBe('string');
            expect(typeof tx.type).toBe('string');
            expect(typeof tx.name).toBe('string');
            expect(typeof tx.amount).toBe('number');
            expect(tx.date).toBeDefined();
            // Nullable fields — must be present (even if null)
            expect('payPeriodId' in tx).toBe(true);
            expect('expenseId' in tx).toBe(true);
            expect('incomeId' in tx).toBe(true);
            expect(typeof tx.accountId).toBe('string');
            expect('toAccountId' in tx).toBe(true);
            expect('budgetId' in tx).toBe(true);
            expect('note' in tx).toBe(true);
            expect(tx.createdAt).toBeDefined();
          }
        },
      ),
      { numRuns: 20 },
    );
  }, 120_000);
});

// ─── Property 6: Server-side search consistency ───

describe('Feature: lazy-load-transactions, Property 6: Server-side search consistency', () => {
  it('search results contain only matching names and totalCount matches DB count', async () => {
    const NAMES = [
      'Mortgage Payment',
      'Grocery Store',
      'Netflix Subscription',
      'Gas Station',
      'Electric Bill',
    ];

    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 3, max: 20 }), // how many transactions to seed
        fc.integer({ min: 0, max: 4 }), // which name pattern to search for
        async (count, nameIdx) => {
          await truncateIteration();
          const acct = await prisma.account.create({
            data: { name: `ACCT_${Date.now()}`, type: 'CHECKING' },
          });
          const baseDate = new Date('2026-01-01T00:00:00.000Z');

          // Seed transactions with names from the fixed set
          const seededNames: string[] = [];
          const data = [];
          for (let i = 0; i < count; i++) {
            const name = NAMES[i % NAMES.length]!;
            seededNames.push(name);
            data.push({
              type: 'EXPENSE' as const,
              name,
              amount: (i + 1) * 10,
              date: new Date(baseDate.getTime() + i * 86_400_000),
              accountId: acct.id,
            });
          }
          await prisma.transaction.createMany({ data });

          // Pick a search term (a word from one of the names)
          const searchTarget = NAMES[nameIdx]!;
          const searchWord = searchTarget.split(' ')[0]!;

          const params = new URLSearchParams({
            limit: '500',
            skipGenerate: 'true',
            search: searchWord,
            accountId: acct.id,
          });

          const res = await get(`/transactions?${params.toString()}`);
          expect(res.status).toBe(200);
          const body = (await res.json()) as PaginatedResponse;

          // All returned transactions must contain the search string (case-insensitive)
          for (const tx of body.transactions) {
            expect(tx.name.toLowerCase()).toContain(searchWord.toLowerCase());
          }

          // totalCount must equal the number of matching transactions we seeded
          const expectedCount = seededNames.filter((n) =>
            n.toLowerCase().includes(searchWord.toLowerCase()),
          ).length;
          expect(body.totalCount).toBe(expectedCount);
          expect(body.transactions.length).toBe(expectedCount);
        },
      ),
      { numRuns: 20 },
    );
  }, 120_000);
});
