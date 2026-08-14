import {
  useState,
  useRef,
  useCallback,
  useEffect,
  cloneElement,
  isValidElement,
  type ReactNode,
  type ReactElement,
} from 'react';
import { createPortal } from 'react-dom';
import { useAnchorPosition, type Side } from '../hooks/useAnchorPosition.js';
import * as tt from './toggletip.css.js';

export interface ToggletipProps {
  /** The clickable trigger element. Receives onClick, aria-expanded, and ref. */
  trigger: ReactElement;
  /** Structured body content rendered inside the panel. */
  children: ReactNode;
  /** Preferred placement side. @default 'bottom' */
  side?: Side;
  /** Portal target element ID. @default 'tooltip-portal' */
  portalId?: string;
}

function getPortalTarget(portalId?: string): HTMLElement {
  if (portalId) return document.getElementById(portalId) ?? document.body;
  return document.getElementById('tooltip-portal') ?? document.body;
}

const arrowSideClass: Record<Side, string> = {
  top: tt.arrowTop,
  bottom: tt.arrowBottom,
  left: tt.arrowLeft,
  right: tt.arrowRight,
};

export function Toggletip({ trigger, children, side = 'bottom', portalId }: ToggletipProps) {
  const [open, setOpen] = useState(false);
  const idRef = useRef(`tgt-${Math.random().toString(36).slice(2, 8)}`);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const { triggerRef, floatingRef, x, y, actualSide, positioned } = useAnchorPosition({
    side,
    visible: open,
  });

  /* ─── Toggle on click ─── */
  const handleTriggerClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen((prev) => !prev);
  }, []);

  /* ─── Close on Escape ─── */
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, triggerRef]);

  /* ─── Close on click outside ─── */
  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open, triggerRef]);

  /* ─── Close on scroll/resize while open ─── */
  useEffect(() => {
    if (!open) return;
    function onScrollOrResize() {
      setOpen(false);
    }
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [open]);

  /* ─── Arrow positioning (mirrors Tooltip logic) ─── */
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

  /* ─── Clone trigger to inject ref + props ─── */
  const triggerElement = isValidElement(trigger)
    ? cloneElement(trigger as ReactElement<Record<string, unknown>>, {
        ref: triggerRef,
        onClick: handleTriggerClick,
        'aria-expanded': open,
        'aria-controls': open ? idRef.current : undefined,
      })
    : trigger;

  return (
    <>
      {triggerElement}
      {open &&
        createPortal(
          <div
            ref={(node) => {
              floatingRef.current = node;
              panelRef.current = node;
            }}
            id={idRef.current}
            role="status"
            className={`${tt.portal} ${positioned ? tt.portalVisible : ''}`}
            style={{ left: x, top: y, visibility: positioned ? 'visible' : 'hidden' }}
          >
            <div className={tt.panel}>
              {children}
              <div className={`${tt.arrow} ${arrowSideClass[actualSide]}`} style={arrowStyle} />
            </div>
          </div>,
          getPortalTarget(portalId),
        )}
    </>
  );
}
