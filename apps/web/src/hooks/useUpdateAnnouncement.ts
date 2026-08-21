/**
 * Tell the user once, per version, that an update is waiting.
 *
 * # Why this is not just "toast when status === available"
 *
 * The updater checks every six hours, forever, and re-announces the same
 * version on every check until it is installed. Toasting on state alone would
 * fire four times a day about an update the user has already decided to defer,
 * which is nagging — and nagging is the thing `updater.js` swallows every
 * automatic failure to avoid. The rule the shell keeps for FAILURES has to hold
 * here for SUCCESSES too, and the version is what makes "once" definable.
 *
 * # Why the SERVER rather than component state or localStorage
 *
 * The app is a long-lived desktop window, but it does get restarted — and a
 * restart is exactly when the next check runs, 30 seconds later. Remembering in
 * memory would re-announce on every launch, which is the same nagging with a
 * longer period. The key is the announced VERSION, not a boolean, so a genuinely
 * newer version still gets its own announcement.
 *
 * This used localStorage, and on the desktop that was the same thing as
 * remembering in memory. Chromium keys localStorage by origin, the origin
 * includes the port, and the backend takes a fresh port every launch — so the
 * "remember" wrote to a store the next launch could not read, and the toast
 * fired again every time. Exactly the nagging the mechanism exists to prevent,
 * arriving through the mechanism meant to prevent it.
 */

import { useEffect } from 'react';
import { useUpdates } from './useUpdates.js';
import { useToastStore } from '../store/toast.js';
import { serverPreferenceStorage } from '../store/preferenceStorage.js';

const KEY = 'avoir.updates.announced';

export interface UpdateAnnouncement {
  /** Whether something is waiting — drives the dot on the Settings tab. */
  updateWaiting: boolean;
}

export function useUpdateAnnouncement(): UpdateAnnouncement {
  const { state } = useUpdates();

  // `available`, `downloading` and `ready` all mean "there is a newer version",
  // and the dot should be on for all three. They differ only in how far along
  // the download is, which is the pane's business rather than the nav's.
  const waiting =
    state?.status === 'available' || state?.status === 'downloading' || state?.status === 'ready';
  const version = state?.availableVersion ?? null;

  useEffect(() => {
    if (!waiting || !version) return;
    let cancelled = false;
    void (async () => {
      let announced: string | null = null;
      try {
        announced = await serverPreferenceStorage.getItem(KEY);
      } catch {
        // Not a reason to skip telling someone about an update; the cost of
        // forgetting is one extra toast, and the cost of staying silent is a
        // version they never hear about.
      }
      if (cancelled || announced === version) return;

      useToastStore.getState().addToast('info', `Version ${version} is available`, {
        description: 'Open Settings → Software Updates to install it.',
      });

      try {
        await serverPreferenceStorage.setItem(KEY, version);
      } catch {
        // As above — remembering is best-effort.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [waiting, version]);

  return { updateWaiting: Boolean(waiting) };
}
