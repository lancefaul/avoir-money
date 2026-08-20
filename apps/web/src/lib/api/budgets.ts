import { z } from 'zod';
import { request, _passthrough } from './request.js';
import {
  YearPlanResponseSchema,
  CategoryBudgetResponseSchema,
  BudgetStatusResponseSchema,
  BudgetHistoryResponseSchema,
  type CreateYearPlan,
  type CarryForward,
  type CreateCategoryBudget,
  type UpdateCategoryBudget,
} from '@budget-tracker/core';

export const budgetsApi = {
  // ─── Year Plans ───

  listPlans: () => request('/year-plans', z.array(YearPlanResponseSchema)),

  createPlan: (body: CreateYearPlan) =>
    request('/year-plans', YearPlanResponseSchema, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getPlan: (id: string) => request(`/year-plans/${id}`, YearPlanResponseSchema),

  confirmPlan: (id: string) =>
    request(`/year-plans/${id}/confirm`, YearPlanResponseSchema, {
      method: 'POST',
    }),

  carryForward: (id: string, body: CarryForward) =>
    request(`/year-plans/${id}/carry-forward`, YearPlanResponseSchema, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // ─── Category Budgets ───

  listBudgets: (
    yearPlanId: string,
    month?: number,
    year?: number,
    includeSeasonal?: boolean,
    periodStart?: string,
    periodEnd?: string,
    viewMode?: string,
  ) => {
    const entries: Record<string, string> = { yearPlanId };
    if (month !== undefined) entries.month = String(month);
    if (year !== undefined) entries.year = String(year);
    if (includeSeasonal) entries.includeSeasonal = 'true';
    if (periodStart) entries.periodStart = periodStart;
    if (periodEnd) entries.periodEnd = periodEnd;
    if (viewMode) entries.viewMode = viewMode;
    const q = new URLSearchParams(entries).toString();
    return request(`/category-budgets?${q}`, z.array(BudgetStatusResponseSchema));
  },

  createBudget: (body: CreateCategoryBudget) =>
    request('/category-budgets', CategoryBudgetResponseSchema, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateBudget: (id: string, body: UpdateCategoryBudget) =>
    request(`/category-budgets/${id}`, CategoryBudgetResponseSchema, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  deleteBudget: (id: string) =>
    request(`/category-budgets/${id}`, _passthrough, { method: 'DELETE' }),

  restoreBudget: (id: string) =>
    request(`/category-budgets/${id}/restore`, CategoryBudgetResponseSchema, {
      method: 'POST',
    }),

  getBudgetHistory: (id: string) =>
    request(`/category-budgets/${id}/history`, BudgetHistoryResponseSchema),
};
