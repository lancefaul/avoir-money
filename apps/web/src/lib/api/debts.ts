import { request, _passthrough } from './request.js';
import {
  DebtResponseSchema,
  DebtListResponseSchema,
  DebtSummarySchema,
  AmortizationScheduleSchema,
  EscrowRecordSchema,
  ExtraPaymentResponseSchema,
} from '@budget-tracker/core';
import { z } from 'zod';

export const debtsApi = {
  list: (params?: {
    type?: string;
    paidOff?: 'true' | 'false';
    linkedAccountId?: string;
    limit?: number;
    offset?: number;
  }) => {
    const entries: Record<string, string> = {};
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null) entries[k] = String(v);
      }
    }
    const q = new URLSearchParams(entries).toString();
    return request(`/debts${q ? `?${q}` : ''}`, DebtListResponseSchema);
  },
  get: (id: string) => request(`/debts/${id}`, DebtResponseSchema),
  create: (body: unknown) =>
    request('/debts', DebtResponseSchema, { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, body: unknown) =>
    request(`/debts/${id}`, DebtResponseSchema, { method: 'PUT', body: JSON.stringify(body) }),
  delete: (id: string) => request(`/debts/${id}`, _passthrough, { method: 'DELETE' }),
  summary: () => request('/debts/summary', DebtSummarySchema),
  amortization: (id: string, extraPayment?: number) =>
    request(
      `/debts/${id}/amortization${extraPayment ? `?extraPayment=${extraPayment}` : ''}`,
      AmortizationScheduleSchema,
    ),

  // ─── Extra Payment ────────────────────────────────────────────────────────
  extraPayment: (
    debtId: string,
    body: { amount: number; date: string; accountId: string; note?: string },
  ) =>
    request(`/debts/${debtId}/extra-payment`, ExtraPaymentResponseSchema, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // ─── Escrow ──────────────────────────────────────────────────────────────
  createEscrow: (
    debtId: string,
    body: { monthlyAmount: number; periodStartDate: string; periodEndDate: string },
  ) =>
    request(`/debts/${debtId}/escrow`, EscrowRecordSchema, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  listEscrow: (debtId: string) => request(`/debts/${debtId}/escrow`, z.array(EscrowRecordSchema)),
  updateEscrow: (debtId: string, escrowId: string, body: unknown) =>
    request(`/debts/${debtId}/escrow/${escrowId}`, EscrowRecordSchema, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  deleteEscrow: (debtId: string, escrowId: string) =>
    request(`/debts/${debtId}/escrow/${escrowId}`, _passthrough, { method: 'DELETE' }),
};
