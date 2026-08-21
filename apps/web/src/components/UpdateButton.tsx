/**
 * The update affordance in the window's title bar.
 *
 * # Why it lives here and not only in Settings
 *
 * ADR-039 built the update mechanism and deliberately left the in-app surface
 * out: the only thing an update ever asked for was a native dialog at the very
 * end, once the download was already on disk. That is correct about
 * interruption and silent about existence — an update could be found,
 * downloaded and waiting without the window showing anything, and Settings →
 * Software Updates is not a page anyone visits speculatively.
 *
 * This is the missing half: a mark in the chrome that says something is
 * happening, visible without being interrupting, and absent entirely when there
 * is nothing to say.
 *
 * # Why this one has a tooltip when its neighbours deliberately do not
 *
 * `title-bar.css.ts` explains that minimise/maximise/close carry no tooltip on
 * purpose — their meaning is universal, and three tooltips tracking the pointer
 * along the top edge is noise. That reasoning does not transfer. A download
 * arrow in a title bar is not universal, and unlike its neighbours this control
 * carries STATE: which version, how far along, and what a click will do. The
 * tooltip is the only place that can be said, and the click at `ready`
 * restarts the app — an outcome nobody should discover by trying it.
 *
 * # Why `ready` confirms
 *
 * Clicking at `available` or `downloading` opens the Settings pane, which is
 * reversible and cheap. Clicking at `ready` restarts the application. The main
 * process already asks before restarting when IT initiates, so a title-bar
 * click that skipped the question would be the one path into a surprise quit.
 */

import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Download } from 'lucide-react';
import { Tooltip } from '@budget-tracker/ui';
import { useUpdates } from '../hooks/useUpdates.js';
import ConfirmDialog from './ConfirmDialog.js';
import { cn } from '../lib/utils.js';
import * as s from './title-bar.css.js';

export default function UpdateButton() {
  const { state, install } = useUpdates();
  const [confirming, setConfirming] = useState(false);
  const navigate = useNavigate();

  const status = state?.status;
  const version = state?.availableVersion ?? null;

  /*
   * Absent, not disabled, when there is nothing waiting. A permanently greyed
   * control in window chrome is a standing question the user cannot answer, and
   * `current` / `error` / `unsupported` are all "nothing to do here" — an error
   * belongs on the Settings pane, which reports it, rather than as a mark in the
   * title bar that would read as an update.
   */
  const showing = status === 'available' || status === 'downloading' || status === 'ready';
  if (!showing) return null;

  const percent = Math.max(0, Math.min(100, state?.percent ?? 0));
  const ready = status === 'ready';

  const label = ready
    ? `Version ${version ?? ''} is ready — click to restart and install`.replace('  ', ' ')
    : status === 'downloading'
      ? `Downloading version ${version ?? ''} — ${percent}%`.replace('  ', ' ')
      : `Version ${version ?? ''} is available — click for details`.replace('  ', ' ');

  const onClick = () => {
    if (ready) {
      setConfirming(true);
      return;
    }
    // Deep link rather than a bare `/settings`: the tab was local state until
    // this needed somewhere to point (see `router.tsx`).
    void navigate({ to: '/settings', search: { tab: 'software-updates' } });
  };

  return (
    <>
      <Tooltip content={label} side="bottom">
        <button
          type="button"
          className={cn(s.button, ready && s.updateReady)}
          onClick={onClick}
          aria-label={label}
        >
          <Download size={15} aria-hidden />
          {status === 'downloading' && (
            /*
             * Progress as a hairline under the icon rather than a number or a
             * ring. The button is 2.875rem of window chrome shared with three
             * controls whose silhouettes never change; a digit that reflows as
             * it counts would draw the eye far harder than the update warrants.
             * The exact figure is in the tooltip for anyone who wants it.
             */
            <span className={s.updateProgress} style={{ width: `${percent}%` }} aria-hidden />
          )}
        </button>
      </Tooltip>

      <ConfirmDialog
        open={confirming}
        title="Restart to install?"
        message={`Avoir Money ${version ?? ''} is downloaded and verified. Restarting applies it — nothing changes until then.`.replace(
          '  ',
          ' ',
        )}
        confirmLabel="Restart now"
        cancelLabel="Later"
        confirmColor="blue"
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          void install();
        }}
      />
    </>
  );
}
