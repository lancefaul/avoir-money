import { request, _passthrough } from './request.js';
import { CreatePurchaseResultSchema } from '@budget-tracker/core';
import type { CreatePurchaseInput, UpdatePurchasePaymentsInput } from '@budget-tracker/core';

/**
 * Multi-account payment splits (payment-split, ADR-030). A single payment is the
 * ordinary transaction path (the API writes one row and returns
 * `purchaseGroupId: null`); two or more become a purchase group — a
 * balance-neutral Anchor carrying the budget plus one balance-visible leg per
 * account.
 */
export const purchasesApi = {
  create: (body: CreatePurchaseInput) =>
    request('/purchases', CreatePurchaseResultSchema, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // Replace a group's payment legs (re-split). The Anchor and its budget are
  // untouched; the new legs must still sum to the Anchor's net amount. Returns
  // the same result shape as create.
  updatePayments: (groupId: string, body: UpdatePurchasePaymentsInput) =>
    request(`/purchases/${groupId}/payments`, CreatePurchaseResultSchema, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  // Deleting a group returns only an acknowledgement — there is no group left to
  // send back. Passthrough matches the API's `{ success: true }`.
  delete: (groupId: string) => request(`/purchases/${groupId}`, _passthrough, { method: 'DELETE' }),
};
