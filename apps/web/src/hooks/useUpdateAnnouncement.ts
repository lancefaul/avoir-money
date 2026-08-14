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
 * # Why localStorage rather than component state
 *
 * The app is a long-lived desktop window, but it does get restarted — and a
 * restart is exactly when the next check runs, 30 seconds later. Remembering in
 * memory would re-announce on every launch, which is the same nagging with a
 * longer period. The key is the announced VERSION, not a boolean, so a genuinely
 * newer version still gets its own announcement.
 */

import { useEffect } from 'react';
import { useUpdates } from './useUpdates.js';
import { useToastStore } from '../store/toast.js';

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
    let announced: string | null = null;
    try {
      announced = localStorage.getItem(KEY);
    } catch {
      // A blocked or full localStorage is not a reason to skip telling someone
      // about an update; the cost of forgetting is one extra toast.
    }
    if (announced === version) return;

    useToastStore.getState().addToast('info', `Version ${version} is available`, {
      description: 'Open Settings → Software Updates to install it.',
    });

    try {
      localStorage.setItem(KEY, version);
    } catch {
      // As above — remembering is best-effort.
    }
  }, [waiting, version]);

  return { updateWaiting: Boolean(waiting) };
}
