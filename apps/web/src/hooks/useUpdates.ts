/**
 * Updater state, as the window sees it.
 *
 * # Why this is not a query hook
 *
 * Everything else in this app fetches from the backend over HTTP. This does
 * not, and the reason is structural rather than stylistic: the updater runs in
 * the **Electron shell**, because the shell is what owns the binary on disk.
 * The backend has no opinion about updates and no way to observe one. So the
 * state arrives over the preload bridge, and it is PUSHED rather than polled —
 * a download reports progress, and asking for it on a timer would be both
 * slower and noisier.
 *
 * # In a browser there is no shell
 *
 * `window.__AVOIR__.updates` is absent when the app is opened over the LAN or
 * in development. That is not an error state to recover from; it is the honest
 * answer, and the UI says so. `supported: false` is how it is reported, and it
 * is deliberately distinct from `status: 'unsupported'`, which means the shell
 * IS present and has told us this install can never self-update — a pacman
 * install, where `/opt` belongs to the package manager. Those two look similar
 * and need different words on screen.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { mockUpdatesBridge } from './updatesMock.js';

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'current'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'error'
  | 'unsupported';

export interface UpdateState {
  status: UpdateStatus;
  currentVersion: string | null;
  availableVersion: string | null;
  percent: number;
  lastChecked: string | null;
  error: string | null;
  /** How this copy was installed — decides whether it can replace itself. */
  installKind: 'appimage' | 'package' | 'development';
}

export interface UpdateHistoryEntry {
  from: string;
  to: string;
  at: string;
  status: 'installed' | 'pending-restart';
}

interface UpdatesBridge {
  status: () => Promise<UpdateState>;
  history: () => Promise<UpdateHistoryEntry[]>;
  check: () => Promise<UpdateState>;
  install: () => Promise<void>;
  onChange: (fn: (s: UpdateState) => void) => () => void;
}

/**
 * The bridge, or undefined in a browser.
 *
 * In DEVELOPMENT a `?updates=…` query parameter substitutes a fake one, so the
 * states that need a real published release — downloading, ready, error — can
 * be looked at without publishing anything. See `updatesMock.ts`.
 *
 * `import.meta.env.DEV` is replaced with a literal `false` in a production
 * build, so this branch and the module behind it are removed entirely rather
 * than merely unreachable.
 */
function bridge(): UpdatesBridge | undefined {
  if (import.meta.env.DEV) {
    const mock = mockUpdatesBridge();
    if (mock) return mock;
  }
  return (globalThis as { __AVOIR__?: { updates?: UpdatesBridge } }).__AVOIR__?.updates;
}

export interface UseUpdates {
  supported: boolean;
  state: UpdateState | null;
  history: UpdateHistoryEntry[];
  /** True while a manual check is in flight, so the button can say so. */
  checking: boolean;
  check: () => Promise<void>;
  install: () => Promise<void>;
}

const ABSENT: UpdateState = {
  status: 'unsupported',
  currentVersion: null,
  availableVersion: null,
  percent: 0,
  lastChecked: null,
  error: null,
  installKind: 'development',
};

export function useUpdates(): UseUpdates {
  // Captured in the effect, NOT recomputed each render.
  //
  // It used to call `updatesSupported()` on every render, which re-reads the
  // URL — while `state` is resolved once on mount. The two then disagree the
  // moment the URL changes underneath them: the router normalises away a
  // `?updates=` parameter after mount, `supported` flips to false while `state`
  // still holds the state it resolved, and the page renders its "you are
  // viewing this in a browser" branch over a perfectly good mocked state.
  //
  // The real bridge cannot appear or vanish mid-session either, so reading it
  // repeatedly was never buying anything — it was only creating a way for two
  // answers to the same question to drift apart.
  const [supported, setSupported] = useState(false);
  const [state, setState] = useState<UpdateState | null>(null);
  const [history, setHistory] = useState<UpdateHistoryEntry[]>([]);
  const [checking, setChecking] = useState(false);
  // The same instance every consumer uses, for the same reason `supported` is
  // captured: `check` and `install` re-reading the URL could resolve a
  // different bridge — or none — than the one that produced the state on screen.
  const api = useRef<UpdatesBridge | undefined>(undefined);

  useEffect(() => {
    api.current = bridge();
    setSupported(Boolean(api.current));
    if (!api.current) {
      setState(ABSENT);
      return;
    }
    const b = api.current;
    let alive = true;
    // Both: the first read fills the pane immediately, the subscription keeps
    // it live through a download without polling.
    void b.status().then((s) => alive && setState(s));
    void b.history().then((h) => alive && setHistory(h));
    const stop = b.onChange((s) => alive && setState(s));
    return () => {
      alive = false;
      stop();
    };
  }, []);

  const check = useCallback(async () => {
    const b = api.current;
    if (!b) return;
    setChecking(true);
    try {
      // The resolved state carries any error. `check` never rejects — the
      // shell converts a failure into state rather than an exception, because
      // an Error crossing IPC arrives as a string with a mangled stack, and
      // "what is the state now" is the better question anyway.
      setState(await b.check());
    } finally {
      setChecking(false);
    }
  }, []);

  const install = useCallback(async () => {
    await api.current?.install();
  }, []);

  return { supported, state, history, checking, check, install };
}
