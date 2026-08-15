import { request } from './request.js';
import { SignConventionConfigSchema } from '@budget-tracker/core';
import type { SignConventionConfig } from '@budget-tracker/core';

export const signConventionsApi = {
  get: () => request('/sign-conventions', SignConventionConfigSchema),
  save: (body: SignConventionConfig) =>
    request('/sign-conventions', SignConventionConfigSchema, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
};
