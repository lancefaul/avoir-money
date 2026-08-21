/**
 * Refresh reloads the page AND asks whether there is an update.
 *
 * The ordering is the whole test. The check has to be fired BEFORE
 * `location.reload()` and must not be awaited: it runs in the main process, so
 * it survives the renderer being torn down, and its answer reaches the fresh
 * renderer through the state push. Awaiting it would hold the reload open for a
 * network round-trip.
 *
 * A regression here is silent in the worst way — the button would still reload,
 * which is what anyone clicking it is watching for, while the update check it
 * exists to piggyback on quietly stopped happening.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWindowControls, CHECK_ON_LOAD } from './useWindowControls.js';

const reload = vi.fn();
const check = vi.fn();
let setItemSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  sessionStorage.clear();
  setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
  Object.defineProperty(globalThis, '__AVOIR__', {
    value: {
      updates: { check },
      windowControls: {
        minimize: vi.fn(),
        toggleMaximize: vi.fn(),
        close: vi.fn(),
        isMaximized: () => Promise.resolve(false),
        onMaximizeChange: () => () => {},
      },
    },
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'location', {
    value: { reload },
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  delete (globalThis as { __AVOIR__?: unknown }).__AVOIR__;
});

describe('refresh', () => {
  it('records the check request, then reloads', () => {
    const { result } = renderHook(() => useWindowControls());
    act(() => result.current.reload());

    expect(sessionStorage.getItem(CHECK_ON_LOAD)).toBe('1');
    expect(reload).toHaveBeenCalledTimes(1);

    // Recorded BEFORE the reload. Written afterwards it would never be written
    // at all, and asserting only that both happened would pass against that.
    expect(setItemSpy.mock.invocationCallOrder[0]).toBeLessThan(
      reload.mock.invocationCallOrder[0]!,
    );
  });

  it('does not call the updates bridge directly', () => {
    // The whole point of deferring: firing here asks whether an IPC message
    // survives its renderer being destroyed a millisecond later.
    const { result } = renderHook(() => useWindowControls());
    act(() => result.current.reload());
    expect(check).not.toHaveBeenCalled();
  });

  it('still reloads when storage is unavailable', () => {
    // Storage can be disabled outright. Losing the check is the correct
    // degradation; losing the reload is not — that is what was clicked.
    setItemSpy.mockImplementation(() => {
      throw new Error('storage disabled');
    });
    const { result } = renderHook(() => useWindowControls());
    act(() => result.current.reload());
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('still reloads in a browser, where there is no shell', () => {
    delete (globalThis as { __AVOIR__?: unknown }).__AVOIR__;
    const { result } = renderHook(() => useWindowControls());
    act(() => result.current.reload());
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
