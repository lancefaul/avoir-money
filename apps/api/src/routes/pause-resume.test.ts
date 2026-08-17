/**
 * Unit tests for pause/resume error cases and edge cases.
 * Tests run against the test database (port 5433).
 */
import { describe, it, expect } from 'vitest';
import { post, createGroup, createCategory, createIncome, createExpense } from '../test/helpers.js';

async function setupBase() {
  const group = await createGroup();
  const cat = await createCategory(group.id);
  return { group, cat };
}

// ─── Income pause/resume error cases ───

describe('Income pause/resume error cases', () => {
  it('returns 404 when pausing a nonexistent income', async () => {
    const res = await post('/income/nonexistent-id/pause', { indefinite: true });
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBeDefined();
  });

  it('returns 404 when resuming a nonexistent income', async () => {
    const res = await post('/income/nonexistent-id/resume', { immediately: true });
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBeDefined();
  });

  it('returns 400 when resuming a non-paused income', async () => {
    const { cat } = await setupBase();
    const income = await createIncome(cat.id);

    const res = await post(`/income/${income.id}/resume`, { immediately: true });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toContain('not currently paused');
  });

  it('indefinite pause sets sentinel date (year 9999)', async () => {
    const { cat } = await setupBase();
    const income = await createIncome(cat.id);

    const res = await post(`/income/${income.id}/pause`, { indefinite: true });
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    const pausedUntil = new Date(body.pausedUntil as string);
    expect(pausedUntil.getUTCFullYear()).toBe(9999);
    expect(pausedUntil.getUTCMonth()).toBe(11); // December (0-indexed)
    expect(pausedUntil.getUTCDate()).toBe(31);
  });
});

// ─── Expense pause/resume error cases ───

describe('Expense pause/resume error cases', () => {
  it('returns 404 when pausing a nonexistent expense', async () => {
    const res = await post('/expenses/nonexistent-id/pause', { indefinite: true });
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBeDefined();
  });

  it('returns 404 when resuming a nonexistent expense', async () => {
    const res = await post('/expenses/nonexistent-id/resume', { immediately: true });
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBeDefined();
  });

  it('returns 400 when resuming a non-paused expense', async () => {
    const { cat } = await setupBase();
    const expense = await createExpense(cat.id);

    const res = await post(`/expenses/${expense.id}/resume`, { immediately: true });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toContain('not currently paused');
  });

  it('indefinite pause sets sentinel date (year 9999)', async () => {
    const { cat } = await setupBase();
    const expense = await createExpense(cat.id);

    const res = await post(`/expenses/${expense.id}/pause`, { indefinite: true });
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    const pausedUntil = new Date(body.pausedUntil as string);
    expect(pausedUntil.getUTCFullYear()).toBe(9999);
    expect(pausedUntil.getUTCMonth()).toBe(11);
    expect(pausedUntil.getUTCDate()).toBe(31);
  });
});
