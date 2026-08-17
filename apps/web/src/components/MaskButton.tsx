/**
 * The privacy control in the window's title bar.
 *
 * # Why it lives in the chrome
 *
 * It is reached when someone walks up behind you, which means it has to be in
 * the same place on every page and never scrolled off. The chrome is the only
 * surface that qualifies. It sits between the update mark and Refresh: the
 * update mark stays leftmost, and minimise/maximise/close keep the corner
 * positions muscle memory expects.
 *
 * Unlike the update mark it is ALWAYS rendered, so it never shifts its
 * neighbours — the rule `title-bar.css.ts` states about not moving the close
 * button is satisfied by construction rather than by care.
 *
 * # Why it has a tooltip when minimise and close do not
 *
 * `title-bar.css.ts` explains that the window controls carry no tooltip
 * deliberately: their meaning is universal and three tooltips tracking the
 * pointer along the top edge is noise. That reasoning does not transfer here
 * for the same reason it did not transfer to the update mark — this control
 * carries STATE. An eye with a line through it does not say whether the line
 * means "currently hidden" or "click to hide", and the two readings are
 * opposites.
 */

import { EyeOff, Eye } from 'lucide-react';
import { Tooltip } from '@budget-tracker/ui';
import { useUIStore } from '../store/ui.js';
import * as s from './title-bar.css.js';

export default function MaskButton() {
  const masked = useUIStore((st) => st.masked);
  const toggleMasked = useUIStore((st) => st.toggleMasked);

  /*
   * The icon shows the STATE, not the action: a struck-through eye means
   * "values are hidden right now". The tooltip carries the action, because that
   * is the half an icon cannot say unambiguously.
   */
  const label = masked ? 'Values are hidden — click to show' : 'Hide values';

  return (
    <Tooltip content={label} side="bottom">
      <button
        type="button"
        className={s.button}
        onClick={toggleMasked}
        aria-label={label}
        aria-pressed={masked}
      >
        {masked ? <EyeOff size={15} aria-hidden /> : <Eye size={15} aria-hidden />}
      </button>
    </Tooltip>
  );
}
