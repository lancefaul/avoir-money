/**
 * A fake updater, for looking at states that are otherwise unreachable.
 *
 * # Why this has to exist
 *
 * Every state on the Software Updates page depends on a real release existing
 * somewhere. Seeing "downloading, 42%" honestly means publishing two versions,
 * installing the older AppImage, and catching the moment — for a progress bar.
 * "Error" means breaking a manifest on purpose. And in a browser there is no
 * shell at all, so the page can only ever show its third state.
 *
 * So the states are driven from the URL instead:
 *
 *   ?updates=available            a newer version is waiting
 *   ?updates=downloading&percent=42
 *   ?updates=ready                downloaded, restart to install
 *   ?updates=current              up to date
 *   ?updates=error                the last check failed
 *   ?updates=checking
 *   ?updates=package              a pacman install, which can never self-update
 *   &history=3                    three past updates, newest first
 *
 * Nothing else changes. It installs the same `window.__AVOIR__.updates` shape
 * the preload bridge does, so the page, the toast and the nav dot are all
 * exercising their real code paths against a different source of truth.
 *
 * # Why it cannot reach production
 *
 * The only caller guards on `import.meta.env.DEV`, which Vite replaces with a
 * literal `false` in a production build — so the branch, this module, and every
 * string in it are removed by dead-code elimination. Verified by grepping the
 * built bundle rather than assuming, because "the bundler will strip it" is
 * exactly the kind of belief that ships a debug backdoor.
 */

import type { UpdateState, UpdateHistoryEntry } from './useUpdates.js';

const STATUSES = [
  'idle',
  'checking',
  'current',
  'available',
  'downloading',
  'ready',
  'error',
] as const;

type Mockable = (typeof STATUSES)[number] | 'package';

/** A finite number within range, or the fallback. Handles NaN, empty and negatives. */
function clamp(v: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(v)));
}

function fakeHistory(n: number): UpdateHistoryEntry[] {
  // Newest first, walking backwards through plausible versions and days.
  return Array.from({ length: n }, (_, i) => {
    const minor = 9 - i;
    const at = new Date(Date.now() - (i + 1) * 86_400_000 * 9).toISOString();
    return {
      from: `0.${minor - 1}.0`,
      to: `0.${minor}.0`,
      at,
      status: 'installed' as const,
    };
  });
}

/**
 * The mock bridge for this page load, or `undefined` when no `?updates=` is set.
 *
 * Reading the URL on every call rather than caching means changing the query
 * string and reloading is the whole workflow — no rebuild, no restart.
 */
export function mockUpdatesBridge() {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('updates');
  if (!raw) return undefined;

  const kind = raw as Mockable;
  const isPackage = kind === 'package';
  const known = isPackage || (STATUSES as readonly string[]).includes(kind);

  // A typo used to fall through to `status: 'unsupported'` with
  // `installKind: 'appimage'` — a combination the real bridge can never
  // produce, which rendered as "No check has run yet" on a page that looked
  // fine. Silently showing a plausible wrong screen is the worst outcome for a
  // tool whose only job is to show the right one, so an unrecognised value
  // behaves as if the parameter were absent and says what it wanted.
  if (!known) {
    // eslint-disable-next-line no-console -- a dev tool explaining itself
    console.warn(
      `[updates] ignoring ?updates=${raw} — expected one of: ${[...STATUSES, 'package'].join(', ')}`,
    );
    return undefined;
  }

  const status = isPackage ? 'unsupported' : (kind as UpdateState['status']);

  const percent = clamp(Number(params.get('percent') ?? '42'), 0, 100, 42);
  // Bounded: `?history=99999` would build and render every one of them and hang
  // the page. Twenty is well past the point the layout tells you anything new.
  const historyCount = clamp(Number(params.get('history') ?? '0'), 0, 20, 0);

  const state: UpdateState = {
    status,
    currentVersion: params.get('version') ?? '0.9.11',
    availableVersion: ['available', 'downloading', 'ready'].includes(status) ? '0.10.0' : null,
    percent,
    lastChecked: status === 'idle' ? null : new Date().toISOString(),
    error:
      status === 'error'
        ? 'HttpError: 404 Not Found — "latest-linux.yml" is missing from the release'
        : null,
    installKind: isPackage ? 'package' : 'appimage',
  };

  const history = fakeHistory(historyCount);

  // eslint-disable-next-line no-console -- the whole point is to be obvious in dev
  console.info(`[updates] MOCKED as "${raw}" — remove ?updates= to use the real bridge`);

  return {
    status: () => Promise.resolve(state),
    history: () => Promise.resolve(history),
    check: () => Promise.resolve(state),
    install: () => {
      window.alert('Mock: the app would restart and install here.');
      return Promise.resolve();
    },
    // No pushes: the state is fixed for the page load, and a subscription that
    // never fires is the honest representation of that.
    onChange: () => () => {},
  };
}
