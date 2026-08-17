import { useState, useRef, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import * as dm from './dropdown-menu.css.js';
import {
  useDropdown,
  getPortalTarget,
  ContentContext,
  SHEET_BREAKPOINT,
} from './dropdown-menu-shared.js';
import { MenuSeparator, SheetCancelItem } from './dropdown-menu-parts.js';
import { useIsNarrow } from '../hooks/useIsNarrow.js';

/* ─── Content ─── */

interface DropdownMenuContentProps {
  children: ReactNode;
  align?: 'start' | 'end';
  side?: 'bottom' | 'top';
  sideOffset?: number;
  matchTriggerWidth?: boolean;
  /**
   * Explicit panel width, overriding `matchTriggerWidth`.
   *
   * Needed because `matchTriggerWidth` writes `width` as an inline style, so
   * the CSS `max-width` on `menu` cannot widen a panel whose trigger is
   * narrow — a Select rendered behind a small Badge trigger, for instance.
   */
  width?: string;
  autoFocusFirst?: boolean;
  /** Zero out container padding — used by Select which manages its own internal padding via search/scroll/footer wrappers. */
  noPadding?: boolean;
  /** Override the default max-width (15rem) of the dropdown panel. */
  maxWidth?: string;
  /** Additional className applied to the dropdown container (useful for theme overrides in portals). */
  className?: string;
  /**
   * Render as a bottom sheet below {@link SHEET_BREAKPOINT}. Defaults to true.
   * Set false for panels that must stay anchored to their trigger even on
   * narrow screens — notably an inline typeahead, where a bottom sheet would
   * cover the very field being typed into.
   */
  sheetOnNarrow?: boolean;
}

export function DropdownMenuContent({
  children,
  align = 'end',
  side = 'bottom',
  sideOffset = 4,
  matchTriggerWidth = false,
  width,
  autoFocusFirst = true,
  noPadding = false,
  maxWidth,
  className,
  sheetOnNarrow = true,
}: DropdownMenuContentProps) {
  const { open, setOpen, triggerId, menuId, triggerRef, focusLast } = useDropdown();
  const menuRef = useRef<HTMLDivElement>(null);
  const compact = useIsNarrow(SHEET_BREAKPOINT) && sheetOnNarrow;
  const [drillActive, setDrillActive] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [transformOrigin, setTransformOrigin] = useState('top right');
  const [phase, setPhase] = useState<'closed' | 'opening' | 'open' | 'closing'>('closed');
  const [prevOpen, setPrevOpen] = useState(open);
  const [focusIdx, setFocusIdx] = useState(-1);
  const typeAheadRef = useRef('');
  const typeAheadTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const getItems = useCallback((): HTMLElement[] => {
    if (!menuRef.current) return [];
    return Array.from(
      menuRef.current.querySelectorAll<HTMLElement>(
        '[role="menuitem"]:not([aria-disabled="true"]), [role="menuitemcheckbox"]:not([aria-disabled="true"])',
      ),
    );
  }, []);

  const updatePos = useCallback(() => {
    if (!triggerRef.current || !menuRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const menuW = menuRef.current.offsetWidth;
    const menuH = menuRef.current.offsetHeight;
    const pad = 8;
    let top: number;
    let origin: string;
    const spaceBelow = window.innerHeight - rect.bottom - sideOffset;
    const spaceAbove = rect.top - sideOffset;
    const fitsBelow = spaceBelow >= menuH + pad;
    const fitsAbove = spaceAbove >= menuH + pad;

    if (side === 'bottom' && fitsBelow) {
      top = rect.bottom + sideOffset;
      origin = 'top';
    } else if (side === 'bottom' && !fitsBelow && fitsAbove) {
      top = rect.top - menuH - sideOffset;
      origin = 'bottom';
    } else if (side === 'top' && fitsAbove) {
      top = rect.top - menuH - sideOffset;
      origin = 'bottom';
    } else if (side === 'top' && !fitsAbove && fitsBelow) {
      top = rect.bottom + sideOffset;
      origin = 'top';
    } else {
      top = side === 'bottom' ? rect.bottom + sideOffset : rect.top - menuH - sideOffset;
      origin = side === 'bottom' ? 'top' : 'bottom';
    }

    let left: number;
    if (align === 'end') {
      left = rect.right - menuW;
      origin += ' right';
    } else {
      left = rect.left;
      origin += ' left';
    }
    if (left < pad) left = pad;
    if (left + menuW > window.innerWidth - pad) left = window.innerWidth - menuW - pad;
    if (top < pad) top = pad;
    if (top + menuH > window.innerHeight - pad) top = window.innerHeight - menuH - pad;
    setPos({ top, left });
    setTransformOrigin(origin);
  }, [triggerRef, align, side, sideOffset]);

  // Animate open/close (inline state adjustment — no useEffect for prop→state sync)
  if (open && !prevOpen) {
    setPrevOpen(true);
    setPhase('opening');
  } else if (!open && prevOpen && (phase === 'open' || phase === 'opening')) {
    setPrevOpen(false);
    setPhase('closing');
  } else if (!open && prevOpen) {
    setPrevOpen(false);
  }

  // Complete the opening animation via rAF
  useEffect(() => {
    if (phase === 'opening') {
      let cancelled = false;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!cancelled) setPhase('open');
        });
      });
      return () => {
        cancelled = true;
      };
    }
    return undefined;
  }, [phase]);

  // Complete the closing animation via timeout
  useEffect(() => {
    if (phase === 'closing') {
      const t = setTimeout(() => setPhase('closed'), 100);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [phase]);

  useEffect(() => {
    // A sheet is viewport-anchored, so trigger-relative positioning is skipped.
    if (compact) return;
    if (phase === 'opening' || phase === 'open') updatePos();
  }, [phase, updatePos, compact]);

  // Reopening always starts at the root page, never mid-drill.
  useEffect(() => {
    if (phase === 'closed') setDrillActive(false);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'open') return;
    if (!autoFocusFirst) return;
    const items = getItems();
    if (items.length === 0) return;
    const idx = focusLast ? items.length - 1 : 0;
    setFocusIdx(idx);
    items[idx]?.focus();
  }, [phase, focusLast, getItems, autoFocusFirst]);

  useEffect(() => {
    if (phase === 'closed') return;
    function handleMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      // Don't close if clicking inside this menu, the trigger, or any submenu portal
      if (menuRef.current && menuRef.current.contains(target)) return;
      if (triggerRef.current && triggerRef.current.contains(target)) return;
      // Check if click is inside any portaled submenu (they have role="menu")
      const clickedMenu = (target as Element).closest?.('[role="menu"]');
      if (clickedMenu) return;
      setOpen(false);
    }
    function handleScroll(e: Event) {
      // Ignore scroll events from inside the menu (e.g. scrolling the items list)
      if (menuRef.current && menuRef.current.contains(e.target as Node)) return;
      // A sheet stays pinned to the viewport, so it neither follows nor hides
      // with the trigger.
      if (compact) return;
      if (!triggerRef.current) return;
      const r = triggerRef.current.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth)
        setOpen(false);
      else updatePos();
    }
    function handleResize() {
      setOpen(false);
    }
    document.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleResize);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleResize);
    };
  }, [phase, setOpen, triggerRef, updatePos, compact]);

  // When focus is in a search input, keep the first item visually highlighted
  // so the user knows what Enter will select. Reset to first item when the
  // filtered list changes (user typed in search).
  const prevItemCountRef = useRef(0);
  // Intentionally runs every render to detect DOM item count changes from search filtering
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (phase !== 'open') return;
    const active = document.activeElement;
    const inInput = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
    if (!inInput) return;
    const items = getItems();
    const count = items.length;
    if (count > 0 && (focusIdx < 0 || focusIdx >= count || count !== prevItemCountRef.current)) {
      setFocusIdx(0);
    }
    prevItemCountRef.current = count;
  });

  // Apply data-highlighted attribute to the focused item when focus is in an input
  useEffect(() => {
    if (phase !== 'open') return;
    const menu = menuRef.current;
    if (!menu) return;
    const items = getItems();
    // Clear all highlights first
    for (const el of items) el.removeAttribute('data-highlighted');
    // Apply highlight to current focusIdx
    if (focusIdx >= 0 && focusIdx < items.length) {
      const active = document.activeElement;
      const inInput = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
      if (inInput) {
        items[focusIdx]?.setAttribute('data-highlighted', '');
        // Scroll the highlighted item into view
        items[focusIdx]?.scrollIntoView?.({ block: 'nearest' });
      }
    }
  });

  const ctxValue = useMemo(
    () => ({ compact, sheetRef: menuRef, drillActive, setDrillActive }),
    [compact, drillActive],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const items = getItems();
      if (items.length === 0) return;
      const active = document.activeElement;
      const inInput = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault();
          if (inInput) {
            // Move virtual highlight without stealing focus from input
            const n = focusIdx < items.length - 1 ? focusIdx + 1 : 0;
            setFocusIdx(n);
          } else {
            const n = focusIdx < items.length - 1 ? focusIdx + 1 : 0;
            setFocusIdx(n);
            items[n]?.focus();
          }
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          if (inInput) {
            const p = focusIdx > 0 ? focusIdx - 1 : items.length - 1;
            setFocusIdx(p);
          } else {
            const p = focusIdx > 0 ? focusIdx - 1 : items.length - 1;
            setFocusIdx(p);
            items[p]?.focus();
          }
          break;
        }
        case 'Home': {
          if (inInput) break;
          e.preventDefault();
          setFocusIdx(0);
          items[0]?.focus();
          break;
        }
        case 'End': {
          if (inInput) break;
          e.preventDefault();
          const l = items.length - 1;
          setFocusIdx(l);
          items[l]?.focus();
          break;
        }
        case 'Escape': {
          // Close only this menu. An enclosing Modal/drawer listens for Escape on
          // `document`; stop the native event so it never bubbles there and closes
          // the drawer along with the dropdown.
          e.preventDefault();
          e.stopPropagation();
          e.nativeEvent.stopImmediatePropagation();
          setOpen(false);
          triggerRef.current?.focus();
          break;
        }
        case 'Tab': {
          if (matchTriggerWidth) {
            // Select mode: let Tab cycle within the panel (search, items, footer)
            break;
          }
          setOpen(false);
          triggerRef.current?.focus();
          break;
        }
        case 'Enter':
        case ' ': {
          if (inInput) {
            // Select the highlighted item from the search input
            if (e.key === 'Enter' && focusIdx >= 0 && focusIdx < items.length) {
              e.preventDefault();
              items[focusIdx]?.click();
            }
            break;
          }
          e.preventDefault();
          const f = active as HTMLElement;
          if (f?.getAttribute('aria-disabled') !== 'true') f?.click();
          break;
        }
        default: {
          if (inInput) break;
          if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            clearTimeout(typeAheadTimerRef.current);
            typeAheadRef.current += e.key.toLowerCase();
            typeAheadTimerRef.current = setTimeout(() => {
              typeAheadRef.current = '';
            }, 500);
            const m = items.findIndex((el) =>
              (el.textContent ?? '').toLowerCase().startsWith(typeAheadRef.current),
            );
            if (m !== -1) {
              setFocusIdx(m);
              items[m]?.focus();
            }
          }
        }
      }
    },
    [focusIdx, getItems, setOpen, triggerRef, matchTriggerWidth],
  );

  if (phase === 'closed') return null;
  const phaseClass =
    phase === 'open' ? dm.menuOpen : phase === 'closing' ? dm.menuClosing : dm.menuOpening;

  // In sheet mode every trigger-relative inline value is omitted: an inline
  // `top`/`left`/`width` would outrank the sheet class that pins the panel.
  const panelStyle: React.CSSProperties = compact
    ? {}
    : { top: pos.top, left: pos.left, transformOrigin };
  if (!compact && matchTriggerWidth && triggerRef.current) {
    const tw = triggerRef.current.offsetWidth;
    panelStyle.width = tw;
    panelStyle.minWidth = `max(${tw}px, 13rem)`;
    panelStyle.overflowY = 'hidden';
  }
  // After the matchTriggerWidth block on purpose: an explicit width is a
  // deliberate override of the trigger-derived one.
  if (!compact && width) {
    panelStyle.width = width;
    panelStyle.minWidth = width;
    panelStyle.maxWidth = width;
  }
  if (noPadding) {
    panelStyle.padding = '0';
  }
  if (!compact && maxWidth) {
    panelStyle.maxWidth = maxWidth;
  }

  return createPortal(
    <ContentContext.Provider value={ctxValue}>
      {compact && <div className={dm.sheetScrim} data-dropdown-scrim="" aria-hidden="true" />}
      <div
        ref={menuRef}
        id={menuId}
        role="menu"
        aria-labelledby={triggerId}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className={`${dm.menu} ${compact ? dm.sheet : ''} ${phaseClass}${className ? ` ${className}` : ''}`}
        style={panelStyle}
      >
        {compact ? (
          // Kept mounted while drilled in — a drilled sub-menu lives inside this
          // subtree and portals itself into the panel, so unmounting the page
          // would tear down the very menu being shown. `hidden` (rather than a
          // class) so the collapse holds even where stylesheets are absent.
          <div className={dm.sheetPage} hidden={drillActive}>
            <div className={dm.sheetScroll} data-sheet-scroll="">
              {children}
            </div>
            <div className={`${dm.sheetPinned} ${dm.sheetPinnedBottom}`}>
              <MenuSeparator />
              <SheetCancelItem />
            </div>
          </div>
        ) : (
          children
        )}
      </div>
    </ContentContext.Provider>,
    getPortalTarget(),
  );
}
