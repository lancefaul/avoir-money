import { request } from './request.js';
import {
  PayScheduleResponseSchema,
  PayScheduleListResponseSchema,
  PayScheduleWithCountResponseSchema,
  PayPeriodListResponseSchema,
} from '@budget-tracker/core';

export const paySchedulesApi = {
  list: () => request('/pay-schedules', PayScheduleListResponseSchema),
  get: (id: string) => request(`/pay-schedules/${id}`, PayScheduleWithCountResponseSchema),
  create: (body: unknown) =>
    request('/pay-schedules', PayScheduleResponseSchema, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  update: (id: string, body: unknown) =>
    request(`/pay-schedules/${id}`, PayScheduleResponseSchema, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  generate: (id: string, body: unknown) =>
    request(`/pay-schedules/${id}/generate`, PayPeriodListResponseSchema, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};
