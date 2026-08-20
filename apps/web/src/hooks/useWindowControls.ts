/**
 * Minimise, maximise and close, for a window that has no system title bar.
 *
 * # Why this is not a query hook
 *
 * Same reason as `useUpdates`: the backend has no opinion about the window and
 * no way to observe it. The window belongs to the **Electron shell**, so the
 * state arrives over the preload bridge, and the maximised flag is PUSHED
 * rather than polled — the button is not the only thing that maximises a window
 * (a keyboard shortcut, a double-click on the drag region, a tiling shortcut,
 * or a restored session all do it), so asking on a timer would show a stale
 * glyph for up to one interval every time.
 *
 * # In a browser there is no window to control
 *
 * `window.__AVOIR__.windowControls` is absent when the app is opened over the
 * LAN or in development, and a browser tab has nothing to minimise. That is not
 * an error state; `supported: false` is the answer, and the title bar simply is
 * not drawn — leaving the browser's own chrome to do its job.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Set by Refresh, read once by the fresh renderer. Exported so the reader and
 * the writer cannot drift — a typo on either side would fail silently, which is
 * the failure mode this whole change exists to avoid.
 */
export const CHECK_ON_LOAD = 'avoir.checkForUpdatesOnLoad';

interface WindowControlsBridge {
  minimize: () => Promise<void>;
  toggleMaximize: () => Promise<boolean>;
  close: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
  onMaximizeChange: (fn: (maximized: boolean) => void) => () => void;
}

function bridge(): WindowControlsBridge | undefined {
  return (globalThis as { __AVOIR__?: { windowControls?: WindowControlsBridge } }).__AVOIR__
    ?.windowControls;
}

export interface UseWindowControls {
  /** Whether there is a native window here at all. False in any browser. */
  supported: boolean;
  maximized: boolean;
  minimize: () => void;
  toggleMaximize: () => void;
  close: () => void;
  /** Reload the page — everything refetches. Deliberately NOT over the bridge. */
  reload: () => void;
}

export function useWindowControls(): UseWindowControls {
  /*
   * Captured in the effect, NOT recomputed each render.
   *
   * This is the shape `useUpdates` had to be corrected into: it read the bridge
   * on every render while its state resolved once on mount, so the two drifted
   * and the page rendered its "no shell" branch over a perfectly good state.
   * The bridge cannot appear or vanish mid-session, so reading it repeatedly
   * buys nothing and only creates a way for two answers to disagree.
   */
  const [supported, setSupported] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const api = useRef<WindowControlsBridge | undefined>(undefined);

  useEffect(() => {
    api.current = bridge();
    setSupported(Boolean(api.current));
    const b = api.current;
    if (!b) return;

    let alive = true;
    // Both: the first read is right at paint, the subscription keeps it right
    // through every later change the app did not initiate.
    void b.isMaximized().then((m) => alive && setMaximized(m));
    const stop = b.onMaximizeChange((m) => alive && setMaximized(m));
    return () => {
      alive = false;
      stop();
    };
  }, []);

  const minimize = useCallback(() => void api.current?.minimize(), []);
  const close = useCallback(() => void api.current?.close(), []);

  /*
   * The one control here that does NOT go through the preload bridge, and the
   * omission is the point.
   *
   * Minimise, maximise and close are operations on a native window, which the
   * page has no other way to reach — that is why the bridge exists. Reloading
   * is not: a page has always been able to reload itself, so routing it through
   * IPC would add a named channel to a surface documented as "named operations
   * only" in exchange for nothing. `webContents.reload()` would differ only if
   * the renderer were wedged, and a wedged renderer cannot deliver the click
   * that would call it.
   */
  const reload = useCallback(() => {
    /*
     * Refresh also asks whether there is an update. Added 2026-08-20 at the
     * owner's request: the alternative was Settings → Software Updates → Check
     * for updates, three clicks to answer a question this button is already the
     * natural place to ask.
     *
     * The request is RECORDED here and fired after the reload, not before it.
     * The first version called the bridge and then reloaded a line later, which
     * asks whether an IPC message survives its renderer being torn down
     * milliseconds afterwards — a question with no good answer, since a message
     * that is silently dropped leaves a feature that silently does nothing.
     * Deferring removes the question rather than betting on it.
     *
     * It also makes the check a genuine MANUAL one. Fired from the fresh
     * renderer, its result can be reported the way any user-initiated check is,
     * instead of degrading to the silent automatic contract because the page
     * that asked no longer exists.
     *
     * `sessionStorage`, deliberately, and it is not the mistake ADR-042
     * records: that was localStorage keyed by an origin whose port changes
     * every launch, so settings vanished between runs. Here the flag must
     * survive exactly one reload of the same origin and must NOT survive a
     * relaunch — which is precisely what sessionStorage does.
     */
    try {
      globalThis.sessionStorage?.setItem(CHECK_ON_LOAD, '1');
    } catch {
      // Storage can be disabled outright. Losing the check is the correct
      // degradation — the reload still happens, which is what was clicked.
    }
    window.location.reload();
  }, []);

  const toggleMaximize = useCallback(() => {
    /*
     * The resolved value is applied as well as the pushed event, and neither is
     * redundant. The event is the one that catches a maximise the app did not
     * cause; the resolved value is the one that still arrives if a compositor
     * declines to emit `maximize` — which is the sort of thing that varies by
     * desktop and would otherwise leave the glyph stuck pointing the wrong way
     * with no other symptom.
     */
    void api.current?.toggleMaximize().then((m) => setMaximized(m));
  }, []);

  return { supported, maximized, minimize, toggleMaximize, close, reload };
}
