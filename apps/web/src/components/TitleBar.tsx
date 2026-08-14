/**
 * The app's title bar, drawn because the window has none.
 *
 * # Why the window is frameless
 *
 * There used to be two bars: the compositor's title bar, and `Layout.tsx`'s
 * header immediately below it — roughly 100px of chrome before any content, in
 * two visual languages that could never be reconciled because we only control
 * one of them. `frame: false` in `electron/main.js` removes the outer one and
 * hands us its three jobs. This is where they land.
 *
 * # It draws nothing in a browser
 *
 * `useWindowControls().supported` is false wherever there is no Electron shell —
 * over the LAN, in development, in every test that does not stub the bridge.
 * A browser tab has no window to minimise, and the browser is already drawing
 * its own chrome, so a second title bar would be a decorative strip with three
 * buttons that cannot work. Rendering nothing is the honest answer, and it also
 * means the browser build's layout is completely unaffected by any of this.
 */

import { RotateCw, Minus, Square, Copy, X } from 'lucide-react';
import { cn } from '../lib/utils.js';
import { useWindowControls } from '../hooks/useWindowControls.js';
import * as s from './title-bar.css.js';

export default function TitleBar() {
  const { supported, maximized, minimize, toggleMaximize, close, reload } = useWindowControls();

  if (!supported) return null;

  return (
    <div className={s.bar}>
      <div className={s.brand}>
        {/* Decorative: the product name sits beside it and says the same thing. */}
        <img src="/avoir-app-icon-round.png" alt="" className={s.mark} />
        <span className={s.name}>Avoir Money</span>
      </div>

      <div className={s.spacer} />

      <div className={s.controls}>
        {/*
          Refresh sits with the window controls rather than in the page, because
          it acts on the whole window and there is no browser reload here to
          fall back on. Leftmost, so the three destructive-adjacent controls
          keep the corner positions muscle memory expects — close in particular
          must stay flush to the corner.
        */}
        <button type="button" className={s.button} onClick={reload} aria-label="Refresh">
          <RotateCw size={14} aria-hidden />
        </button>
        <button type="button" className={s.button} onClick={minimize} aria-label="Minimise">
          <Minus size={15} aria-hidden />
        </button>
        <button
          type="button"
          className={s.button}
          onClick={toggleMaximize}
          aria-label={maximized ? 'Restore' : 'Maximise'}
        >
          {/*
            Two glyphs, not one rotated: `Square` is the window as it would
            become, and `Copy`'s offset pair is the conventional restore-down
            mark. A button whose icon does not change is the commonest way a
            maximise control ends up lying about the window's state.
          */}
          {maximized ? <Copy size={13} aria-hidden /> : <Square size={13} aria-hidden />}
        </button>
        <button
          type="button"
          className={cn(s.button, s.close)}
          onClick={close}
          aria-label="Close window"
        >
          <X size={16} aria-hidden />
        </button>
      </div>
    </div>
  );
}
