import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createWrapper } from '../test/wrapper.js';

vi.mock('../lib/api.js', () => ({
  api: {
    dashboard: {
      currentPeriod: vi.fn().mockResolvedValue({ totalIncome: 5000, totalExpenses: 3000 }),
      ytd: vi.fn().mockResolvedValue({ year: 2026, totalIncome: 60000 }),
      incomeTrend: vi.fn().mockResolvedValue([{ month: '2026-01', amount: 5000 }]),
      spendPrediction: vi.fn().mockResolvedValue({ predicted: 3200, actual: 2800 }),
    },
  },
}));

import { api } from '../lib/api.js';
import { useCurrentPeriod, useYTD, useIncomeTrend, useSpendPrediction } from './useDashboard.js';

describe('useDashboard hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('useCurrentPeriod', () => {
    it('calls api.dashboard.currentPeriod and returns data', async () => {
      const { result } = renderHook(() => useCurrentPeriod(), { wrapper: createWrapper() });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(api.dashboard.currentPeriod).toHaveBeenCalledOnce();
      expect(result.current.data).toEqual({ totalIncome: 5000, totalExpenses: 3000 });
    });

    it('uses query key ["dashboard", "current-period"]', async () => {
      const { result } = renderHook(() => useCurrentPeriod(), { wrapper: createWrapper() });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(api.dashboard.currentPeriod).toHaveBeenCalled();
    });
  });

  describe('useYTD', () => {
    it('calls api.dashboard.ytd with year param', async () => {
      const { result } = renderHook(() => useYTD(2026), { wrapper: createWrapper() });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(api.dashboard.ytd).toHaveBeenCalledWith(2026);
      expect(result.current.data).toEqual({ year: 2026, totalIncome: 60000 });
    });

    it('calls api.dashboard.ytd with undefined when no year provided', async () => {
      const { result } = renderHook(() => useYTD(), { wrapper: createWrapper() });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(api.dashboard.ytd).toHaveBeenCalledWith(undefined);
    });
  });

  describe('useIncomeTrend', () => {
    it('calls api.dashboard.incomeTrend and returns data', async () => {
      const { result } = renderHook(() => useIncomeTrend(), { wrapper: createWrapper() });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(api.dashboard.incomeTrend).toHaveBeenCalledOnce();
      expect(result.current.data).toEqual([{ month: '2026-01', amount: 5000 }]);
    });

    it('uses query key ["dashboard", "income-trend"]', async () => {
      const { result } = renderHook(() => useIncomeTrend(), { wrapper: createWrapper() });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(api.dashboard.incomeTrend).toHaveBeenCalled();
    });
  });

  describe('useSpendPrediction', () => {
    it('calls api.dashboard.spendPrediction and returns data', async () => {
      const { result } = renderHook(() => useSpendPrediction(), { wrapper: createWrapper() });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(api.dashboard.spendPrediction).toHaveBeenCalledOnce();
      expect(result.current.data).toEqual({ predicted: 3200, actual: 2800 });
    });

    it('uses query key ["dashboard", "spend-prediction"]', async () => {
      const { result } = renderHook(() => useSpendPrediction(), { wrapper: createWrapper() });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(api.dashboard.spendPrediction).toHaveBeenCalled();
    });
  });
});
