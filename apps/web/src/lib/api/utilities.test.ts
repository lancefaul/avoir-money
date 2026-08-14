import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { utilitiesApi } from './utilities.js';

describe('utilitiesApi', () => {
  const mockProvider = {
    id: 'clxprov1',
    name: 'Electric Co',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };

  const mockService = {
    id: 'clxsvc1',
    providerId: 'clxprov1',
    serviceType: 'ELECTRIC',
    metering: 'METERED',
    expenseId: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };

  const mockReading = {
    id: 'clxread1',
    serviceId: 'clxsvc1',
    billDate: '2024-03-01T00:00:00.000Z',
    dueDate: '2024-03-15T00:00:00.000Z',
    usage: 350,
    cost: 45.5,
    unitCost: 0.13,
    convenienceFee: 2.5,
    convenienceFeeType: 'dollar',
    otherFees: 0,
    details: null,
    createdAt: '2024-01-01T00:00:00.000Z',
  };

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --- Providers ---

  describe('providers', () => {
    it('listProviders — calls GET /api/v1/utilities/providers', async () => {
      (fetch as Mock).mockResolvedValue(
        new Response(JSON.stringify([mockProvider]), { status: 200 }),
      );
      const result = await utilitiesApi.listProviders();
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/utilities/providers',
        expect.objectContaining({
          headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        }),
      );
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe('clxprov1');
    });

    it('createProvider — calls POST /api/v1/utilities/providers with body', async () => {
      (fetch as Mock).mockResolvedValue(
        new Response(JSON.stringify(mockProvider), { status: 201 }),
      );
      const body = { name: 'Electric Co' };
      const result = await utilitiesApi.createProvider(body);
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/utilities/providers',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(body),
        }),
      );
      expect(result.name).toBe('Electric Co');
    });

    it('updateProvider — calls PUT /api/v1/utilities/providers/:id with body', async () => {
      const updated = { ...mockProvider, name: 'Gas Co' };
      (fetch as Mock).mockResolvedValue(new Response(JSON.stringify(updated), { status: 200 }));
      const body = { name: 'Gas Co' };
      const result = await utilitiesApi.updateProvider('clxprov1', body);
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/utilities/providers/clxprov1',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify(body),
        }),
      );
      expect(result.name).toBe('Gas Co');
    });

    it('deleteProvider — calls DELETE /api/v1/utilities/providers/:id', async () => {
      (fetch as Mock).mockResolvedValue(
        new Response(JSON.stringify({ success: true }), { status: 200 }),
      );
      await utilitiesApi.deleteProvider('clxprov1');
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/utilities/providers/clxprov1',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });

  // --- Services ---

  describe('services', () => {
    it('listServices — calls GET /api/v1/utilities/providers/:id/services', async () => {
      (fetch as Mock).mockResolvedValue(
        new Response(JSON.stringify([mockService]), { status: 200 }),
      );
      const result = await utilitiesApi.listServices('clxprov1');
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/utilities/providers/clxprov1/services',
        expect.objectContaining({
          headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        }),
      );
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe('clxsvc1');
    });

    it('createService — calls POST /api/v1/utilities/providers/:id/services with body', async () => {
      (fetch as Mock).mockResolvedValue(new Response(JSON.stringify(mockService), { status: 201 }));
      const body = { serviceType: 'ELECTRIC', metering: 'METERED' };
      const result = await utilitiesApi.createService('clxprov1', body);
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/utilities/providers/clxprov1/services',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(body),
        }),
      );
      expect(result.serviceType).toBe('ELECTRIC');
    });

    it('updateService — calls PUT /api/v1/utilities/services/:id with body', async () => {
      const updated = { ...mockService, metering: 'UNMETERED' };
      (fetch as Mock).mockResolvedValue(new Response(JSON.stringify(updated), { status: 200 }));
      const body = { metering: 'UNMETERED' };
      const result = await utilitiesApi.updateService('clxsvc1', body);
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/utilities/services/clxsvc1',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify(body),
        }),
      );
      expect(result.metering).toBe('UNMETERED');
    });

    it('deleteService — calls DELETE /api/v1/utilities/services/:id', async () => {
      (fetch as Mock).mockResolvedValue(
        new Response(JSON.stringify({ success: true }), { status: 200 }),
      );
      await utilitiesApi.deleteService('clxsvc1');
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/utilities/services/clxsvc1',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });

    it('linkService — calls PUT /api/v1/utilities/services/:id/link with expenseId', async () => {
      (fetch as Mock).mockResolvedValue(
        new Response(JSON.stringify({ success: true }), { status: 200 }),
      );
      await utilitiesApi.linkService('clxsvc1', 'clxexp1');
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/utilities/services/clxsvc1/link',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ expenseId: 'clxexp1' }),
        }),
      );
    });

    it('unlinkService — calls DELETE /api/v1/utilities/services/:id/link', async () => {
      (fetch as Mock).mockResolvedValue(
        new Response(JSON.stringify({ success: true }), { status: 200 }),
      );
      await utilitiesApi.unlinkService('clxsvc1');
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/utilities/services/clxsvc1/link',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });

  // --- Readings ---

  describe('readings', () => {
    it('listReadings — calls GET /api/v1/utilities/readings without params', async () => {
      (fetch as Mock).mockResolvedValue(
        new Response(JSON.stringify([mockReading]), { status: 200 }),
      );
      const result = await utilitiesApi.listReadings();
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/utilities/readings',
        expect.objectContaining({
          headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        }),
      );
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe('clxread1');
    });

    it('listReadings — appends query params when provided', async () => {
      (fetch as Mock).mockResolvedValue(
        new Response(JSON.stringify([mockReading]), { status: 200 }),
      );
      await utilitiesApi.listReadings({
        serviceId: 'clxsvc1',
        dateFrom: '2024-01-01',
        dateTo: '2024-03-31',
      });
      const url = (fetch as Mock).mock.calls[0]![0] as string;
      expect(url).toContain('/api/v1/utilities/readings?');
      expect(url).toContain('serviceId=clxsvc1');
      expect(url).toContain('dateFrom=2024-01-01');
      expect(url).toContain('dateTo=2024-03-31');
    });

    it('createReading — calls POST /api/v1/utilities/readings with body', async () => {
      (fetch as Mock).mockResolvedValue(new Response(JSON.stringify(mockReading), { status: 201 }));
      const body = { serviceId: 'clxsvc1', billDate: '2024-03-01', cost: 45.5, usage: 350 };
      const result = await utilitiesApi.createReading(body);
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/utilities/readings',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(body),
        }),
      );
      expect(result.usage).toBe(350);
    });

    it('updateReading — calls PUT /api/v1/utilities/readings/:id with body', async () => {
      const updated = { ...mockReading, usage: 400 };
      (fetch as Mock).mockResolvedValue(new Response(JSON.stringify(updated), { status: 200 }));
      const body = { usage: 400 };
      const result = await utilitiesApi.updateReading('clxread1', body);
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/utilities/readings/clxread1',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify(body),
        }),
      );
      expect(result.usage).toBe(400);
    });

    it('deleteReading — calls DELETE /api/v1/utilities/readings/:id', async () => {
      (fetch as Mock).mockResolvedValue(
        new Response(JSON.stringify({ success: true }), { status: 200 }),
      );
      await utilitiesApi.deleteReading('clxread1');
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/utilities/readings/clxread1',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });
});
