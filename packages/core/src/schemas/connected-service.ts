import { z } from 'zod';

/**
 * What a client may know about a stored third-party key.
 *
 * Deliberately does not include the key. The server holds it so it can call the
 * provider; there is no screen that needs it back, and a response that carried
 * it would put it in browser memory, devtools, and any logging proxy in between
 * for no benefit. `hint` is the last four characters, which is enough to answer
 * "is this the key I think it is".
 */
export const ServiceStatusSchema = z.object({
  provider: z.string(),
  configured: z.boolean(),
  /** Last 4 characters, or '' when unknown or too short to hint safely. */
  hint: z.string(),
  /** Which source the key in use came from. */
  source: z.enum(['database', 'environment', 'none']),
  updatedAt: z.coerce.date().nullable(),
  /** False when the server has no INTEGRATION_SECRET and so cannot store keys. */
  storageAvailable: z.boolean(),
});
export type ServiceStatus = z.infer<typeof ServiceStatusSchema>;

export const ServiceStatusListSchema = z.array(ServiceStatusSchema);

export const SetServiceKeySchema = z.object({
  /** Trimmed server-side; a pasted key routinely carries whitespace. */
  apiKey: z.string().min(8).max(500),
});
