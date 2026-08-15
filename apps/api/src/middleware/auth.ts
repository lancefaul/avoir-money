import type { MiddlewareHandler } from 'hono';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * The only endpoint allowed to authenticate via a `?key=` query param: the
 * backup file download. It is reached by a plain browser navigation (an
 * `<a href>` / `window.open`), which cannot set an `Authorization` header, so
 * the key has to ride in the URL. Every other endpoint is called via fetch and
 * must use the header — a URL-borne key leaks into server logs, browser
 * history, and Referer headers.
 */
const QUERY_KEY_ALLOWED = /^\/api\/v1\/backups\/[^/]+\/download$/;

/**
 * Per-process random key used only to blind the length of the compared values.
 * Never leaves the process; a fresh one each boot is fine.
 */
const HMAC_BLIND_KEY = randomBytes(32);

/**
 * Constant-time string comparison. HMAC both operands to a fixed 32-byte digest
 * first, so `timingSafeEqual` never sees unequal lengths (it throws on those)
 * and the comparison leaks neither the key's length nor how many chars matched.
 */
function safeEqual(a: string, b: string): boolean {
  const da = createHmac('sha256', HMAC_BLIND_KEY).update(a).digest();
  const db = createHmac('sha256', HMAC_BLIND_KEY).update(b).digest();
  return timingSafeEqual(da, db);
}

/**
 * Bearer-token auth middleware.
 * Checks `Authorization: Bearer <key>` against the API_KEY env var.
 * Skips auth for health-check and (in dev) the OpenAPI spec endpoint.
 */
export const authMiddleware: MiddlewareHandler = async (c, next) => {
  const path = c.req.path;

  // Public endpoints — no auth required
  if (path === '/api/v1/health') return next();
  // The OpenAPI spec is a dev convenience; never expose the full API surface in
  // production, where it would be an information-disclosure aid to an attacker.
  if (path === '/api/v1/openapi.json' && process.env['NODE_ENV'] !== 'production') {
    return next();
  }

  const apiKey = process.env['API_KEY'];
  if (!apiKey) {
    console.error('API_KEY environment variable is not set');
    return c.json({ error: 'Internal server error' }, 500);
  }

  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    // Query-param auth is accepted ONLY for the backup download route (see above).
    if (QUERY_KEY_ALLOWED.test(path)) {
      const queryKey = new URL(c.req.url).searchParams.get('key');
      if (queryKey && safeEqual(queryKey, apiKey)) {
        return next();
      }
    }
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const token = authHeader.slice(7);
  if (!safeEqual(token, apiKey)) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  return next();
};
