import { OpenAPIHono, z } from '@hono/zod-openapi';
import type { Hook } from '@hono/zod-openapi';
import type { Env } from 'hono';

export const ErrorSchema = z.object({
  error: z.string(),
  details: z.any().optional().openapi({ type: 'object' }),
});

/**
 * Turn a failed Zod validation into the error body this API documents:
 * `{ error: 'Validation failed', details: [{ field, message }] }`.
 *
 * # Why this is exported rather than inlined in `app.ts`
 *
 * It was inlined there, on the root `OpenAPIHono`, and **a `defaultHook` is not
 * inherited by a mounted sub-router**. All 33 route modules were built with a
 * bare `new OpenAPIHono()`, and the root app owns almost no routes of its own —
 * so nearly every validation error in the application bypassed this and fell
 * back to the library default, which returns the raw Zod result:
 *
 *     { "success": false, "error": { "issues": [...], "name": "ZodError" } }
 *
 * That is not a cosmetic difference. `request.ts` reads `body.error` and, when
 * it is not a string, `JSON.stringify`s it into the message — so the toast a
 * user actually saw was a JSON blob. It also never found `body.details`, which
 * is the part that names the offending field.
 *
 * Found by the differential write harness on 2026-08-11: the Rust port returns
 * the documented shape everywhere, and the diff against the reference is what
 * surfaced that the reference itself almost never did.
 *
 * The remedy is `createRouter()` below rather than repeating this option object
 * 33 times — a rule that has to be restated per file is a rule that will be
 * missed by the 34th.
 */
export const validationHook: Hook<unknown, Env, string, unknown> = (result, c) => {
  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    }));
    return c.json({ error: 'Validation failed', details }, 400);
  }
  return undefined;
};

/**
 * A route module's router, with the validation hook already attached.
 *
 * Every file under `routes/` must use this instead of `new OpenAPIHono()`.
 * `app.ts` builds the root from it too, so there is exactly one definition of
 * what a rejected request looks like.
 */
export function createRouter() {
  return new OpenAPIHono({ defaultHook: validationHook });
}
