import { z } from 'zod';
import { request, _passthrough } from './request.js';
import { ScheduledTransactionSchema, TransactionResponseSchema } from '@budget-tracker/core';

export const scheduledTransactionsApi = {
  list: (params: {
    periodStart: string;
    periodEnd: string;
    sourceType?: string;
    sourceId?: string;
  }) => {
    const q = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v != null)) as Record<
        string,
        string
      >,
    ).toString();
    return request(`/scheduled-transactions?${q}`, z.array(ScheduledTransactionSchema));
  },
  markAsPaid: (id: string, body?: { amount?: number; date?: string; accountId?: string }) =>
    request(`/scheduled-transactions/${id}/pay`, TransactionResponseSchema, {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    }),
  snooze: (id: string, body: { days: number }) =>
    request(`/scheduled-transactions/${id}/snooze`, ScheduledTransactionSchema, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  skip: (id: string) =>
    request(`/scheduled-transactions/${id}/skip`, ScheduledTransactionSchema, { method: 'POST' }),
};
