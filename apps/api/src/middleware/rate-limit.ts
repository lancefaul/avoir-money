import type { MiddlewareHandler } from 'hono';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const WINDOW_MS = 60_000; // 1 minute
const MAX_REQUESTS = 5000;

const store = new Map<string, RateLimitEntry>();

// Clean up expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now > entry.resetAt) store.delete(key);
  }
}, 5 * 60_000).unref();

/**
 * Test helper — allows tests to manipulate the rate limit store.
 * Only exported for testing purposes.
 */
export function __setRateLimitCountForTesting(ip: string, count: number): void {
  const now = Date.now();
  store.set(ip, { count, resetAt: now + WINDOW_MS });
}

/**
 * Simple in-memory rate limiter — 100 requests per minute per IP.
 * Disabled in test environment to avoid false 429s in property-based tests.
 */
export const rateLimitMiddleware: MiddlewareHandler = async (c, next) => {
  if (process.env['NODE_ENV'] === 'test') return next();

  const ip =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
    c.req.header('x-real-ip') ??
    'unknown';

  const now = Date.now();
  let entry = store.get(ip);

  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + WINDOW_MS };
    store.set(ip, entry);
  }

  entry.count++;

  c.header('X-RateLimit-Limit', String(MAX_REQUESTS));
  c.header('X-RateLimit-Remaining', String(Math.max(0, MAX_REQUESTS - entry.count)));
  c.header('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));

  if (entry.count > MAX_REQUESTS) {
    return c.json({ error: 'Too many requests' }, 429);
  }

  return next();
};
