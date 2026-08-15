/**
 * Security test helpers — unauthenticated request helpers that complement
 * the authenticated helpers in `apps/api/src/test/helpers.ts`.
 */
import app from '../../../app.js';

const BASE = '/api/v1';

/**
 * Send a raw request to the Hono app WITHOUT the Authorization header.
 * Useful for testing auth bypass and unauthenticated access.
 */
export async function rawRequest(
  method: string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return app.request(`${BASE}${path}`, {
    method,
    ...init,
  });
}

/**
 * Convenience wrapper for unauthenticated POST requests with a JSON body.
 */
export async function rawPost(path: string, body: unknown): Promise<Response> {
  return rawRequest('POST', path, {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * Convenience wrapper for unauthenticated GET requests.
 */
export async function rawGet(path: string): Promise<Response> {
  return rawRequest('GET', path);
}
