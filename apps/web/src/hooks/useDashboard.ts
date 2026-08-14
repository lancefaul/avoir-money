import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';

export const useCurrentPeriod = () =>
  useQuery({
    queryKey: ['dashboard', 'current-period'],
    queryFn: () => api.dashboard.currentPeriod(),
  });

export const useYTD = (year?: number) =>
  useQuery({ queryKey: ['dashboard', 'ytd', year], queryFn: () => api.dashboard.ytd(year) });

export const useIncomeTrend = () =>
  useQuery({ queryKey: ['dashboard', 'income-trend'], queryFn: () => api.dashboard.incomeTrend() });

export const useSpendPrediction = () =>
  useQuery({
    queryKey: ['dashboard', 'spend-prediction'],
    queryFn: () => api.dashboard.spendPrediction(),
  });
