/**
 * The once-per-version rule.
 *
 * This is the whole reason the hook exists rather than the page toasting on
 * state: the updater re-checks every six hours and keeps reporting the same
 * available version until it is installed, so announcing on state alone would
 * fire four times a day about an update the user already chose to defer. That
 * is nagging, and nagging is precisely what `updater.js` swallows every
 * automatic failure to avoid — the rule it keeps for failures has to hold for
 * successes too.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useUpdateAnnouncement } from './useUpdateAnnouncement.js';
import { useToastStore } from '../store/toast.js';
import type { UpdateState } from './useUpdates.js';

const base: UpdateState = {
  status: 'idle',
  currentVersion: '0.9.8',
  availableVersion: null,
  percent: 0,
  lastChecked: null,
  error: null,
  installKind: 'appimage',
};

/** Stand in for the shell, which does not exist in a test renderer. */
function mockShell(state: UpdateState) {
  (globalThis as Record<string, unknown>).__AVOIR__ = {
    token: 'test',
    updates: {
      status: () => Promise.resolve(state),
      history: () => Promise.resolve([]),
      check: () => Promise.resolve(state),
      install: () => Promise.resolve(),
      onChange: () => () => {},
    },
  };
}

/**
 * Every toast headline currently in the store, oldest first.
 *
 * `title`, not `message`: `addToast(severity, message)` puts its second
 * argument into the `title` field of `ToastData`. Reading `.message` returns
 * undefined, which `toContain` reports as an argument-type error rather than a
 * mismatch — a confusing failure for a simple wrong field name.
 */
function messages(): string[] {
  // `title` is a `ReactNode`, because a toast may carry markup. Every toast
  // this hook raises is a plain string, so coercing is honest here and keeps
  // the assertions readable.
  return useToastStore.getState().toasts.map((t) => String(t.title));
}

describe('useUpdateAnnouncement', () => {
  beforeEach(() => {
    localStorage.clear();
    useToastStore.setState({ toasts: [] });
    delete (globalThis as Record<string, unknown>).__AVOIR__;
    // No spy on `addToast`. `vi.spyOn` against a Zustand store proved
    // unreliable here — `getState()` hands back the state object and
    // `setState` can replace it, so the spy either accumulates across tests or
    // stops intercepting, and the first version of this file reported two
    // failures that were entirely in the test. Asserting on the toasts the
    // store actually holds tests the thing the user sees and depends on
    // nothing about how it got there.
  });

  it('announces an available version once, not on every check', async () => {
    mockShell({ ...base, status: 'available', availableVersion: '0.9.9' });

    const first = renderHook(() => useUpdateAnnouncement());
    await waitFor(() => expect(messages()).toHaveLength(1));
    expect(messages()[0]).toContain('0.9.9');
    first.unmount();

    // A second mount is what happens six hours later, or on the next launch —
    // the state is identical and the user has already been told.
    const second = renderHook(() => useUpdateAnnouncement());
    await waitFor(() => expect(second.result.current.updateWaiting).toBe(true));
    expect(messages()).toHaveLength(1);
    second.unmount();
  });

  it('announces again when a genuinely newer version appears', async () => {
    mockShell({ ...base, status: 'available', availableVersion: '0.9.9' });
    const first = renderHook(() => useUpdateAnnouncement());
    await waitFor(() => expect(messages()).toHaveLength(1));
    first.unmount();

    // The key stores the VERSION rather than a boolean, so this is the case a
    // "have we announced?" flag would silently swallow.
    mockShell({ ...base, status: 'available', availableVersion: '0.10.0' });
    const second = renderHook(() => useUpdateAnnouncement());
    await waitFor(() => expect(messages()).toHaveLength(2));
    expect(messages()[1]).toContain('0.10.0');
    second.unmount();
  });

  it('says nothing when there is no update, and nothing without a shell', async () => {
    mockShell({ ...base, status: 'current' });
    const a = renderHook(() => useUpdateAnnouncement());
    await waitFor(() => expect(a.result.current.updateWaiting).toBe(false));
    expect(messages()).toHaveLength(0);
    a.unmount();

    // A browser: no shell at all. Distinct from an install that CAN'T update,
    // and neither should produce a toast.
    delete (globalThis as Record<string, unknown>).__AVOIR__;
    const b = renderHook(() => useUpdateAnnouncement());
    await waitFor(() => expect(b.result.current.updateWaiting).toBe(false));
    expect(messages()).toHaveLength(0);
    b.unmount();
  });

  it('keeps the dot on through downloading and ready, not just available', async () => {
    // All three mean "a newer version exists"; they differ only in how far the
    // download has got, which is the pane's business rather than the nav's.
    for (const status of ['available', 'downloading', 'ready'] as const) {
      localStorage.clear();
      mockShell({ ...base, status, availableVersion: '0.9.9' });
      const { result, unmount } = renderHook(() => useUpdateAnnouncement());
      await waitFor(() => expect(result.current.updateWaiting).toBe(true));
      unmount();
    }
  });
});
