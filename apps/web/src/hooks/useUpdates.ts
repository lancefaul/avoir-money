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
import { CHECK_ON_LOAD } from './useWindowControls.js';
import { useToastStore } from '../store/toast.js';

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
  download: () => Promise<UpdateState>;
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
  check: () => Promise<UpdateState | undefined>;
  /** Fetch an update a check has found. Separate action, separate cost. */
  download: () => Promise<void>;
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
      //
      // Returned as well as stored, so a caller can act on the OUTCOME of the
      // check it asked for. Reading `state` afterwards would race the setter
      // and give the caller whatever was there before.
      const next = await b.check();
      setState(next);
      return next;
    } finally {
      setChecking(false);
    }
  }, []);

  /*
   * Honour a check requested by Refresh before the page reloaded.
   *
   * The flag is cleared BEFORE the check runs, not after. A check that throws
   * or a reload that happens mid-flight would otherwise leave the request set
   * and fire again on the next load, and a self-perpetuating background request
   * is a far worse bug than a missed one.
   *
   * Runs once on mount, deliberately after `api.current` is resolved by the
   * effect above — a browser has no bridge, and there the flag can never have
   * been set anyway.
   */
  useEffect(() => {
    let requested = false;
    try {
      requested = globalThis.sessionStorage?.getItem(CHECK_ON_LOAD) === '1';
      if (requested) globalThis.sessionStorage.removeItem(CHECK_ON_LOAD);
    } catch {
      // Storage disabled: nothing was recorded, so there is nothing to honour.
    }
    if (!requested) return;

    /*
     * Report FAILURES only.
     *
     * A user-initiated check normally owes an answer either way, including "you
     * are already up to date" — that is the contract the Settings button keeps.
     * This one is different because of what the button IS: Refresh is pressed
     * to reload the page, and the update check rides along. A toast on every
     * press would be noise attached to an action taken for another reason,
     * which is how a useful signal gets trained out of someone.
     *
     * A failure still speaks, because silence there is indistinguishable from
     * being current — and someone who just asked deserves to know the answer
     * was "could not tell you" rather than "no".
     */
    void check().then((s) => {
      if (s?.status === 'error' && s.error) {
        useToastStore
          .getState()
          .addToast('error', 'Could not check for updates', { description: s.error });
      }
    });
  }, [check]);

  const download = useCallback(async () => {
    const b = api.current;
    if (!b) return;
    // Progress arrives by push while this is in flight, so the resolved state
    // is only the final word — the UI is already following `percent`.
    setState(await b.download());
  }, []);

  const install = useCallback(async () => {
    await api.current?.install();
  }, []);

  return { supported, state, history, checking, check, download, install };
}
