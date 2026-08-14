/**
 * Unit tests for archive/restore error conditions on expenses and income.
 * Feature: archive-recurring
 *
 * Tests run against the test database (port 5433).
 * Covers: 404 on nonexistent ID, 409 on duplicate archive, 409 on restore of
 * non-archived, and 409 on DELETE of archived.
 *
 * Requirements: 1.4, 1.5, 2.3, 2.4, 5.4, 6.2
 */
import { describe, it, expect } from 'vitest';
import {
  post,
  del,
  createGroup,
  createCategory,
  createExpense,
  createIncome,
} from '../test/helpers.js';

async function setupBase() {
  const group = await createGroup();
  const cat = await createCategory(group.id);
  return { cat };
}

// ─── Expense archive/restore error cases ───────────────────────────────────

describe('Expense archive/restore error cases', () => {
  it('returns 404 when archiving a nonexistent expense', async () => {
    const res = await post('/expenses/nonexistent-id/archive', {});
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof body.error).toBe('string');
  });

  it('returns 409 when archiving an already-archived expense', async () => {
    const { cat } = await setupBase();
    const expense = await createExpense(cat.id);

    // Archive once — should succeed
    const firstRes = await post(`/expenses/${expense.id}/archive`, {});
    expect(firstRes.status).toBe(200);

    // Archive again — should conflict
    const secondRes = await post(`/expenses/${expense.id}/archive`, {});
    expect(secondRes.status).toBe(409);
    const body = (await secondRes.json()) as Record<string, unknown>;
    expect(typeof body.error).toBe('string');
  });

  it('returns 404 when restoring a nonexistent expense', async () => {
    const res = await post('/expenses/nonexistent-id/restore', {});
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof body.error).toBe('string');
  });

  it('returns 409 when restoring a non-archived expense', async () => {
    const { cat } = await setupBase();
    const expense = await createExpense(cat.id);

    // Attempt restore on an active (non-archived) expense
    const res = await post(`/expenses/${expense.id}/restore`, {});
    expect(res.status).toBe(409);
    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof body.error).toBe('string');
  });

  it('returns 409 when deleting an archived expense', async () => {
    const { cat } = await setupBase();
    const expense = await createExpense(cat.id);

    // Archive the expense
    const archiveRes = await post(`/expenses/${expense.id}/archive`, {});
    expect(archiveRes.status).toBe(200);

    // Attempt DELETE — must be rejected with 409
    const deleteRes = await del(`/expenses/${expense.id}`);
    expect(deleteRes.status).toBe(409);
    const body = (await deleteRes.json()) as Record<string, unknown>;
    expect(typeof body.error).toBe('string');
  });
});

// ─── Income archive/restore error cases ────────────────────────────────────

describe('Income archive/restore error cases', () => {
  it('returns 404 when archiving a nonexistent income', async () => {
    const res = await post('/income/nonexistent-id/archive', {});
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof body.error).toBe('string');
  });

  it('returns 409 when archiving an already-archived income', async () => {
    const { cat } = await setupBase();
    const income = await createIncome(cat.id);

    // Archive once — should succeed
    const firstRes = await post(`/income/${income.id}/archive`, {});
    expect(firstRes.status).toBe(200);

    // Archive again — should conflict
    const secondRes = await post(`/income/${income.id}/archive`, {});
    expect(secondRes.status).toBe(409);
    const body = (await secondRes.json()) as Record<string, unknown>;
    expect(typeof body.error).toBe('string');
  });

  it('returns 404 when restoring a nonexistent income', async () => {
    const res = await post('/income/nonexistent-id/restore', {});
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof body.error).toBe('string');
  });

  it('returns 409 when restoring a non-archived income', async () => {
    const { cat } = await setupBase();
    const income = await createIncome(cat.id);

    // Attempt restore on an active (non-archived) income
    const res = await post(`/income/${income.id}/restore`, {});
    expect(res.status).toBe(409);
    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof body.error).toBe('string');
  });

  it('returns 409 when deleting an archived income', async () => {
    const { cat } = await setupBase();
    const income = await createIncome(cat.id);

    // Archive the income
    const archiveRes = await post(`/income/${income.id}/archive`, {});
    expect(archiveRes.status).toBe(200);

    // Attempt DELETE — must be rejected with 409
    const deleteRes = await del(`/income/${income.id}`);
    expect(deleteRes.status).toBe(409);
    const body = (await deleteRes.json()) as Record<string, unknown>;
    expect(typeof body.error).toBe('string');
  });
});
