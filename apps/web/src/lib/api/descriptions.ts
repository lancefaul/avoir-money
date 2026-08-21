import { z } from 'zod';
import { request, _passthrough } from './request.js';
import { DescriptionSchema } from '@budget-tracker/core';

const DescriptionListSchema = z.array(DescriptionSchema);

export const descriptionsApi = {
  list: (search?: string) => {
    const q = search ? `?search=${encodeURIComponent(search)}` : '';
    return request(`/descriptions${q}`, DescriptionListSchema);
  },
  create: (name: string) =>
    request('/descriptions', DescriptionSchema, { method: 'POST', body: JSON.stringify({ name }) }),
  rename: (id: string, name: string) =>
    request(`/descriptions/${id}`, DescriptionSchema, {
      method: 'PUT',
      body: JSON.stringify({ name }),
    }),
  merge: (targetId: string, sourceIds: string[]) =>
    request('/descriptions/merge', DescriptionSchema, {
      method: 'POST',
      body: JSON.stringify({ targetId, sourceIds }),
    }),
  delete: (id: string) => request(`/descriptions/${id}`, _passthrough, { method: 'DELETE' }),
};
