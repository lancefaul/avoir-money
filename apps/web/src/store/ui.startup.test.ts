/**
 * The real store against a slow server — the shape of the 1.0.6 bug.
 *
 * `preferenceStorage.test.ts` pins the adapter's contract. This pins the thing
 * that actually went wrong, which is an interaction: zustand wraps `setState`
 * so every change persists, its rehydrate is asynchronous, and the app writes
 * to the store during the first render. `PageHeader` sets the page title from a
 * mount effect; that is a `set()`; that is a write; and until the server has
 * answered, the state being written is the DEFAULTS.
 *
 * Measured in the packaged 1.0.6 app with nobody touching anything: backend up
 * at 12:38:49Z, stored `hiddenAccountIds` became `[]` at 12:38:51.192Z.
 *
 * Kept in its own file because it needs a fresh module registry — the store is
 * created at import time, so hydration has already happened by the time any
 * other test in this directory runs.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const list = vi.fn();
const set = vi.fn();
const remove = vi.fn();

vi.mock('../lib/api/index.js', () => ({
  api: {
    preferences: {
      list: () => list(),
      set: (k: string, v: string) => set(k, v),
      remove: (k: string) => remove(k),
    },
  },
}));

const STORED = JSON.stringify({
  state: {
    sidebarCollapsed: false,
    theme: 'empire',
    useSystemTheme: false,
    hiddenAccountIds: ['acct-1', 'acct-2', 'acct-3'],
    showAnticipations: true,
    showSnoozed: false,
  },
  version: 1,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  localStorage.clear();
  set.mockResolvedValue({ key: 'k' });
  remove.mockResolvedValue(undefined);
});

describe('the store starting up against a server that answers slowly', () => {
  it('does not persist defaults over stored settings before hydration', async () => {
    let release: (v: unknown) => void = () => {};
    list.mockReturnValue(
      new Promise((r) => {
        release = r;
      }),
    );

    // Importing creates the store, which starts hydration.
    const { useUIStore } = await import('./ui.js');

    // The first render writes to the store. This is `PageHeader`'s mount
    // effect, and it is the entire trigger — no user action involved.
    useUIStore.getState().setPageTitle('Accounts');

    // The write that would have destroyed the settings must not have gone out.
    expect(set).not.toHaveBeenCalled();

    release({ 'budget-tracker-ui': STORED });
    await vi.waitFor(() =>
      expect(useUIStore.getState().hiddenAccountIds).toEqual(['acct-1', 'acct-2', 'acct-3']),
    );

    // And nothing that DID go out may have carried the empty default.
    for (const call of set.mock.calls) {
      expect(String(call[1])).not.toContain('"hiddenAccountIds":[]');
    }
  });

  it('still persists a change made after hydration', async () => {
    // The suppression is a window, not a mode. Proving the fix did not simply
    // stop the store saving — which would pass the test above perfectly.
    list.mockResolvedValue({ 'budget-tracker-ui': STORED });

    const { useUIStore } = await import('./ui.js');
    await vi.waitFor(() => expect(useUIStore.getState().hiddenAccountIds).toHaveLength(3));

    useUIStore.getState().hideAccount('acct-4');

    await vi.waitFor(() => {
      const last = set.mock.calls.at(-1);
      expect(String(last?.[1])).toContain('acct-4');
    });
  });
});
