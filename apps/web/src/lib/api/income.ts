import { request, _passthrough } from './request.js';
import { IncomeResponseSchema, IncomeListResponseSchema } from '@budget-tracker/core';

export const incomeApi = {
  list: (params?: {
    frequency?: string;
    budgetId?: string;
    limit?: number;
    offset?: number;
    archived?: string;
  }) => {
    const q = new URLSearchParams(params as Record<string, string>).toString();
    return request(`/income${q ? `?${q}` : ''}`, IncomeListResponseSchema);
  },
  get: (id: string) => request(`/income/${id}`, IncomeResponseSchema),
  create: (body: unknown) =>
    request('/income', IncomeResponseSchema, { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, body: unknown) =>
    request(`/income/${id}`, IncomeResponseSchema, { method: 'PUT', body: JSON.stringify(body) }),
  delete: (id: string) => request(`/income/${id}`, _passthrough, { method: 'DELETE' }),
  pause: (id: string, body: { duration?: number; unit?: string; indefinite?: boolean }) =>
    request(`/income/${id}/pause`, IncomeResponseSchema, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  resume: (id: string, body: { immediately?: boolean; resumeDate?: string }) =>
    request(`/income/${id}/resume`, IncomeResponseSchema, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  archive: (id: string) =>
    request(`/income/${id}/archive`, IncomeResponseSchema, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  restore: (id: string) =>
    request(`/income/${id}/restore`, IncomeResponseSchema, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
};
