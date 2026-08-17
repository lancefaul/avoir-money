/**
 * Preferences persist through the API, not localStorage.
 *
 * localStorage is keyed by origin and the origin includes the port, which the
 * backend re-picks every launch (ADR-036). So every launch opened an empty
 * store and all six persisted settings reset — visible only through
 * `hiddenAccountIds`, the one whose default differed from the user's state.
 *
 * The test that matters most is the last one: this adapter must NOT touch
 * localStorage, because a fallback would restore the original bug on exactly
 * the path nobody would think to check again.
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

const { serverPreferenceStorage, __resetPreferenceCache } = await import('./preferenceStorage.js');

beforeEach(() => {
  vi.clearAllMocks();
  __resetPreferenceCache();
  localStorage.clear();
  list.mockResolvedValue({});
  set.mockResolvedValue({ key: 'k' });
  remove.mockResolvedValue(undefined);
});

describe('serverPreferenceStorage', () => {
  it('reads a key the server already holds', async () => {
    list.mockResolvedValue({ 'budget-tracker-ui': '{"state":{"hiddenAccountIds":["a1"]}}' });
    expect(await serverPreferenceStorage.getItem('budget-tracker-ui')).toContain('a1');
  });

  it('returns null for a key that was never written', async () => {
    expect(await serverPreferenceStorage.getItem('nope')).toBeNull();
  });

  it('fetches once however many keys are read', async () => {
    // zustand reads per key on rehydrate; a request each would be a burst of
    // identical calls on every launch.
    await Promise.all([
      serverPreferenceStorage.getItem('a'),
      serverPreferenceStorage.getItem('b'),
      serverPreferenceStorage.getItem('c'),
    ]);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('writes through to the server', async () => {
    await serverPreferenceStorage.setItem('budget-tracker-ui', '{"state":{}}');
    expect(set).toHaveBeenCalledWith('budget-tracker-ui', '{"state":{}}');
  });

  it('reads back what it just wrote, before the request settles', async () => {
    let release: (v: unknown) => void = () => {};
    set.mockReturnValue(
      new Promise((r) => {
        release = r;
      }),
    );
    await serverPreferenceStorage.setItem('k', 'v');
    expect(await serverPreferenceStorage.getItem('k')).toBe('v');
    release(undefined);
  });

  it('falls back to defaults when the server cannot be reached, and says so', async () => {
    // Preferences are how the page looks, not what it can do, so degrading is
    // right. Degrading SILENTLY is not: that is indistinguishable from the bug
    // this file exists to fix.
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    list.mockRejectedValue(new Error('offline'));
    expect(await serverPreferenceStorage.getItem('anything')).toBeNull();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it('never WRITES localStorage — that is where persistence used to leak away', async () => {
    // The regression guard. Reading localStorage is allowed and deliberate
    // (adoption, below); writing it would put persistence back in the
    // per-origin store the port change wipes, on the one path nobody would
    // think to re-check.
    const setSpy = vi.spyOn(Storage.prototype, 'setItem');
    await serverPreferenceStorage.setItem('k', 'v');
    await serverPreferenceStorage.getItem('k');
    await serverPreferenceStorage.removeItem('k');
    expect(setSpy).not.toHaveBeenCalled();
    setSpy.mockRestore();
  });

  describe('adoption from localStorage', () => {
    it('adopts a legacy value when the server has none, and writes it through', async () => {
      // Who this helps: a STABLE origin — the browser build at budget.local, or
      // a dev server on a fixed port — whose localStorage really does still
      // hold their settings.
      localStorage.setItem('budget-tracker-ui', '{"state":{"theme":"empire"}}');
      const got = await serverPreferenceStorage.getItem('budget-tracker-ui');
      expect(got).toContain('empire');
      expect(set).toHaveBeenCalledWith('budget-tracker-ui', '{"state":{"theme":"empire"}}');
    });

    it('prefers the server over a stale legacy value', async () => {
      // Once the server holds a value it is the truth; a leftover blob from
      // before the move must not overwrite newer settings.
      list.mockResolvedValue({ 'budget-tracker-ui': 'from-server' });
      localStorage.setItem('budget-tracker-ui', 'from-localstorage');
      expect(await serverPreferenceStorage.getItem('budget-tracker-ui')).toBe('from-server');
      expect(set).not.toHaveBeenCalled();
    });

    it('does not invent a value when neither side has one', async () => {
      expect(await serverPreferenceStorage.getItem('budget-tracker-ui')).toBeNull();
      expect(set).not.toHaveBeenCalled();
    });
  });

  describe('the startup window', () => {
    /**
     * zustand wraps `setState` so EVERY state change persists, and its
     * rehydrate is asynchronous. So between the store being created and the
     * server's answer arriving, the store still holds DEFAULTS — and anything
     * that writes in that window writes the defaults over the user's real
     * settings.
     *
     * Nothing exotic triggers it. `PageHeader` sets the page title from a
     * mount effect, which is a `set()`, which is a write. Measured in the
     * packaged 1.0.6 app: the backend started at 12:38:49Z and the stored
     * `hiddenAccountIds` became `[]` at 12:38:51.192Z, 2.3 seconds later,
     * without the user touching anything.
     *
     * This is why the bug looked like it survived "open and close" but not a
     * restart: reopening a window reuses the hydrated store, and only a fresh
     * launch runs the race.
     */
    it('does not write while the initial read is still in flight', async () => {
      let release: (v: unknown) => void = () => {};
      list.mockReturnValue(
        new Promise((r) => {
          release = r;
        }),
      );

      // Hydration begins — the store asks the server what it holds.
      const reading = serverPreferenceStorage.getItem('budget-tracker-ui');

      // A mount effect fires before the answer arrives. The store still holds
      // defaults, so this is a write of `hiddenAccountIds: []`.
      await serverPreferenceStorage.setItem(
        'budget-tracker-ui',
        '{"state":{"hiddenAccountIds":[]},"version":1}',
      );

      expect(set).not.toHaveBeenCalled();

      release({ 'budget-tracker-ui': '{"state":{"hiddenAccountIds":["a1"]},"version":1}' });
      await reading;
    });

    it('writes again once the read has settled', async () => {
      // The suppression is a window, not a mode. A user changing a setting a
      // moment later must still persist it.
      await serverPreferenceStorage.getItem('budget-tracker-ui');
      await serverPreferenceStorage.setItem('budget-tracker-ui', '{"state":{}}');
      expect(set).toHaveBeenCalledWith('budget-tracker-ui', '{"state":{}}');
    });

    it('does not let a suppressed write shadow the value the server returns', async () => {
      /*
       * The first version of this fix cached the suppressed write, which felt
       * harmless — it was only being held back from the network. It was not
       * harmless: the cache is what hydration reads, so the default parked
       * under that key was served straight back to the store and it rehydrated
       * from the very value being suppressed. The settings still vanished, one
       * layer further in, with the network write correctly withheld.
       */
      let release: (v: unknown) => void = () => {};
      list.mockReturnValue(
        new Promise((r) => {
          release = r;
        }),
      );

      const reading = serverPreferenceStorage.getItem('budget-tracker-ui');
      await serverPreferenceStorage.setItem(
        'budget-tracker-ui',
        '{"state":{"hiddenAccountIds":[]},"version":1}',
      );
      release({ 'budget-tracker-ui': '{"state":{"hiddenAccountIds":["a1"]},"version":1}' });

      expect(await reading).toContain('a1');
    });

    it('does not suppress a write when no read was ever started', async () => {
      // Guards the fix against over-reach: outside the store's lifecycle there
      // is no hydration to lose a race with, and a write must not vanish.
      await serverPreferenceStorage.setItem('k', 'v');
      expect(set).toHaveBeenCalledWith('k', 'v');
    });
  });
});
