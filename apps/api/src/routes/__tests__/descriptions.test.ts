import { describe, it, expect } from 'vitest';
import { prisma } from '@budget-tracker/db';
import { get, post, put, del, createAccount, createTransaction } from '../../test/helpers.js';

interface Description {
  id: string;
  name: string;
}

interface ErrorBody {
  error: string;
}

describe('Descriptions API', () => {
  // ─── GET / ───

  describe('GET /descriptions', () => {
    it('returns empty array when no descriptions exist', async () => {
      const res = await get('/descriptions');
      expect(res.status).toBe(200);
      const body = (await res.json()) as Description[];
      expect(body).toEqual([]);
    });

    it('returns all descriptions sorted by name', async () => {
      await prisma.transactionDescription.createMany({
        data: [{ name: 'Walmart' }, { name: 'Amazon' }, { name: 'Target' }],
      });

      const res = await get('/descriptions');
      expect(res.status).toBe(200);
      const body = (await res.json()) as Description[];
      expect(body).toHaveLength(3);
      expect(body[0]!.name).toBe('Amazon');
      expect(body[1]!.name).toBe('Target');
      expect(body[2]!.name).toBe('Walmart');
    });

    it('filters by search query (case-insensitive)', async () => {
      await prisma.transactionDescription.createMany({
        data: [{ name: 'Walmart' }, { name: 'Amazon' }, { name: 'Walgreens' }],
      });

      const res = await get('/descriptions?search=wal');
      expect(res.status).toBe(200);
      const body = (await res.json()) as Description[];
      expect(body).toHaveLength(2);
      expect(body.map((d) => d.name).sort()).toEqual(['Walgreens', 'Walmart']);
    });
  });

  // ─── POST / ───

  describe('POST /descriptions', () => {
    it('creates a new description', async () => {
      const res = await post('/descriptions', { name: 'Costco' });
      expect(res.status).toBe(201);
      const body = (await res.json()) as Description;
      expect(body.name).toBe('Costco');
      expect(body.id).toBeDefined();

      // Verify in DB
      const record = await prisma.transactionDescription.findUnique({ where: { id: body.id } });
      expect(record).not.toBeNull();
      expect(record!.name).toBe('Costco');
    });

    it('rejects duplicate names (case-insensitive)', async () => {
      await prisma.transactionDescription.create({ data: { name: 'Costco' } });

      const res = await post('/descriptions', { name: 'costco' });
      expect(res.status).toBe(409);
      const body = (await res.json()) as ErrorBody;
      expect(body.error).toContain('already exists');
    });

    it('rejects empty name', async () => {
      const res = await post('/descriptions', { name: '' });
      expect(res.status).toBe(400);
    });
  });

  // ─── PUT /:id ───

  describe('PUT /descriptions/:id', () => {
    it('renames a description and updates linked transactions', async () => {
      const desc = await prisma.transactionDescription.create({ data: { name: 'Old Name' } });
      const acct = await createAccount();
      await createTransaction(acct.id, { name: 'Old Name', descriptionId: desc.id });

      const res = await put(`/descriptions/${desc.id}`, { name: 'New Name' });
      expect(res.status).toBe(200);
      const body = (await res.json()) as Description;
      expect(body.name).toBe('New Name');

      // Verify transaction name was updated
      const txns = await prisma.transaction.findMany({ where: { descriptionId: desc.id } });
      expect(txns).toHaveLength(1);
      expect(txns[0]!.name).toBe('New Name');
    });

    it('returns 404 for non-existent description', async () => {
      const res = await put('/descriptions/nonexistent', { name: 'Test' });
      expect(res.status).toBe(404);
    });

    it('rejects rename to existing name (case-insensitive)', async () => {
      await prisma.transactionDescription.create({ data: { name: 'Existing' } });
      const desc = await prisma.transactionDescription.create({ data: { name: 'Other' } });

      const res = await put(`/descriptions/${desc.id}`, { name: 'existing' });
      expect(res.status).toBe(409);
    });
  });

  // ─── POST /:id/merge ───

  describe('POST /descriptions/:id/merge', () => {
    it('merges source description into target', async () => {
      const target = await prisma.transactionDescription.create({ data: { name: 'Target Desc' } });
      const source = await prisma.transactionDescription.create({ data: { name: 'Source Desc' } });
      const acct = await createAccount();
      await createTransaction(acct.id, { name: 'Source Desc', descriptionId: source.id });
      await createTransaction(acct.id, { name: 'Source Desc', descriptionId: source.id });

      const res = await post(`/descriptions/${target.id}/merge`, { mergeId: source.id });
      expect(res.status).toBe(200);
      const body = (await res.json()) as Description;
      expect(body.id).toBe(target.id);
      expect(body.name).toBe('Target Desc');

      // Verify transactions were reassigned
      const txns = await prisma.transaction.findMany({ where: { descriptionId: target.id } });
      expect(txns).toHaveLength(2);
      expect(txns[0]!.name).toBe('Target Desc');

      // Verify source was deleted
      const deleted = await prisma.transactionDescription.findUnique({ where: { id: source.id } });
      expect(deleted).toBeNull();
    });

    it('returns 404 when target does not exist', async () => {
      const source = await prisma.transactionDescription.create({ data: { name: 'Source' } });
      const res = await post('/descriptions/nonexistent/merge', { mergeId: source.id });
      expect(res.status).toBe(404);
    });

    it('returns 404 when source does not exist', async () => {
      const target = await prisma.transactionDescription.create({ data: { name: 'Target' } });
      const res = await post(`/descriptions/${target.id}/merge`, { mergeId: 'nonexistent' });
      expect(res.status).toBe(404);
    });

    it('returns 400 when merging into itself', async () => {
      const desc = await prisma.transactionDescription.create({ data: { name: 'Self' } });
      const res = await post(`/descriptions/${desc.id}/merge`, { mergeId: desc.id });
      expect(res.status).toBe(400);
    });
  });

  // ─── DELETE /:id ───

  describe('DELETE /descriptions/:id', () => {
    it('deletes a description with no linked transactions', async () => {
      const desc = await prisma.transactionDescription.create({ data: { name: 'Unused' } });

      const res = await del(`/descriptions/${desc.id}`);
      expect(res.status).toBe(204);

      // Verify deleted
      const record = await prisma.transactionDescription.findUnique({ where: { id: desc.id } });
      expect(record).toBeNull();
    });

    it('returns 409 when transactions still reference the description', async () => {
      const desc = await prisma.transactionDescription.create({ data: { name: 'In Use' } });
      const acct = await createAccount();
      await createTransaction(acct.id, { name: 'In Use', descriptionId: desc.id });

      const res = await del(`/descriptions/${desc.id}`);
      expect(res.status).toBe(409);
      const body = (await res.json()) as ErrorBody;
      expect(body.error).toContain('transaction(s) still reference');

      // Verify NOT deleted
      const record = await prisma.transactionDescription.findUnique({ where: { id: desc.id } });
      expect(record).not.toBeNull();
    });

    it('returns 404 for non-existent description', async () => {
      const res = await del('/descriptions/nonexistent');
      expect(res.status).toBe(404);
    });
  });
});
