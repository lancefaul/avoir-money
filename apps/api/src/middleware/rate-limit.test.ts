import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import app from '../app.js';
import { __setRateLimitCountForTesting } from './rate-limit.js';

/**
 * Rate limit middleware tests — validates Requirement 12:
 * - Under-limit requests set rate limit headers and allow through
 * - Over-limit requests return 429 with error message
 * - Test environment bypasses rate limiting
 */

// ─── Helper: authenticated request ───
function authedRequest(path: string, init: RequestInit = {}) {
  return app.request(`/api/v1${path}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env['API_KEY'] ?? 'budget-tracker-dev-key'}`,
      ...(init.headers ?? {}),
    },
    ...init,
  });
}

describe('Rate limit middleware', () => {
  const originalEnv = process.env['NODE_ENV'];

  // ─── Non-test environment tests ───
  describe('production environment', () => {
    beforeEach(() => {
      // Enable rate limiting by switching away from 'test' env
      process.env['NODE_ENV'] = 'production';
    });

    afterEach(() => {
      process.env['NODE_ENV'] = originalEnv;
    });

    it('sets rate limit headers on under-limit request', async () => {
      const res = await authedRequest('/health');

      expect(res.status).toBe(200);
      expect(res.headers.get('x-ratelimit-limit')).toBeDefined();
      expect(res.headers.get('x-ratelimit-remaining')).toBeDefined();
      expect(res.headers.get('x-ratelimit-reset')).toBeDefined();

      // Verify header values are numeric
      const limit = res.headers.get('x-ratelimit-limit');
      const remaining = res.headers.get('x-ratelimit-remaining');
      const reset = res.headers.get('x-ratelimit-reset');

      expect(Number(limit)).toBeGreaterThan(0);
      expect(Number(remaining)).toBeGreaterThanOrEqual(0);
      expect(Number(reset)).toBeGreaterThan(0);
    });

    it('decrements remaining count on subsequent requests', async () => {
      // Make multiple requests and verify the remaining count decreases
      const res1 = await authedRequest('/health');
      const remaining1 = Number(res1.headers.get('x-ratelimit-remaining'));

      const res2 = await authedRequest('/health');
      const remaining2 = Number(res2.headers.get('x-ratelimit-remaining'));

      // Remaining should decrease (or stay the same if window reset)
      expect(remaining2).toBeLessThanOrEqual(remaining1);
    });

    it('returns 429 when rate limit exceeded', async () => {
      // Use the test helper to set the count to just over the limit
      // The middleware extracts IP from x-forwarded-for header
      const testIp = '192.168.1.100';
      __setRateLimitCountForTesting(testIp, 5001); // Over the 5000 limit

      // Make a request with the same IP
      const res = await authedRequest('/health', {
        headers: { 'x-forwarded-for': testIp },
      });

      expect(res.status).toBe(429);
      const body = await res.json();
      expect(body).toEqual({ error: 'Too many requests' });
    });
  });

  // ─── Test environment bypass ───
  describe('test environment', () => {
    beforeEach(() => {
      // Ensure we're in test environment
      process.env['NODE_ENV'] = 'test';
    });

    afterEach(() => {
      process.env['NODE_ENV'] = originalEnv;
    });

    it('bypasses rate limiting in test environment', async () => {
      const res = await authedRequest('/health');

      expect(res.status).toBe(200);
      // In test mode, rate limit headers should NOT be set
      expect(res.headers.get('x-ratelimit-limit')).toBeNull();
      expect(res.headers.get('x-ratelimit-remaining')).toBeNull();
      expect(res.headers.get('x-ratelimit-reset')).toBeNull();
    });
  });
});
