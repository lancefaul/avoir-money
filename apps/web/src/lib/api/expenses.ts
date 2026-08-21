import { request, _passthrough } from './request.js';
import { ExpenseResponseSchema, ExpenseListResponseSchema } from '@budget-tracker/core';

export const expensesApi = {
  list: (params?: {
    budgetId?: string;
    accountId?: string;
    frequency?: string;
    isAutomatic?: string;
    limit?: number;
    offset?: number;
    archived?: string;
  }) => {
    const q = new URLSearchParams(params as Record<string, string>).toString();
    return request(`/expenses${q ? `?${q}` : ''}`, ExpenseListResponseSchema);
  },
  get: (id: string) => request(`/expenses/${id}`, ExpenseResponseSchema),
  create: (body: unknown) =>
    request('/expenses', ExpenseResponseSchema, { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, body: unknown) =>
    request(`/expenses/${id}`, ExpenseResponseSchema, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  delete: (id: string) => request(`/expenses/${id}`, _passthrough, { method: 'DELETE' }),
  pause: (id: string, body: { duration?: number; unit?: string; indefinite?: boolean }) =>
    request(`/expenses/${id}/pause`, ExpenseResponseSchema, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  resume: (id: string, body: { immediately?: boolean; resumeDate?: string }) =>
    request(`/expenses/${id}/resume`, ExpenseResponseSchema, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  archive: (id: string) =>
    request(`/expenses/${id}/archive`, ExpenseResponseSchema, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  restore: (id: string) =>
    request(`/expenses/${id}/restore`, ExpenseResponseSchema, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
};
