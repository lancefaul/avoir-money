import { z } from 'zod';
import { request, _passthrough, type TransactionListParams } from './request.js';
import {
  TransactionResponseSchema,
  PaginatedTransactionsResponseSchema,
  ChildTransactionSchema,
  ChildrenResponseSchema,
  BudgetSuggestionsResponseSchema,
} from '@budget-tracker/core';

export const transactionsApi = {
  list: (params?: TransactionListParams) => {
    const entries: Record<string, string> = {};
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null) entries[k] = String(v);
      }
    }
    const q = new URLSearchParams(entries).toString();
    return request(`/transactions${q ? `?${q}` : ''}`, PaginatedTransactionsResponseSchema);
  },
  create: (body: unknown) =>
    request('/transactions', TransactionResponseSchema, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  update: (id: string, body: unknown) =>
    request(`/transactions/${id}`, TransactionResponseSchema, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  delete: (id: string) => request(`/transactions/${id}`, _passthrough, { method: 'DELETE' }),
  deleteImported: () =>
    request('/transactions/imported?confirm=true', z.object({ deleted: z.number() }), {
      method: 'DELETE',
    }),
  link: (id: string, body: { expenseId?: string; incomeId?: string }) =>
    request(`/transactions/${id}/link`, TransactionResponseSchema, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  unlink: (id: string) => request(`/transactions/${id}/link`, _passthrough, { method: 'DELETE' }),
  listChildren: (parentId: string) =>
    request(`/transactions/${parentId}/children`, ChildrenResponseSchema),
  createChild: (parentId: string, body: unknown) =>
    request(`/transactions/${parentId}/children`, ChildTransactionSchema, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateChild: (parentId: string, childId: string, body: unknown) =>
    request(`/transactions/${parentId}/children/${childId}`, ChildTransactionSchema, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  deleteChild: (parentId: string, childId: string) =>
    request(`/transactions/${parentId}/children/${childId}`, _passthrough, { method: 'DELETE' }),
  suggestBudget: (description: string) =>
    request(
      `/transactions/suggest-budget?description=${encodeURIComponent(description)}`,
      BudgetSuggestionsResponseSchema,
    ),
};
