import { z } from 'zod';
import { request, _passthrough } from './request.js';
import { BudgetExpenseLinkResponseSchema } from '@budget-tracker/core';

const BulkLinkResultSchema = z.object({
  results: z.array(
    z.union([
      BudgetExpenseLinkResponseSchema,
      z.object({ expenseId: z.string(), error: z.string() }),
    ]),
  ),
});

export const budgetLinksApi = {
  list: (categoryBudgetId: string) =>
    request(
      `/category-budgets/${categoryBudgetId}/links`,
      z.array(BudgetExpenseLinkResponseSchema),
    ),

  link: (categoryBudgetId: string, expenseId: string) =>
    request(`/category-budgets/${categoryBudgetId}/links`, BudgetExpenseLinkResponseSchema, {
      method: 'POST',
      body: JSON.stringify({ expenseId }),
    }),

  bulkLink: (categoryBudgetId: string, expenseIds: string[]) =>
    request(`/category-budgets/${categoryBudgetId}/links/bulk`, BulkLinkResultSchema, {
      method: 'POST',
      body: JSON.stringify({ expenseIds }),
    }),

  unlink: (categoryBudgetId: string, linkId: string) =>
    request(`/category-budgets/${categoryBudgetId}/links/${linkId}`, _passthrough, {
      method: 'DELETE',
    }),
};
