import { z } from 'zod';
import { request } from './request.js';

/**
 * Preferences are an opaque key/value store, so the response is validated as
 * "an object of strings" and no further. The server has no opinion about what
 * the interface persists (see `rust/api/src/preferences.rs`), and a schema here
 * naming individual settings would have to change every time one is added —
 * which is the coupling this shape exists to avoid.
 */
const PreferenceMapSchema = z.record(z.string());

export const preferencesApi = {
  list: () => request('/preferences', PreferenceMapSchema),
  set: (key: string, value: string) =>
    request('/preferences', z.object({ key: z.string() }), {
      method: 'PUT',
      body: JSON.stringify({ key, value }),
    }),
  remove: (key: string) =>
    request(`/preferences/${encodeURIComponent(key)}`, z.unknown(), { method: 'DELETE' }),
};
