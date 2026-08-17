/**
 * API helpers for E2E tests — direct HTTP calls to the test API.
 *
 * Used for test setup/teardown (creating prerequisite data, cleaning up).
 * Always runs against the test API at localhost:3009.
 */

const API_BASE = 'http://localhost:3009/api/v1';
const AUTH = { Authorization: 'Bearer budget-tracker-dev-key' };

/** POST JSON to the API and return the parsed response. */
export async function apiPost(path: string, body: Record<string, unknown>) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { ...AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

/** GET from the API and return the parsed response. */
export async function apiGet(path: string) {
  const res = await fetch(`${API_BASE}${path}`, { headers: AUTH });
  return { status: res.status, data: await res.json() };
}

/** DELETE via the API. */
export async function apiDelete(path: string) {
  const res = await fetch(`${API_BASE}${path}`, { method: 'DELETE', headers: AUTH });
  return { status: res.status };
}

/** PATCH JSON to the API and return the parsed response. */
export async function apiPatch(path: string, body: Record<string, unknown>) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'PATCH',
    headers: { ...AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}
