import { request } from './request.js';
import {
  CurrentPeriodResponseSchema,
  YTDResponseSchema,
  IncomeTrendResponseSchema,
  SpendPredictionResponseSchema,
} from '@budget-tracker/core';

export const dashboardApi = {
  currentPeriod: (scheduleId?: string) =>
    request(
      `/dashboard/current-period${scheduleId ? `?scheduleId=${scheduleId}` : ''}`,
      CurrentPeriodResponseSchema,
    ),
  ytd: (year?: number) =>
    request(`/dashboard/ytd${year ? `?year=${year}` : ''}`, YTDResponseSchema),
  incomeTrend: (scheduleId?: string) =>
    request(
      `/dashboard/income-trend${scheduleId ? `?scheduleId=${scheduleId}` : ''}`,
      IncomeTrendResponseSchema,
    ),
  spendPrediction: (scheduleId?: string) =>
    request(
      `/dashboard/spend-prediction${scheduleId ? `?scheduleId=${scheduleId}` : ''}`,
      SpendPredictionResponseSchema,
    ),
};
