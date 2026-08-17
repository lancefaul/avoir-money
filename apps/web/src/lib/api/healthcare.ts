import { request } from './request.js';
import {
  PolicyYearsSchema,
  InsurancePolicyWithBalanceSchema,
  HealthcareTransactionSchema,
} from '@budget-tracker/core';
import { z } from 'zod';

const HealthcareSummarySchema = z.object({
  healthcareBudgetSpent: z.number(),
  medicineBudgetSpent: z.number(),
});

export const healthcareApi = {
  years: () => request('/healthcare/years', PolicyYearsSchema),
  policies: (year: number) =>
    request(`/healthcare/policies?year=${year}`, z.array(InsurancePolicyWithBalanceSchema)),
  getPolicy: (id: string) =>
    request(`/healthcare/policies/${id}`, InsurancePolicyWithBalanceSchema),
  createPolicy: (body: unknown) =>
    request('/healthcare/policies', InsurancePolicyWithBalanceSchema, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updatePolicy: (id: string, body: unknown) =>
    request(`/healthcare/policies/${id}`, InsurancePolicyWithBalanceSchema, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  updateOverrides: (id: string, body: unknown) =>
    request(`/healthcare/policies/${id}/overrides`, InsurancePolicyWithBalanceSchema, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  endCoverage: (id: string) =>
    request(`/healthcare/policies/${id}/end-coverage`, InsurancePolicyWithBalanceSchema, {
      method: 'POST',
    }),
  closePolicy: (id: string) =>
    request(`/healthcare/policies/${id}/close`, InsurancePolicyWithBalanceSchema, {
      method: 'POST',
    }),
  transactions: (id: string) =>
    request(`/healthcare/policies/${id}/transactions`, z.array(HealthcareTransactionSchema)),
  summary: (year: number) => request(`/healthcare/summary?year=${year}`, HealthcareSummarySchema),
};
