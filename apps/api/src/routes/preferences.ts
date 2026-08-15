/**
 * `/preferences` — interface settings, stored with the user's data (ADR-042).
 *
 * # This route exists to be compared against, not to be used
 *
 * The shipping implementation is `rust/api/src/preferences.rs` against SQLite.
 * Nothing a user runs reaches this file. It is here because ADR-041 keeps
 * `apps/api` as the differential reference, and a route the reference does not
 * implement is a route the harness cannot compare — the same blindness that let
 * `/sign-conventions` ship missing from the port entirely (ERRORS.md: "a
 * differential harness compares the routes you HAVE, never the ones you are
 * missing").
 *
 * # The honest limit of the comparison
 *
 * ADR-041's argument is that a fixture means something because TWO independent
 * implementations produced it. This one is weaker than that on purpose: it was
 * written after the Rust handler and against its contract, so it inherits
 * whatever that contract got wrong. What it does buy is DRIFT detection — if
 * either side's upsert semantics, response shape or bounds change from here,
 * the harness says so. That is worth having and it is less than independence,
 * and the distinction should not be quietly forgotten.
 *
 * # Where the two deliberately differ
 *
 * The Rust handler hand-validates and puts its whole explanation in `error`.
 * This one validates with Zod through `createRouter`'s shared hook, so a bad
 * body comes back as `{ error, details: [{ field, message }] }` with Zod's
 * wording. Both are the project's `{ error, details? }` envelope; the message
 * strings are not expected to match, and a harness diff on those two is a
 * recorded divergence rather than a defect.
 */

import { createRoute, z } from '@hono/zod-openapi';
import { prisma } from '@budget-tracker/db';
import {
  PreferenceMapSchema,
  SetPreferenceSchema,
  PreferenceKeySchema,
} from '@budget-tracker/core';
import { ErrorSchema, createRouter } from '../lib/errors.js';

const app = createRouter();

// ─── GET / ───

const listPreferencesRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Preferences'],
  summary: 'Every stored interface preference',
  responses: {
    200: {
      content: { 'application/json': { schema: PreferenceMapSchema } },
      description: 'Preferences as one flat object',
    },
  },
});

app.openapi(listPreferencesRoute, async (c) => {
  const rows = await prisma.uiPreference.findMany({
    select: { key: true, value: true },
  });

  // A map, not a list of rows: the client is a storage adapter keyed by name.
  // An empty table is `{}` and never a 404 — "nothing stored yet" is the
  // ordinary first-run state, and making the client treat it as an error would
  // put a failure on the path every fresh install takes.
  const out: Record<string, string> = {};
  for (const r of rows) out[r.key] = r.value;

  return c.json(out, 200);
});

// ─── PUT / ───

const setPreferenceRoute = createRoute({
  method: 'put',
  path: '/',
  tags: ['Preferences'],
  summary: 'Write one preference',
  request: {
    body: { content: { 'application/json': { schema: SetPreferenceSchema } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: PreferenceKeySchema } },
      description: 'The key that was written',
    },
    400: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Bad Request',
    },
  },
});

app.openapi(setPreferenceRoute, async (c) => {
  const { key, value } = c.req.valid('json');

  // Upsert, so the client never has to know whether a setting has been stored
  // before — which it cannot know without a round-trip it should not need.
  await prisma.uiPreference.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });

  return c.json({ key }, 200);
});

// ─── DELETE /:key ───

const deletePreferenceRoute = createRoute({
  method: 'delete',
  path: '/{key}',
  tags: ['Preferences'],
  summary: 'Forget one preference',
  request: {
    params: z.object({ key: z.string().min(1) }),
  },
  responses: {
    204: { description: 'Deleted, or was never there' },
  },
});

app.openapi(deletePreferenceRoute, async (c) => {
  const { key } = c.req.valid('param');

  // `deleteMany` rather than `delete`, because this is idempotent by design:
  // the client's `removeItem` has no way to find out first and nothing
  // meaningful to do if told the key was already absent. `delete` would throw
  // P2025 and turn a no-op into a 404.
  await prisma.uiPreference.deleteMany({ where: { key } });

  return c.body(null, 204);
});

export default app;
