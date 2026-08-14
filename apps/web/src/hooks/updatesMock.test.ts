/**
 * The dev mock maps each `?updates=` value to the state it claims.
 *
 * Worth testing despite being development-only: its whole purpose is to let
 * someone look at a layout and judge it, and a mock that quietly reports the
 * wrong state sends them to fix a screen that was never broken. It is also the
 * only place the `package` vs browser distinction can be exercised at all,
 * since one needs an Electron shell and the other needs its absence.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useUpdates } from './useUpdates.js';
import { mockUpdatesBridge } from './updatesMock.js';

function at(search: string) {
  window.history.replaceState({}, '', search);
  return mockUpdatesBridge();
}

/**
 * `at` for the cases that require a bridge.
 *
 * Throws rather than `!`, so a URL that stops producing one fails here with a
 * readable message instead of somewhere downstream as "cannot read status of
 * undefined".
 */
function must(search: string) {
  const b = at(search);
  if (!b) throw new Error(`expected a mock bridge for ${search}`);
  return b;
}

afterEach(() => window.history.replaceState({}, '', '/'));

describe('useUpdates + the mock', () => {
  it('keeps `supported` and `state` agreeing after the URL changes', async () => {
    // The bug this replaces: `supported` was recomputed every render from a
    // fresh URL read while `state` was resolved once on mount. When the router
    // normalised `?updates=` away after mount, `supported` flipped to false
    // with `state` still holding the mocked value — and the page rendered its
    // "you are viewing this in a browser" branch over a perfectly good state.
    window.history.replaceState({}, '', '/settings?updates=available');
    const { result, rerender } = renderHook(() => useUpdates());
    await waitFor(() => expect(result.current.state).not.toBeNull());
    expect(result.current.supported).toBe(true);
    expect(result.current.state?.status).toBe('available');

    // The param goes away, as a router navigation would take it.
    window.history.replaceState({}, '', '/settings');
    rerender();
    expect(result.current.supported).toBe(true);
    expect(result.current.state?.status).toBe('available');
  });
});

describe('mockUpdatesBridge', () => {
  it('is absent without the parameter, so the real bridge is used', () => {
    expect(at('/')).toBeUndefined();
    expect(at('/?other=1')).toBeUndefined();
  });

  it('maps each status, and only offers a version where one makes sense', async () => {
    for (const status of ['checking', 'current', 'available', 'downloading', 'ready', 'error']) {
      const s = await must(`/?updates=${status}`).status();
      expect(s.status).toBe(status);
      // `availableVersion` is what the page prints in its headline sentence, so
      // a state claiming one it should not have would read as an update waiting
      // when none is.
      const shouldHave = ['available', 'downloading', 'ready'].includes(status);
      expect(s.availableVersion === null).toBe(!shouldHave);
    }
  });

  it('reports a package install as unsupported, which is not the same as no shell', async () => {
    const s = await must('/?updates=package').status();
    expect(s.status).toBe('unsupported');
    expect(s.installKind).toBe('package');
  });

  it('carries an error only in the error state', async () => {
    expect((await must('/?updates=error').status()).error).toBeTruthy();
    expect((await must('/?updates=current').status()).error).toBeNull();
  });

  it('takes a download percentage from the URL', async () => {
    expect((await must('/?updates=downloading&percent=7').status()).percent).toBe(7);
    // Default, so the progress bar is visibly mid-way rather than at zero.
    expect((await must('/?updates=downloading').status()).percent).toBe(42);
  });

  it('refuses an unrecognised value instead of showing a plausible wrong screen', () => {
    // It used to fall through to `status: 'unsupported'` with
    // `installKind: 'appimage'` — a combination the real bridge cannot produce,
    // which rendered as "No check has run yet" and looked fine. Returning
    // undefined makes a typo behave as if the parameter were absent.
    expect(at('/?updates=downloadng')).toBeUndefined();
    expect(at('/?updates=')).toBeUndefined();
  });

  it('bounds the numbers a URL can supply', async () => {
    // `?history=99999` would build and render every row and hang the page.
    expect(await must('/?updates=current&history=99999').history()).toHaveLength(20);
    expect(await must('/?updates=current&history=-3').history()).toHaveLength(0);
    expect((await must('/?updates=downloading&percent=999').status()).percent).toBe(100);
    expect((await must('/?updates=downloading&percent=-5').status()).percent).toBe(0);
    // Non-numeric falls back rather than becoming NaN in a progress bar.
    expect((await must('/?updates=downloading&percent=abc').status()).percent).toBe(42);
  });

  it('fabricates history newest-first, and none by default', async () => {
    expect(await must('/?updates=current').history()).toHaveLength(0);
    const [first, second, third] = await must('/?updates=current&history=3').history();
    // Destructured rather than indexed: `noUncheckedIndexedAccess` types every
    // element as possibly undefined, and asserting each one is what proves the
    // length as a side effect.
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(third).toBeDefined();
    expect(new Date(first!.at).getTime()).toBeGreaterThan(new Date(third!.at).getTime());
    // Each entry upgrades FROM the previous version TO its own, so the list
    // reads as a chain rather than three unrelated rows.
    expect(first!.to).toBe('0.9.0');
    expect(second!.to).toBe('0.8.0');
  });
});
