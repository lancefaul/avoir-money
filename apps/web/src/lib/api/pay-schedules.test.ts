import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { paySchedulesApi } from './pay-schedules.js';

describe('paySchedulesApi', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockResponse(body: unknown, status = 200) {
    (fetch as Mock).mockResolvedValue(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  }

  const fakeSchedule = {
    id: 'ps1',
    name: 'Primary',
    type: 'BIWEEKLY',
    anchorDate: '2024-01-05T00:00:00.000Z',
    firstPayDay: null,
    secondPayDay: null,
    isDefault: true,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };

  const fakeScheduleWithCount = {
    ...fakeSchedule,
    _count: { payPeriods: 26 },
  };

  describe('get', () => {
    it('calls GET /pay-schedules/:id', async () => {
      mockResponse(fakeScheduleWithCount);
      await paySchedulesApi.get('ps1');
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/pay-schedules/ps1',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: expect.stringMatching(/^Bearer /),
          }),
        }),
      );
    });

    it('returns parsed schedule with _count', async () => {
      mockResponse(fakeScheduleWithCount);
      const result = await paySchedulesApi.get('ps1');
      expect(result.id).toBe('ps1');
      expect(result._count.payPeriods).toBe(26);
    });
  });

  describe('update', () => {
    it('calls PUT /pay-schedules/:id with body', async () => {
      mockResponse(fakeSchedule);
      const body = { name: 'Updated Schedule', type: 'MONTHLY', firstPayDay: 15 };
      await paySchedulesApi.update('ps1', body);
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/pay-schedules/ps1',
        expect.objectContaining({ method: 'PUT', body: JSON.stringify(body) }),
      );
    });

    it('returns parsed updated schedule', async () => {
      const updated = { ...fakeSchedule, name: 'Updated Schedule' };
      mockResponse(updated);
      const result = await paySchedulesApi.update('ps1', { name: 'Updated Schedule' });
      expect(result.name).toBe('Updated Schedule');
    });
  });
});
