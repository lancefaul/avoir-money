/**
 * Where interface preferences live — the server, not localStorage.
 *
 * # Why localStorage could never work here
 *
 * Chromium keys localStorage by ORIGIN, and the origin includes the port. The
 * backend binds `127.0.0.1:0`, so the OS picks a fresh port every launch — a
 * deliberate choice (ADR-036: a port that is not guessable across launches, and
 * a desktop app that cannot fail to start because something else holds a
 * number). The consequence is that every launch opens a brand-new, empty store.
 *
 * Measured, not inferred: **58 distinct origins** had accumulated in the
 * Electron profile by 2026-08-14, one per launch, each holding the settings of
 * the session that wrote it.
 *
 * The write was always correct. Only the read went somewhere new — which is why
 * this reads like a persistence bug and is really an addressing one.
 *
 * # Why the failure was nearly invisible
 *
 * Six settings persist, and five reset to values that happened to match the
 * owner's choices; the default theme is the one they had picked. Only
 * `hiddenAccountIds` had a default (`[]`) that differed from their state, so it
 * was the only visible symptom of a total loss.
 *
 * # The browser build uses this too, on purpose
 *
 * ADR-036 collapsed the desktop and browser onto one transport specifically so
 * a divergence between them could not be expressed. Persisting through the API
 * keeps that: both builds read and write the same place, and preferences follow
 * the data through backup, export and reinstall rather than living in whichever
 * browser profile happened to be open.
 */

import { api } from '../lib/api/index.js';

/**
 * The whole preference map, fetched once.
 *
 * zustand's `StateStorage.getItem` is called synchronously-ish per key during
 * rehydration, and a round-trip per key would be a request per setting on every
 * launch. One fetch fills this, and every `getItem` reads from it.
 */
let cache: Record<string, string> | null = null;
let inflight: Promise<Record<string, string>> | null = null;

async function load(): Promise<Record<string, string>> {
  if (cache) return cache;
  if (!inflight) {
    inflight = api.preferences
      .list()
      .then((data) => {
        cache = data;
        return data;
      })
      .catch((err) => {
        /*
         * A failed read must not wedge the app. Preferences are how the page
         * looks, not what it can do, so falling back to defaults is the correct
         * degradation — but it is reported rather than swallowed, because a
         * silent fallback here is indistinguishable from the bug this file
         * exists to fix.
         */
        console.error('[preferences] could not load; using defaults', err);
        cache = {};
        return cache;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/**
 * A zustand `StateStorage` backed by the API.
 *
 * `setItem` deliberately does not await the write before returning. zustand
 * calls it on every state change, and blocking the store's update on a network
 * round-trip would make the UI wait for the server to acknowledge a checkbox.
 * The local cache is updated first so a read-after-write is consistent even if
 * the request is still in flight.
 */
export const serverPreferenceStorage = {
  getItem: async (name: string): Promise<string | null> => {
    const all = await load();
    const stored = all[name];
    if (stored !== undefined) return stored;

    /*
     * One-time adoption from localStorage.
     *
     * This helps exactly one group and it is worth being precise about which,
     * because it is easy to assume it rescues the desktop and it does not: the
     * desktop's origin changes every launch, so by the time this build runs its
     * localStorage is already a fresh empty one and the old settings are
     * unreachable from inside the page. Those have to be set again.
     *
     * Who it does help is anyone on a STABLE origin — the browser build over
     * the LAN at budget.local, or a dev server on a fixed port. Their
     * localStorage really does still hold their settings, and without this they
     * would silently start over on upgrade.
     */
    try {
      const legacy = globalThis.localStorage?.getItem(name);
      if (legacy != null) {
        all[name] = legacy;
        void api.preferences.set(name, legacy).catch(() => {
          // Adoption is opportunistic. Failing it must not break a launch, and
          // the next write attempt will carry the value anyway.
        });
        return legacy;
      }
    } catch {
      // localStorage can throw outright when storage is disabled. Not having a
      // legacy value is the ordinary case, so this is not worth reporting.
    }
    return null;
  },

  setItem: async (name: string, value: string): Promise<void> => {
    // Cache first, and synchronously, so a read immediately after a write sees
    // the new value even while the request is still in flight.
    if (cache) cache[name] = value;
    else cache = { [name]: value };

    // Deliberately NOT awaited. zustand calls this on every state change, and
    // resolving only once the server has acknowledged would tie the store's
    // completion to a network round-trip for something as small as a checkbox.
    // The failure path still reports — reported and not awaited, rather than
    // swallowed, because a silent write failure here is indistinguishable from
    // the bug this file exists to fix.
    void api.preferences.set(name, value).catch((err: unknown) => {
      console.error('[preferences] could not save', name, err);
    });
  },

  removeItem: async (name: string): Promise<void> => {
    if (cache) delete cache[name];
    void api.preferences.remove(name).catch((err: unknown) => {
      console.error('[preferences] could not remove', name, err);
    });
  },
};

/** Test-only: drop the cache so each test starts from a known state. */
export function __resetPreferenceCache(): void {
  cache = null;
  inflight = null;
}
