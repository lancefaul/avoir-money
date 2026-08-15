import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { budgetItemsApi } from './budget-items.js';

const mockBudgetItem = {
  id: 'b1',
  name: 'Groceries',
  groupId: 'g1',
  icon: null,
  isCustom: false,
  isSystem: false,
  createdAt: '2024-01-01T00:00:00.000Z',
};

const mockGroup = {
  id: 'g1',
  name: 'Essentials',
  color: '#94a3b8',
  createdAt: '2024-01-01T00:00:00.000Z',
};

describe('budgetItemsApi', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('list()', () => {
    it('calls GET /api/v1/budgets', async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        new Response(JSON.stringify([mockBudgetItem]), { status: 200 }),
      );

      await budgetItemsApi.list();

      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/budgets',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: expect.stringMatching(/^Bearer /),
          }),
        }),
      );
    });
  });

  describe('groups()', () => {
    it('calls GET /api/v1/budgets/groups', async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        new Response(JSON.stringify([mockGroup]), { status: 200 }),
      );

      await budgetItemsApi.groups();

      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/budgets/groups',
        expect.objectContaining({
          headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        }),
      );
    });
  });

  describe('createGroup()', () => {
    it('calls POST /api/v1/budgets/groups with body', async () => {
      const body = { name: 'New Group', color: '#ff0000' };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        new Response(
          JSON.stringify({ ...mockGroup, id: 'g2', name: 'New Group', color: '#ff0000' }),
          { status: 201 },
        ),
      );

      await budgetItemsApi.createGroup(body);

      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/budgets/groups',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(body),
        }),
      );
    });
  });

  describe('updateGroup()', () => {
    it('calls PUT /api/v1/budgets/groups/:id with body', async () => {
      const body = { name: 'Updated Group' };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        new Response(JSON.stringify({ ...mockGroup, name: 'Updated Group' }), { status: 200 }),
      );

      await budgetItemsApi.updateGroup('g1', body);

      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/budgets/groups/g1',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify(body),
        }),
      );
    });
  });

  describe('deleteGroup()', () => {
    it('calls DELETE /api/v1/budgets/groups/:id', async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        new Response(JSON.stringify({ deleted: true }), { status: 200 }),
      );

      await budgetItemsApi.deleteGroup('g1');

      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/budgets/groups/g1',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });

  describe('create()', () => {
    it('calls POST /api/v1/budgets with body', async () => {
      const body = { name: 'Dining', groupId: 'g1' };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        new Response(JSON.stringify({ ...mockBudgetItem, id: 'b2', name: 'Dining' }), {
          status: 201,
        }),
      );

      await budgetItemsApi.create(body);

      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/budgets',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(body),
        }),
      );
    });
  });

  describe('update()', () => {
    it('calls PUT /api/v1/budgets/:id with body', async () => {
      const body = { name: 'Dining Out' };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        new Response(JSON.stringify({ ...mockBudgetItem, id: 'b2', name: 'Dining Out' }), {
          status: 200,
        }),
      );

      await budgetItemsApi.update('b2', body);

      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/budgets/b2',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify(body),
        }),
      );
    });
  });

  describe('delete()', () => {
    it('calls DELETE /api/v1/budgets/:id?mode=hard by default', async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        new Response(JSON.stringify({ deleted: true }), { status: 200 }),
      );

      await budgetItemsApi.delete('b1');

      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/budgets/b1?mode=hard',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });

    it('calls DELETE /api/v1/budgets/:id?mode=soft when mode is soft', async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        new Response(JSON.stringify({ softDeleted: true }), { status: 200 }),
      );

      await budgetItemsApi.delete('b1', 'soft');

      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/budgets/b1?mode=soft',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });

  describe('reassign()', () => {
    it('calls POST /api/v1/budgets/:id/reassign with targetBudgetId', async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        new Response(JSON.stringify({ reassigned: 5, budgetsDeleted: 1, deleted: true }), {
          status: 200,
        }),
      );

      await budgetItemsApi.reassign('b1', 'b2');

      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/budgets/b1/reassign',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ targetBudgetId: 'b2' }),
        }),
      );
    });
  });
});
