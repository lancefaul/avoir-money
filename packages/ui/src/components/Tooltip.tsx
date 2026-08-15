import { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useAnchorPosition, type Side } from '../hooks/useAnchorPosition.js';
import * as tt from './tooltip.css.js';

export interface TooltipProps {
  content: string;
  side?: Side;
  children: React.ReactElement;
  portalId?: string;
  /** When true, the trigger wrapper uses display:block with overflow:hidden for text truncation */
  truncate?: boolean;
  /**
   * When true, the trigger wrapper is keyboard-focusable (tabIndex 0) so the
   * tooltip can be summoned without a mouse. Use for non-interactive triggers
   * (e.g. icon-only badges); leave off when the child is already focusable
   * (buttons, links) to avoid a double tab stop.
   */
  focusable?: boolean;
}

function getPortalTarget(portalId?: string): HTMLElement {
  if (portalId) return document.getElementById(portalId) ?? document.body;
  return document.getElementById('tooltip-portal') ?? document.body;
}

export function Tooltip({
  content,
  side = 'top',
  children,
  portalId,
  truncate,
  focusable,
}: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const suppressUntilRef = useRef(0);
  const idRef = useRef(`tt-${Math.random().toString(36).slice(2, 8)}`);

  const { triggerRef, floatingRef, x, y, actualSide, positioned } = useAnchorPosition({
    side,
    visible,
  });

  const show = useCallback(() => {
    if (Date.now() < suppressUntilRef.current) return;
    // Don't show tooltip if the trigger's child has an open menu/popup
    const trigger = triggerRef.current as HTMLElement | null;
    if (trigger?.querySelector('[aria-expanded="true"]')) return;
    // Clear any pending open timer first so timerRef always holds the single
    // in-flight timer — otherwise a rapid re-trigger leaks a timer the unmount
    // cleanup can't cancel, firing setVisible() after teardown (window is undefined).
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (Date.now() < suppressUntilRef.current) return;
      const t = triggerRef.current as HTMLElement | null;
      if (t?.querySelector('[aria-expanded="true"]')) return;
      setVisible(true);
    }, 100);
  }, [triggerRef]);
  const hide = useCallback(() => {
    clearTimeout(timerRef.current);
    setVisible(false);
  }, []);
  useEffect(() => () => clearTimeout(timerRef.current), []);

  // Suppress tooltip re-showing for 2s after a click while the tooltip is visible.
  // This prevents the tooltip from re-appearing when a dropdown closes
  // and the mouse is still over the trigger.
  useEffect(() => {
    if (!visible) return;
    const suppress = () => {
      suppressUntilRef.current = Date.now() + 2000;
    };
    document.addEventListener('pointerdown', suppress, true);
    return () => document.removeEventListener('pointerdown', suppress, true);
  }, [visible]);

  const arrowStyle: React.CSSProperties = (() => {
    const h = 4;
    switch (actualSide) {
      case 'top':
        return { bottom: -h, left: '50%', marginLeft: -h };
      case 'bottom':
        return { top: -h, left: '50%', marginLeft: -h };
      case 'left':
        return { right: -h, top: '50%', marginTop: -h };
      case 'right':
        return { left: -h, top: '50%', marginTop: -h };
    }
  })();

  return (
    <>
      <span
        ref={triggerRef as React.RefObject<HTMLSpanElement>}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onKeyDown={(e) => {
          if (e.key === 'Escape') hide();
        }}
        {...(focusable ? { tabIndex: 0 } : {})}
        aria-describedby={visible ? idRef.current : undefined}
        style={
          truncate
            ? {
                display: 'block',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                minWidth: 0,
              }
            : { display: 'inline-flex' }
        }
      >
        {children}
      </span>
      {visible &&
        createPortal(
          <div
            ref={floatingRef}
            id={idRef.current}
            role="tooltip"
            className={`${tt.tooltipPortal} ${positioned ? tt.tooltipVisible : ''}`}
            style={{ left: x, top: y, visibility: positioned ? 'visible' : 'hidden' }}
          >
            <div className={tt.tooltipBubble}>
              {content}
              <div className={tt.tooltipArrow} style={arrowStyle} />
            </div>
          </div>,
          getPortalTarget(portalId),
        )}
    </>
  );
}
