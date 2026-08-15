import { createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import {
  ServiceStatusSchema,
  ServiceStatusListSchema,
  SetServiceKeySchema,
} from '@budget-tracker/core';
import { ErrorSchema, createRouter } from '../lib/errors.js';
import {
  FINNHUB,
  COINGECKO,
  getServiceStatus,
  setServiceKey,
  clearServiceKey,
} from '../lib/connected-services.js';
import { MissingSecretError } from '../lib/secret-box.js';

/**
 * Third-party services connected with the user's own API key.
 *
 * Every response here is a *status* — configured or not, and the last four
 * characters. The key itself is never returned by any route in this file. It is
 * written once and read only by the server code that calls the provider.
 */
const app = createRouter();

/** Providers this app knows how to use. Unknown slugs are refused. */
const KNOWN_PROVIDERS = [FINNHUB, COINGECKO] as const;

function isKnown(provider: string): boolean {
  return (KNOWN_PROVIDERS as readonly string[]).includes(provider);
}

// ─── GET / ───

const listRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Connected Services'],
  summary: 'Status of every connectable service',
  responses: {
    200: {
      content: { 'application/json': { schema: ServiceStatusListSchema } },
      description: 'One status per known provider',
    },
  },
});

app.openapi(listRoute, async (c) => {
  const statuses = await Promise.all(KNOWN_PROVIDERS.map((p) => getServiceStatus(p)));
  return c.json(statuses, 200);
});

// ─── PUT /{provider} ───

const setRoute = createRoute({
  method: 'put',
  path: '/{provider}',
  tags: ['Connected Services'],
  summary: "Store this service's API key",
  request: {
    params: z.object({ provider: z.string() }),
    body: { content: { 'application/json': { schema: SetServiceKeySchema } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: ServiceStatusSchema } },
      description: 'Key stored; status returned without the key',
    },
    400: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Bad Request' },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Unknown provider',
    },
    503: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Server cannot store secrets',
    },
  },
});

app.openapi(setRoute, async (c) => {
  const { provider } = c.req.valid('param');
  if (!isKnown(provider)) return c.json({ error: 'Unknown service' }, 404);

  const { apiKey } = c.req.valid('json');
  try {
    return c.json(await setServiceKey(provider, apiKey), 200);
  } catch (err) {
    // 503, not 500: the server is working correctly and is unable to do this
    // until it is configured, and the message says exactly what to do.
    if (err instanceof MissingSecretError) return c.json({ error: err.message }, 503);
    throw err;
  }
});

// ─── DELETE /{provider} ───

const clearRoute = createRoute({
  method: 'delete',
  path: '/{provider}',
  tags: ['Connected Services'],
  summary: "Remove this service's stored API key",
  request: { params: z.object({ provider: z.string() }) },
  responses: {
    200: {
      content: { 'application/json': { schema: ServiceStatusSchema } },
      description: 'Key removed; resulting status returned',
    },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Unknown provider',
    },
  },
});

app.openapi(clearRoute, async (c) => {
  const { provider } = c.req.valid('param');
  if (!isKnown(provider)) return c.json({ error: 'Unknown service' }, 404);
  return c.json(await clearServiceKey(provider), 200);
});

export default app;
