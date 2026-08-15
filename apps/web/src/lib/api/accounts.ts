import { request, _passthrough } from './request.js';
import { AccountResponseSchema, AccountListResponseSchema } from '@budget-tracker/core';

export const accountsApi = {
  list: () => request('/accounts', AccountListResponseSchema),
  create: (body: unknown) =>
    request('/accounts', AccountResponseSchema, { method: 'POST', body: JSON.stringify(body) }),
  /** Create a Rewards account nested under a card (rewards-as-child-account). */
  createRewardsAccount: (cardId: string, body: unknown) =>
    request(`/accounts/${cardId}/rewards-account`, AccountResponseSchema, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  update: (id: string, body: unknown) =>
    request(`/accounts/${id}`, AccountResponseSchema, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  delete: (id: string) => request(`/accounts/${id}`, _passthrough, { method: 'DELETE' }),
  archive: (id: string) =>
    request(`/accounts/${id}/archive`, AccountResponseSchema, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  unarchive: (id: string) =>
    request(`/accounts/${id}/unarchive`, AccountResponseSchema, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  transactionCount: (id: string) => request(`/accounts/${id}/transaction-count`, _passthrough),
};
