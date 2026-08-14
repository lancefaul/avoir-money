import { request, _passthrough } from './request.js';
import {
  UtilityProviderResponseSchema,
  UtilityProviderListResponseSchema,
  UtilityServiceResponseSchema,
  UtilityServiceListResponseSchema,
  UtilityReadingResponseSchema,
  UtilityReadingListResponseSchema,
} from '@budget-tracker/core';

export const utilitiesApi = {
  // Providers
  listProviders: () => request('/utilities/providers', UtilityProviderListResponseSchema),
  createProvider: (body: { name: string }) =>
    request('/utilities/providers', UtilityProviderResponseSchema, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateProvider: (id: string, body: { name: string }) =>
    request(`/utilities/providers/${id}`, UtilityProviderResponseSchema, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  deleteProvider: (id: string) =>
    request(`/utilities/providers/${id}`, _passthrough, { method: 'DELETE' }),

  // Services
  listServices: (providerId: string) =>
    request(`/utilities/providers/${providerId}/services`, UtilityServiceListResponseSchema),
  createService: (providerId: string, body: { serviceType: string; metering: string }) =>
    request(`/utilities/providers/${providerId}/services`, UtilityServiceResponseSchema, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateService: (id: string, body: { metering: string }) =>
    request(`/utilities/services/${id}`, UtilityServiceResponseSchema, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  deleteService: (id: string) =>
    request(`/utilities/services/${id}`, _passthrough, { method: 'DELETE' }),
  linkService: (id: string, expenseId: string) =>
    request(`/utilities/services/${id}/link`, _passthrough, {
      method: 'PUT',
      body: JSON.stringify({ expenseId }),
    }),
  unlinkService: (id: string) =>
    request(`/utilities/services/${id}/link`, _passthrough, {
      method: 'DELETE',
    }),

  // Readings
  listReadings: (params?: { serviceId?: string; dateFrom?: string; dateTo?: string }) => {
    const q = new URLSearchParams(params as Record<string, string>).toString();
    return request(`/utilities/readings${q ? `?${q}` : ''}`, UtilityReadingListResponseSchema);
  },
  createReading: (body: unknown) =>
    request('/utilities/readings', UtilityReadingResponseSchema, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateReading: (id: string, body: unknown) =>
    request(`/utilities/readings/${id}`, UtilityReadingResponseSchema, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  deleteReading: (id: string) =>
    request(`/utilities/readings/${id}`, _passthrough, { method: 'DELETE' }),
};
