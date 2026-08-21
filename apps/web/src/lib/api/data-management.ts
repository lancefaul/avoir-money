import { z } from 'zod';
import { request, _passthrough } from './request.js';

const CountsResponseSchema = z.object({
  allTransactions: z.number(),
  importedTransactions: z.number(),
  recurringExpenses: z.number(),
  recurringIncome: z.number(),
  accounts: z.number(),
  budgets: z.number(),
  debts: z.number(),
  utilities: z.number(),
  healthcarePolicies: z.number(),
  investments: z.number(),
  scheduledTransactions: z.number(),
  paySchedules: z.number(),
});

export type DataCounts = z.infer<typeof CountsResponseSchema>;

const DeleteResponseSchema = z.object({ deleted: z.number() });

export const dataManagementApi = {
  counts: () => request('/data-management/counts', CountsResponseSchema),
  deleteCategory: (category: string) =>
    request(`/data-management/${category}?confirm=true`, DeleteResponseSchema, {
      method: 'DELETE',
    }),
  deleteCategories: (categories: string[]) =>
    request('/data-management/bulk?confirm=true', _passthrough, {
      method: 'DELETE',
      body: JSON.stringify({ categories }),
    }),
};
