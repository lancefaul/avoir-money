/**
 * Internal shared context + helpers for the DropdownMenu compound components.
 * Split from DropdownMenu.tsx; nothing here is exported from the package index.
 */
import { createContext, use } from 'react';
import { below } from '../theme/breakpoints.js';

/* ─── Context ─── */

export interface DropdownCtx {
  open: boolean;
  setOpen: (v: boolean) => void;
  triggerId: string;
  menuId: string;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  focusLast: boolean;
  setFocusLast: (v: boolean) => void;
}

export const Ctx = createContext<DropdownCtx | null>(null);

export function useDropdown() {
  const ctx = use(Ctx);
  if (!ctx) throw new Error('DropdownMenu must be used within <DropdownMenu>');
  return ctx;
}

// Internal only — not re-exported from package index

/* ─── Global mouse tracker (for safe-zone triangle prediction) ─── */

export const mouse = { x: 0, y: 0 };
if (typeof document !== 'undefined') {
  document.addEventListener(
    'mousemove',
    (e) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    },
    { passive: true },
  );
}

function ptInTriangle(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): boolean {
  const s1 = (ax - cx) * (py - cy) - (ay - cy) * (px - cx);
  const s2 = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
  const s3 = (cx - bx) * (py - by) - (cy - by) * (px - bx);
  return !((s1 < 0 || s2 < 0 || s3 < 0) && (s1 > 0 || s2 > 0 || s3 > 0));
}

export function inSafeZone(ox: number, oy: number, rect: DOMRect, side: 'right' | 'left'): boolean {
  const pad = 12;
  const ex = side === 'right' ? rect.left : rect.right;
  return ptInTriangle(mouse.x, mouse.y, ox, oy, ex, rect.top - pad, ex, rect.bottom + pad);
}

/* ─── Content (sheet) context ─── */

/** Viewport width at/below which menus render as bottom sheets. */
export const SHEET_BREAKPOINT = below.sm;

/**
 * Provided by DropdownMenuContent so descendants can adapt to sheet mode.
 * `sheetRef` is the panel element itself: a drilled-in sub-menu portals its
 * items *into* that panel, replacing the root page rather than flying out to
 * the side. `drillActive` tells Content to hide (but keep mounted) its root
 * page — keeping it mounted is what stops the drilled sub-menu, which lives
 * inside that page's React tree, from unmounting itself.
 */
export interface ContentCtx {
  compact: boolean;
  sheetRef: React.RefObject<HTMLDivElement | null>;
  drillActive: boolean;
  setDrillActive: (v: boolean) => void;
}

export const ContentContext = createContext<ContentCtx | null>(null);

/* ─── Sub-menu context ─── */

export interface SubCtx {
  subOpen: boolean;
  setSubOpen: (v: boolean) => void;
  triggerRef: React.RefObject<HTMLElement | null>;
  subContentRef: React.RefObject<HTMLDivElement | null>;
  alignSide: 'right' | 'left';
  setAlignSide: (v: 'right' | 'left') => void;
  cancelSafeZone: () => void;
  startSafeZone: () => void;
}

export const SubContext = createContext<SubCtx | null>(null);

export function getPortalTarget(): HTMLElement {
  return document.getElementById('tooltip-portal') ?? document.body;
}
