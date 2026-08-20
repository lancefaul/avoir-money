/**
 * The other half of the deferred refresh check.
 *
 * `useWindowControls` records the request and reloads; this is the fresh
 * renderer honouring it. Two hooks, two files, one flag between them — so both
 * ends need their own test, because a typo on either side fails silently and
 * the visible behaviour (the page reloads) is unchanged either way.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useUpdates } from './useUpdates.js';
import { CHECK_ON_LOAD } from './useWindowControls.js';
import { useToastStore } from '../store/toast.js';

const check = vi.fn();
const state = {
  status: 'current',
  currentVersion: '1.0.10',
  availableVersion: null,
  percent: 0,
  error: null,
  lastChecked: null,
  installKind: 'appimage',
};

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  useToastStore.setState({ toasts: [] });
  check.mockResolvedValue(state);
  Object.defineProperty(globalThis, '__AVOIR__', {
    value: {
      updates: {
        status: () => Promise.resolve(state),
        history: () => Promise.resolve([]),
        check,
        download: () => Promise.resolve(state),
        install: () => Promise.resolve(),
        onChange: () => () => {},
      },
    },
    configurable: true,
    writable: true,
  });
});

describe('a check requested before the reload', () => {
  it('runs once the fresh renderer mounts', async () => {
    sessionStorage.setItem(CHECK_ON_LOAD, '1');
    renderHook(() => useUpdates());
    await waitFor(() => expect(check).toHaveBeenCalledTimes(1));
  });

  it('clears the request so it cannot fire again', async () => {
    sessionStorage.setItem(CHECK_ON_LOAD, '1');
    renderHook(() => useUpdates());
    await waitFor(() => expect(check).toHaveBeenCalled());
    // Cleared BEFORE the check runs, so a throw mid-flight cannot leave a
    // self-perpetuating request behind — a worse bug than a missed check.
    expect(sessionStorage.getItem(CHECK_ON_LOAD)).toBeNull();
  });

  it('does not check on an ordinary launch', async () => {
    // No flag: the app opening must not behave like Refresh was pressed. The
    // shell already checks 30s after launch, and duplicating it here would
    // double every start-up request.
    renderHook(() => useUpdates());
    await new Promise((r) => setTimeout(r, 30));
    expect(check).not.toHaveBeenCalled();
  });
});

describe('what a refresh-triggered check says', () => {
  it('says nothing when the check succeeds', async () => {
    // Refresh is pressed to reload the page; the check rides along. A toast on
    // every press is noise attached to an action taken for another reason.
    sessionStorage.setItem(CHECK_ON_LOAD, '1');
    renderHook(() => useUpdates());
    await waitFor(() => expect(check).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('reports a failure, because silence there reads as "up to date"', async () => {
    check.mockResolvedValue({ ...state, status: 'error', error: 'net::ERR_INTERNET_DISCONNECTED' });
    sessionStorage.setItem(CHECK_ON_LOAD, '1');
    renderHook(() => useUpdates());

    await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1));
    const t = useToastStore.getState().toasts[0]!;
    expect(t.severity).toBe('error');
    expect(t.description).toContain('ERR_INTERNET_DISCONNECTED');
  });

  it('says nothing on an ordinary launch, even when the last check failed', async () => {
    // No flag: nobody asked, so a stale error must not surface as a toast. That
    // is the automatic contract, and it is why the failure is only reported on
    // the path where a person just pressed something.
    check.mockResolvedValue({ ...state, status: 'error', error: 'offline' });
    renderHook(() => useUpdates());
    await new Promise((r) => setTimeout(r, 30));
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});
