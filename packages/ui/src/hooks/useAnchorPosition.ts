import { useState, useCallback, useLayoutEffect, useRef } from 'react';

export type Side = 'top' | 'bottom' | 'left' | 'right';

export interface AnchorPositionOptions {
  /** Preferred side to place the floating element. */
  side: Side;
  /** Whether the floating element is currently visible (triggers repositioning). */
  visible: boolean;
  /** Gap between the trigger and the floating element in px. @default 8 */
  gap?: number;
  /** Minimum distance from viewport edges in px. @default 8 */
  viewportPadding?: number;
}

export interface AnchorPositionResult {
  /** Ref to attach to the trigger/anchor element. */
  triggerRef: React.RefObject<HTMLElement | null>;
  /** Ref to attach to the floating element. */
  floatingRef: React.RefObject<HTMLDivElement | null>;
  /** Computed x coordinate (fixed positioning). */
  x: number;
  /** Computed y coordinate (fixed positioning). */
  y: number;
  /** The side actually used after flip logic. */
  actualSide: Side;
  /** Whether positioning has been computed (use to gate visibility). */
  positioned: boolean;
}

const opposite: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
const allSides: Side[] = ['top', 'bottom', 'left', 'right'];

/**
 * Shared anchor-positioning hook used by Tooltip and Toggletip.
 *
 * Measures the trigger and floating element, picks the best side
 * (with automatic flip when clipping the viewport), and returns
 * fixed-position coordinates.
 */
export function useAnchorPosition({
  side,
  visible,
  gap = 8,
  viewportPadding = 8,
}: AnchorPositionOptions): AnchorPositionResult {
  const triggerRef = useRef<HTMLElement | null>(null);
  const floatingRef = useRef<HTMLDivElement | null>(null);
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  const [actualSide, setActualSide] = useState(side);
  const [positioned, setPositioned] = useState(false);

  const position = useCallback(() => {
    const trigger = triggerRef.current;
    const floating = floatingRef.current;
    if (!trigger || !floating) return;

    const rect = trigger.getBoundingClientRect();
    const tipRect = floating.getBoundingClientRect();
    const pad = viewportPadding;

    const positions: Record<Side, { x: number; y: number }> = {
      top: {
        x: rect.left + rect.width / 2 - tipRect.width / 2,
        y: rect.top - tipRect.height - gap,
      },
      bottom: { x: rect.left + rect.width / 2 - tipRect.width / 2, y: rect.bottom + gap },
      left: {
        x: rect.left - tipRect.width - gap,
        y: rect.top + rect.height / 2 - tipRect.height / 2,
      },
      right: { x: rect.right + gap, y: rect.top + rect.height / 2 - tipRect.height / 2 },
    };

    const fits = (s: Side) => {
      const p = positions[s];
      return (
        p.x >= pad &&
        p.y >= pad &&
        p.x + tipRect.width <= window.innerWidth - pad &&
        p.y + tipRect.height <= window.innerHeight - pad
      );
    };

    let chosen = side;
    if (!fits(side)) {
      chosen = opposite[side];
      if (!fits(chosen)) {
        chosen = allSides.find(fits) ?? side;
      }
    }

    const pos = positions[chosen];
    setCoords({
      x: Math.max(pad, Math.min(pos.x, window.innerWidth - tipRect.width - pad)),
      y: Math.max(pad, Math.min(pos.y, window.innerHeight - tipRect.height - pad)),
    });
    setActualSide(chosen);
    setPositioned(true);
  }, [side, gap, viewportPadding]);

  useLayoutEffect(() => {
    if (visible && floatingRef.current) {
      position();
    }
    if (!visible) {
      setPositioned(false);
    }
  }, [visible, position]);

  /**
   * Reposition when either element CHANGES SIZE while open.
   *
   * `position()` reads both rects once and the effect above only re-runs on
   * `visible` or the options — so a floating element whose content changes
   * while it stays open keeps coordinates computed for its previous width. The
   * offset is invisible near the middle of the screen and obvious at an edge,
   * because `x` is derived from the tip's half-width and then clamped against
   * the viewport using that same stale width.
   *
   * Found on the title bar's privacy toggle, whose label changes from "Hide
   * values" to "Values are hidden — click to show" on click. Hovering, clicking
   * and not moving the pointer left the tooltip hanging off to one side.
   *
   * A ResizeObserver rather than a `content` dependency, because content is not
   * the only thing that resizes a tooltip: a late-loading font, a longer
   * translation and a wrap at a different width all do it, and none of them
   * would be covered by watching a prop this hook cannot see.
   */
  useLayoutEffect(() => {
    if (!visible) return;
    const floating = floatingRef.current;
    const trigger = triggerRef.current;
    if (!floating) return;

    // Repositioning moves an element without resizing it, so this cannot feed
    // itself — but only as long as we ignore notifications that report the same
    // box. Without the guard, a clamp that changed text wrapping could.
    // `null`, not an empty string: the guard must skip only a size it has
    // ALREADY seen. Seeding it with a value a real notification can produce
    // makes the first one indistinguishable from a repeat and swallows it.
    let last: string | null = null;
    const observer = new ResizeObserver((entries) => {
      const key = entries
        .map((e) => `${Math.round(e.contentRect.width)}x${Math.round(e.contentRect.height)}`)
        .join(',');
      if (last !== null && key === last) return;
      last = key;
      position();
    });

    observer.observe(floating);
    if (trigger) observer.observe(trigger);
    return () => observer.disconnect();
  }, [visible, position]);

  return { triggerRef, floatingRef, x: coords.x, y: coords.y, actualSide, positioned };
}
