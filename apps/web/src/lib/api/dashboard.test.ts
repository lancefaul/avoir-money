import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { dashboardApi } from './dashboard.js';

describe('dashboardApi', () => {
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

  function getCalledUrl(): string {
    return (fetch as Mock).mock.calls[0]![0] as string;
  }

  const fakeCurrentPeriod = {
    payPeriod: {
      id: 'pp1',
      scheduleId: 'sch1',
      startDate: '2024-01-01T00:00:00.000Z',
      endDate: '2024-01-14T00:00:00.000Z',
      payDate: '2024-01-15T00:00:00.000Z',
      year: 2024,
      periodNum: 1,
    },
    schedule: {
      id: 'sch1',
      name: 'Biweekly',
      type: 'BIWEEKLY',
      anchorDate: '2024-01-01T00:00:00.000Z',
      firstPayDay: null,
      secondPayDay: null,
      isDefault: true,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    },
    totalIncome: 3000,
    totalExpenses: 1500,
    netIncome: 1500,
    incomeItems: [],
    expenseItems: [],
    balances: [],
    cashFlowSummary: {
      cashExpenses: 500,
      creditExpenses: 1000,
      previousPeriodCreditExpenses: 800,
      previousPeriodBankBalance: 0,
      cashNeeded: 2300,
      creditCardPayments: 800,
    },
  };

  const fakeYtd = {
    year: 2024,
    startDate: '2024-01-01T00:00:00.000Z',
    endDate: '2024-12-31T00:00:00.000Z',
    totalIncome: 36000,
    totalExpenses: 24000,
    netIncome: 12000,
    byCategory: [],
  };

  const fakeIncomeTrend = [
    {
      periodLabel: 'Jan 1',
      startDate: '2024-01-01T00:00:00.000Z',
      endDate: '2024-01-14T00:00:00.000Z',
      income: 3000,
      expenses: 1500,
      trades: 0,
      budgetExpenses: 1200,
      projected: false,
    },
  ];

  const fakeSpendPrediction = {
    expectedPeriodSpend: 2000,
    overUnderAmount: -200,
    periodStartDate: '2024-01-01T00:00:00.000Z',
    periodEndDate: '2024-01-14T00:00:00.000Z',
    currentDayNumber: 7,
    totalDays: 14,
    dailyData: [
      {
        dayNumber: 1,
        date: '2024-01-01T00:00:00.000Z',
        expectedCumulative: 142.86,
        actualCumulative: 150,
      },
    ],
  };

  describe('currentPeriod', () => {
    it('calls GET /dashboard/current-period with no params', async () => {
      mockResponse(fakeCurrentPeriod);
      await dashboardApi.currentPeriod();
      const url = getCalledUrl();
      expect(url).toBe('/api/v1/dashboard/current-period');
    });

    it('calls GET /dashboard/current-period with scheduleId', async () => {
      mockResponse(fakeCurrentPeriod);
      await dashboardApi.currentPeriod('sch1');
      const url = getCalledUrl();
      expect(url).toBe('/api/v1/dashboard/current-period?scheduleId=sch1');
    });

    it('returns parsed response data', async () => {
      mockResponse(fakeCurrentPeriod);
      const result = await dashboardApi.currentPeriod();
      expect(result.totalIncome).toBe(3000);
      expect(result.netIncome).toBe(1500);
    });
  });

  describe('ytd', () => {
    it('calls GET /dashboard/ytd with no params', async () => {
      mockResponse(fakeYtd);
      await dashboardApi.ytd();
      const url = getCalledUrl();
      expect(url).toBe('/api/v1/dashboard/ytd');
    });

    it('calls GET /dashboard/ytd with year param', async () => {
      mockResponse(fakeYtd);
      await dashboardApi.ytd(2024);
      const url = getCalledUrl();
      expect(url).toBe('/api/v1/dashboard/ytd?year=2024');
    });

    it('returns parsed response data', async () => {
      mockResponse(fakeYtd);
      const result = await dashboardApi.ytd();
      expect(result.year).toBe(2024);
      expect(result.totalIncome).toBe(36000);
    });
  });

  describe('incomeTrend', () => {
    it('calls GET /dashboard/income-trend with no params', async () => {
      mockResponse(fakeIncomeTrend);
      await dashboardApi.incomeTrend();
      const url = getCalledUrl();
      expect(url).toBe('/api/v1/dashboard/income-trend');
    });

    it('calls GET /dashboard/income-trend with scheduleId', async () => {
      mockResponse(fakeIncomeTrend);
      await dashboardApi.incomeTrend('sch1');
      const url = getCalledUrl();
      expect(url).toBe('/api/v1/dashboard/income-trend?scheduleId=sch1');
    });

    it('returns parsed array of data points', async () => {
      mockResponse(fakeIncomeTrend);
      const result = await dashboardApi.incomeTrend();
      expect(result).toHaveLength(1);
      expect(result[0]!.income).toBe(3000);
      expect(result[0]!.projected).toBe(false);
    });
  });

  describe('spendPrediction', () => {
    it('calls GET /dashboard/spend-prediction with no params', async () => {
      mockResponse(fakeSpendPrediction);
      await dashboardApi.spendPrediction();
      const url = getCalledUrl();
      expect(url).toBe('/api/v1/dashboard/spend-prediction');
    });

    it('calls GET /dashboard/spend-prediction with scheduleId', async () => {
      mockResponse(fakeSpendPrediction);
      await dashboardApi.spendPrediction('sch1');
      const url = getCalledUrl();
      expect(url).toBe('/api/v1/dashboard/spend-prediction?scheduleId=sch1');
    });

    it('returns parsed response data', async () => {
      mockResponse(fakeSpendPrediction);
      const result = await dashboardApi.spendPrediction();
      expect(result.expectedPeriodSpend).toBe(2000);
      expect(result.overUnderAmount).toBe(-200);
      expect(result.dailyData).toHaveLength(1);
    });
  });
});
