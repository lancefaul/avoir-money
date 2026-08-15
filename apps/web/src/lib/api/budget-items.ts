import { request, _passthrough } from './request.js';
import {
  BudgetItemResponseSchema,
  BudgetItemListResponseSchema,
  BudgetGroupResponseSchema,
  BudgetGroupListResponseSchema,
  BudgetItemDeleteResponseSchema,
  BudgetItemSoftDeleteResponseSchema,
  BudgetItemReassignResponseSchema,
} from '@budget-tracker/core';

export const budgetItemsApi = {
  list: () => request('/budgets', BudgetItemListResponseSchema),
  groups: () => request('/budgets/groups', BudgetGroupListResponseSchema),
  createGroup: (body: unknown) =>
    request('/budgets/groups', BudgetGroupResponseSchema, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateGroup: (id: string, body: unknown) =>
    request(`/budgets/groups/${id}`, BudgetGroupResponseSchema, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  deleteGroup: (id: string) => request(`/budgets/groups/${id}`, _passthrough, { method: 'DELETE' }),
  create: (body: unknown) =>
    request('/budgets', BudgetItemResponseSchema, { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, body: unknown) =>
    request(`/budgets/${id}`, BudgetItemResponseSchema, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  delete: (id: string, mode: 'hard' | 'soft' = 'hard') =>
    request(
      `/budgets/${id}?mode=${mode}`,
      mode === 'hard' ? BudgetItemDeleteResponseSchema : BudgetItemSoftDeleteResponseSchema,
      { method: 'DELETE' },
    ),
  reassign: (id: string, targetBudgetId: string) =>
    request(`/budgets/${id}/reassign`, BudgetItemReassignResponseSchema, {
      method: 'POST',
      body: JSON.stringify({ targetBudgetId }),
    }),
};
