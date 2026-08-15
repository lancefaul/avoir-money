import { z } from 'zod';

/**
 * Interface preferences — the settings the web store persists.
 *
 * The value is an opaque string on purpose. This is the wire shape of zustand's
 * `StateStorage` (`getItem`/`setItem`/`removeItem` over a string key), so the
 * server has no opinion about what the interface stores; giving it one would
 * mean a schema change every time a checkbox appears. See ADR-042.
 */

/** Every stored preference as one flat object. `{}` when nothing is stored. */
export const PreferenceMapSchema = z.record(z.string());

/**
 * A single write. Upsert semantics — the client cannot know whether a setting
 * has been stored before without a round-trip it should not need.
 *
 * The 256 KB bound is not decoration: this is an unvalidated blob written from
 * the renderer, and an unbounded column is how a preferences table becomes a
 * place to put things. Far beyond any interface state, far below anything that
 * would strain the database.
 */
export const SetPreferenceSchema = z.object({
  key: z.string().min(1).max(200),
  value: z.string().max(256 * 1024),
});

/** What a write returns — the key it wrote, and nothing else. */
export const PreferenceKeySchema = z.object({
  key: z.string(),
});

export type PreferenceMap = z.infer<typeof PreferenceMapSchema>;
export type SetPreference = z.infer<typeof SetPreferenceSchema>;
