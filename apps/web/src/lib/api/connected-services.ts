import { request } from './request.js';
import { ServiceStatusSchema, ServiceStatusListSchema } from '@budget-tracker/core';

/**
 * Third-party service keys.
 *
 * Every response is a status — configured or not, plus the key's last four
 * characters. The key itself is written once and never read back, so nothing
 * here returns it and no caller can accidentally put it on screen.
 */
export const connectedServicesApi = {
  list: () => request('/connected-services', ServiceStatusListSchema),

  set: (provider: string, apiKey: string) =>
    request(`/connected-services/${provider}`, ServiceStatusSchema, {
      method: 'PUT',
      body: JSON.stringify({ apiKey }),
    }),

  clear: (provider: string) =>
    request(`/connected-services/${provider}`, ServiceStatusSchema, { method: 'DELETE' }),
};
