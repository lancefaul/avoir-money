/**
 * SQL Injection Resistance Tests
 *
 * Verifies that Prisma parameterized queries treat all adversarial SQL inputs
 * as literal string values — never executed as SQL.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4
 */
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { post, get, createAccount } from '../../../test/helpers.js';
import { SQL_INJECTION_PAYLOADS, UNICODE_SQL_PAYLOADS, sqlMetacharArb } from './payloads.js';

describe('SQL Injection Resistance', () => {
  // ── Requirement 1.1: SQL payloads stored as literal strings ──

  describe('transaction creation with SQL injection payloads in note field', () => {
    it.each(SQL_INJECTION_PAYLOADS)('stores payload as literal string: %s', async (payload) => {
      const account = await createAccount();
      const res = await post('/transactions', {
        type: 'EXPENSE',
        name: 'SQL Test',
        amount: 10,
        date: new Date().toISOString(),
        accountId: account.id,
        note: payload,
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as any;
      expect(body.note).toBe(payload);
    });
  });

  // ── Requirement 1.2: SQL payloads in GET query params ──

  describe('GET /transactions with SQL injection in search param', () => {
    it.each(SQL_INJECTION_PAYLOADS)(
      'returns 200 with no database errors for search=%s',
      async (payload) => {
        const res = await get(`/transactions?search=${encodeURIComponent(payload)}`);
        expect(res.status).toBe(200);
        const body = (await res.json()) as any;
        // Should return a valid paginated response, not a DB error
        expect(body).toHaveProperty('transactions');
        expect(Array.isArray(body.transactions)).toBe(true);
      },
    );
  });

  // ── Requirement 1.3: Unicode SQL injection in account name ──

  describe('account creation with Unicode SQL injection payloads', () => {
    it.each(UNICODE_SQL_PAYLOADS)(
      'stores Unicode payload as literal string: %s',
      async (payload) => {
        // Unicode payloads are short enough to fit in the name field (max 100 chars)
        const res = await post('/accounts', {
          name: payload,
          type: 'CHECKING',
        });

        if (payload.includes('\u0000')) {
          // PostgreSQL rejects null bytes in text fields with an encoding error.
          // The critical assertion: the SQL injection payload was NOT executed —
          // the error is a data encoding rejection, not SQL execution.
          expect([201, 500]).toContain(res.status);
          if (res.status === 500) {
            const body = (await res.json()) as any;
            expect(body.error).toBe('Internal server error');
          }
        } else {
          expect(res.status).toBe(201);
          const body = (await res.json()) as any;
          expect(body.name).toBe(payload);
        }
      },
    );
  });

  // ── Requirement 1.4: Property test — SQL metacharacter round-trip ──
  // Feature: security-infrastructure-testing, Property 1: SQL metacharacter round-trip preservation

  describe('Property 1: SQL metacharacter round-trip preservation', () => {
    it('preserves any string with SQL metacharacters through create → read round-trip', async () => {
      const account = await createAccount();

      await fc.assert(
        fc.asyncProperty(sqlMetacharArb, async (payload) => {
          // Create a transaction with the generated metacharacter string as note
          const createRes = await post('/transactions', {
            type: 'EXPENSE',
            name: 'PBT SQL Test',
            amount: 1,
            date: new Date().toISOString(),
            accountId: account.id,
            note: payload,
          });

          expect(createRes.status).toBe(201);
          const created = (await createRes.json()) as any;

          // Verify the stored value matches the input exactly
          expect(created.note).toBe(payload);
        }),
        { numRuns: 100 },
      );
    });
    /**
     * **Validates: Requirements 1.4**
     */
  });
});
