import { describe, it, expect } from 'vitest';
import { get, post, createPaySchedule, createPayPeriod } from '../test/helpers.js';

describe('Pay Periods API', () => {
  it('lists pay periods', async () => {
    const schedule = await createPaySchedule();
    await createPayPeriod(schedule.id, { periodNum: 1 });
    await createPayPeriod(schedule.id, {
      periodNum: 2,
      startDate: new Date('2026-04-03'),
      endDate: new Date('2026-04-16'),
      payDate: new Date('2026-04-03'),
    });
    const res = await get('/pay-periods');
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).length).toBe(2);
  });

  it('gets current period', async () => {
    const schedule = await createPaySchedule();
    const now = new Date();
    await createPayPeriod(schedule.id, {
      startDate: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 5),
      endDate: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 8),
      payDate: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 5),
    });
    const res = await get('/pay-periods/current');
    expect(res.status).toBe(200);
  });

  it('returns 404 when no current period', async () => {
    await createPaySchedule();
    const res = await get('/pay-periods/current');
    // No periods created, so 404
    expect(res.status).toBe(404);
  });

  it('gets period by id with transactions', async () => {
    const schedule = await createPaySchedule();
    const period = await createPayPeriod(schedule.id);
    const res = await get(`/pay-periods/${period.id}`);
    expect(res.status).toBe(200);
  });

  it('returns periods from multiple schedules when filtering by date range', async () => {
    // Create two separate pay schedules
    const scheduleA = await createPaySchedule({ name: 'Schedule A', isDefault: true });
    const scheduleB = await createPaySchedule({ name: 'Schedule B', isDefault: false });

    // Create periods for schedule A — payDate within the query range
    await createPayPeriod(scheduleA.id, {
      startDate: new Date(Date.UTC(2026, 0, 1)),
      endDate: new Date(Date.UTC(2026, 0, 14)),
      payDate: new Date(Date.UTC(2026, 0, 1)),
      year: 2026,
      periodNum: 1,
    });
    await createPayPeriod(scheduleA.id, {
      startDate: new Date(Date.UTC(2026, 0, 15)),
      endDate: new Date(Date.UTC(2026, 0, 28)),
      payDate: new Date(Date.UTC(2026, 0, 15)),
      year: 2026,
      periodNum: 2,
    });

    // Create periods for schedule B — payDate within the query range
    await createPayPeriod(scheduleB.id, {
      startDate: new Date(Date.UTC(2026, 0, 5)),
      endDate: new Date(Date.UTC(2026, 0, 18)),
      payDate: new Date(Date.UTC(2026, 0, 5)),
      year: 2026,
      periodNum: 1,
    });

    // Create a period for schedule B outside the query range
    await createPayPeriod(scheduleB.id, {
      startDate: new Date(Date.UTC(2026, 5, 1)),
      endDate: new Date(Date.UTC(2026, 5, 14)),
      payDate: new Date(Date.UTC(2026, 5, 1)),
      year: 2026,
      periodNum: 2,
    });

    // Query with dateFrom/dateTo spanning Jan 2026
    const res = await get('/pay-periods?dateFrom=2026-01-01&dateTo=2026-01-31');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any[];

    // Should include 3 periods (2 from A, 1 from B) — the June period is excluded
    expect(body.length).toBe(3);

    const scheduleIds = new Set(body.map((p: any) => p.scheduleId));
    expect(scheduleIds.has(scheduleA.id)).toBe(true);
    expect(scheduleIds.has(scheduleB.id)).toBe(true);
  });

  it('generates periods for a configured schedule and retrieves them', async () => {
    // Create a biweekly schedule via the API
    const createRes = await post('/pay-schedules', {
      name: 'Biweekly',
      type: 'BIWEEKLY',
      anchorDate: '2026-01-02',
      isDefault: true,
    });
    expect(createRes.status).toBe(201);
    const schedule = (await createRes.json()) as any;

    // Generate periods for Q1 2026 via POST /pay-schedules/:id/generate
    const genRes = await post(`/pay-schedules/${schedule.id}/generate`, {
      rangeStart: '2026-01-01',
      rangeEnd: '2026-03-31',
    });
    expect(genRes.status).toBe(200);
    const generated = (await genRes.json()) as any[];
    expect(generated.length).toBeGreaterThanOrEqual(6); // ~6-7 biweekly periods in Q1

    // Verify generated periods are retrievable via GET /pay-periods
    const listRes = await get(
      `/pay-periods?scheduleId=${schedule.id}&dateFrom=2026-01-01&dateTo=2026-03-31`,
    );
    expect(listRes.status).toBe(200);
    const listed = (await listRes.json()) as any[];
    expect(listed.length).toBe(generated.length);

    // All returned periods belong to the correct schedule
    for (const period of listed) {
      expect(period.scheduleId).toBe(schedule.id);
    }
  });

  it('returns 404 for non-existent period id', async () => {
    const res = await get('/pay-periods/clxxxxxxxxxxxxxxxxxxxxxxxxx');
    expect(res.status).toBe(404);
    const body: any = await res.json();
    expect(body.error).toContain('not found');
  });
});
