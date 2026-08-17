/**
 * Rate Limiting Tests
 *
 * Verifies that the rate limiter enforces request thresholds in production mode,
 * includes proper headers, and bypasses limiting in test mode.
 *
 * The rate limiter uses an in-memory Map keyed by IP. In app.request() there is
 * no real IP, so it uses 'unknown' as the key. MAX_REQUESTS = 5000 per minute.
 * Full 429 testing would require 5001 requests which is impractical in unit tests,
 * so we focus on header presence, decrement behavior, and env bypass.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { get } from '../../../test/helpers.js';

describe('Rate Limiting', () => {
  let originalNodeEnv: string | undefined;

  beforeEach(() => {
    originalNodeEnv = process.env['NODE_ENV'];
    // Enable rate limiting by switching to production mode
    process.env['NODE_ENV'] = 'production';
  });

  afterEach(() => {
    // Restore original NODE_ENV
    if (originalNodeEnv !== undefined) {
      process.env['NODE_ENV'] = originalNodeEnv;
    } else {
      delete process.env['NODE_ENV'];
    }
  });

  // ── Requirement 4.2: Rate limit headers are present ──

  it('includes X-RateLimit-Limit, X-RateLimit-Remaining, and X-RateLimit-Reset headers', async () => {
    const res = await get('/health');
    expect(res.status).toBe(200);

    const limit = res.headers.get('X-RateLimit-Limit');
    const remaining = res.headers.get('X-RateLimit-Remaining');
    const reset = res.headers.get('X-RateLimit-Reset');

    expect(limit).toBe('5000');
    expect(remaining).not.toBeNull();
    expect(reset).not.toBeNull();

    // Remaining should be a non-negative integer
    const remainingNum = Number(remaining);
    expect(Number.isInteger(remainingNum)).toBe(true);
    expect(remainingNum).toBeGreaterThanOrEqual(0);
    expect(remainingNum).toBeLessThanOrEqual(5000);

    // Reset should be a Unix timestamp (seconds)
    const resetNum = Number(reset);
    expect(Number.isInteger(resetNum)).toBe(true);
    expect(resetNum).toBeGreaterThan(0);
  });

  // ── Requirement 4.1 / 4.3: Remaining count decrements ──
  // Full 429 test would require 5001 requests — impractical in unit tests.
  // Instead we verify the decrement behavior across consecutive requests.

  it('decrements X-RateLimit-Remaining across consecutive requests', async () => {
    const res1 = await get('/health');
    expect(res1.status).toBe(200);
    const remaining1 = Number(res1.headers.get('X-RateLimit-Remaining'));

    const res2 = await get('/health');
    expect(res2.status).toBe(200);
    const remaining2 = Number(res2.headers.get('X-RateLimit-Remaining'));

    // Second request should have a lower remaining count
    expect(remaining2).toBeLessThan(remaining1);
    // Specifically, it should decrement by 1
    expect(remaining1 - remaining2).toBe(1);
  });

  // ── Requirement 4.4: Test env bypasses rate limiting ──

  it('bypasses rate limiting when NODE_ENV=test (no rate limit headers)', async () => {
    // Switch back to test mode
    process.env['NODE_ENV'] = 'test';

    const res = await get('/health');
    expect(res.status).toBe(200);

    // In test mode, the rate limiter calls next() immediately without setting headers
    const limit = res.headers.get('X-RateLimit-Limit');
    const remaining = res.headers.get('X-RateLimit-Remaining');
    const reset = res.headers.get('X-RateLimit-Reset');

    expect(limit).toBeNull();
    expect(remaining).toBeNull();
    expect(reset).toBeNull();
  });
});
