import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { invalidateTransactionCaches, TRANSACTION_QUERY_KEYS } from '../cache-invalidation.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Mock QueryClient
// ═══════════════════════════════════════════════════════════════════════════════

function createMockQueryClient() {
  return {
    invalidateQueries: vi.fn(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Property 1: Idempotency — calling twice produces same invalidations as once
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * **Validates: Requirements 8.4**
 *
 * For any number of repeated calls to invalidateTransactionCaches with the same
 * QueryClient, the set of query keys invalidated SHALL be identical on every
 * call. Calling the function N times (N >= 1) produces the same invalidation
 * set as calling it once — the function is idempotent in its effect.
 */
describe('Feature: cache-invalidation, Property 1: Idempotency', () => {
  let qc: ReturnType<typeof createMockQueryClient>;

  beforeEach(() => {
    qc = createMockQueryClient();
  });

  it('calling invalidateTransactionCaches N times produces same keys as calling once', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10 }), (callCount) => {
        qc.invalidateQueries.mockClear();

        // Call once and record the invalidated keys
        invalidateTransactionCaches(qc as any);
        const firstCallArgs = qc.invalidateQueries.mock.calls.map((call) => call[0].queryKey);

        // Reset and call N times
        qc.invalidateQueries.mockClear();
        for (let i = 0; i < callCount; i++) {
          invalidateTransactionCaches(qc as any);
        }

        // Each call should produce the same set of keys
        const totalCalls = qc.invalidateQueries.mock.calls;
        const keysPerCall = TRANSACTION_QUERY_KEYS.length;

        // Total calls should be callCount * keysPerCall
        expect(totalCalls.length).toBe(callCount * keysPerCall);

        // Each batch of keysPerCall calls should match the first call's keys
        for (let batch = 0; batch < callCount; batch++) {
          const batchArgs = totalCalls
            .slice(batch * keysPerCall, (batch + 1) * keysPerCall)
            .map((call) => call[0].queryKey);
          expect(batchArgs).toEqual(firstCallArgs);
        }
      }),
      { numRuns: 20 },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Property 2: No duplicate query keys in the invalidation list
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * **Validates: Requirements 7.1, 8.4**
 *
 * When invalidateTransactionCaches is called, the set of query keys passed to
 * invalidateQueries SHALL contain no duplicates. Each query key is invalidated
 * exactly once per invocation.
 */
describe('Feature: cache-invalidation, Property 2: No duplicate query keys', () => {
  it('TRANSACTION_QUERY_KEYS contains no duplicates', () => {
    const unique = new Set(TRANSACTION_QUERY_KEYS);
    expect(unique.size).toBe(TRANSACTION_QUERY_KEYS.length);
  });

  it('each invocation invalidates each key exactly once', () => {
    fc.assert(
      fc.property(
        fc.constant(null), // No variable input needed — property of the function itself
        () => {
          const qc = createMockQueryClient();
          invalidateTransactionCaches(qc as any);

          const invalidatedKeys = qc.invalidateQueries.mock.calls.map(
            (call) => call[0].queryKey[0],
          );

          // No duplicates in the invalidated keys
          const uniqueKeys = new Set(invalidatedKeys);
          expect(uniqueKeys.size).toBe(invalidatedKeys.length);

          // Every key from TRANSACTION_QUERY_KEYS is present
          for (const key of TRANSACTION_QUERY_KEYS) {
            expect(invalidatedKeys).toContain(key);
          }

          // No extra keys beyond TRANSACTION_QUERY_KEYS
          expect(invalidatedKeys.length).toBe(TRANSACTION_QUERY_KEYS.length);
        },
      ),
      { numRuns: 20 },
    );
  });
});
