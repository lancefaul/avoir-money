import { useState, useRef, useEffect, useCallback, use, useMemo, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight } from 'lucide-react';
import { SearchInput } from './SearchInput.js';
import * as dm from './dropdown-menu.css.js';
import * as inp from './inputs.css.js';
import * as cs from './select.css.js';
import {
  Ctx,
  SubContext,
  ContentContext,
  mouse,
  inSafeZone,
  getPortalTarget,
} from './dropdown-menu-shared.js';
import { MenuSeparator, SheetCancelItem, SheetBackItem } from './dropdown-menu-parts.js';

/* ─── Sub-menu compound components ─── */

interface DropdownMenuSubProps {
  children: ReactNode;
}

export function DropdownMenuSub({ children }: DropdownMenuSubProps) {
  const [subOpen, setSubOpen] = useState(false);
  const [alignSide, setAlignSide] = useState<'right' | 'left'>('right');
  const triggerRef = useRef<HTMLElement | null>(null);
  const subContentRef = useRef<HTMLDivElement | null>(null);
  const szTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const szRafRef = useRef<number | undefined>(undefined);

  const cancelSafeZone = useCallback(() => {
    clearTimeout(szTimerRef.current);
    if (szRafRef.current) cancelAnimationFrame(szRafRef.current);
    szTimerRef.current = undefined;
    szRafRef.current = undefined;
  }, []);

  const startSafeZone = useCallback(() => {
    cancelSafeZone();
    const panel = subContentRef.current;
    if (!panel) {
      setSubOpen(false);
      return;
    }

    const rect = panel.getBoundingClientRect();
    const side = alignSide;
    const ox = mouse.x,
      oy = mouse.y;

    const poll = () => {
      if (!subContentRef.current) return;
      if (inSafeZone(ox, oy, rect, side)) {
        szRafRef.current = requestAnimationFrame(poll);
      } else {
        setSubOpen(false);
      }
    };

    szTimerRef.current = setTimeout(() => {
      if (subContentRef.current) {
        szRafRef.current = requestAnimationFrame(poll);
      }
    }, 40);
  }, [cancelSafeZone, alignSide]);

  useEffect(() => {
    return () => cancelSafeZone();
  }, [cancelSafeZone]);

  const subCtxValue = useMemo(
    () => ({
      subOpen,
      setSubOpen,
      triggerRef,
      subContentRef,
      alignSide,
      setAlignSide,
      cancelSafeZone,
      startSafeZone,
    }),
    [subOpen, alignSide, cancelSafeZone, startSafeZone],
  );

  return <SubContext.Provider value={subCtxValue}>{children}</SubContext.Provider>;
}

/* ─── Sub-trigger ─── */

interface DropdownMenuSubTriggerProps {
  children: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
}

export function DropdownMenuSubTrigger({
  children,
  icon,
  disabled = false,
}: DropdownMenuSubTriggerProps) {
  const sub = use(SubContext);
  const content = use(ContentContext);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const compact = content?.compact ?? false;

  if (!sub) throw new Error('DropdownMenuSubTrigger must be used within <DropdownMenuSub>');

  const handleMouseEnter = useCallback(() => {
    // Sheet mode is touch-first: drilling in is an explicit tap, never a hover.
    if (compact || disabled) return;
    sub.cancelSafeZone();
    clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => sub.setSubOpen(true), 200);
  }, [compact, disabled, sub]);

  const handleMouseLeave = useCallback(() => {
    if (compact) return;
    clearTimeout(hoverTimerRef.current);
    if (sub.subOpen) {
      sub.startSafeZone();
    }
  }, [compact, sub]);

  const handleClick = useCallback(() => {
    if (!compact || disabled) return;
    sub.setSubOpen(true);
  }, [compact, disabled, sub]);

  useEffect(() => {
    return () => clearTimeout(hoverTimerRef.current);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        e.stopPropagation();
        sub.setSubOpen(true);
      }
    },
    [sub],
  );

  let className = dm.item;
  if (disabled) className += ` ${dm.itemDisabled}`;
  else if (sub.subOpen) className += ` ${dm.itemSubOpen}`;

  return (
    <button
      ref={sub.triggerRef as React.RefObject<HTMLButtonElement>}
      role="menuitem"
      type="button"
      tabIndex={-1}
      aria-haspopup="menu"
      aria-expanded={sub.subOpen}
      aria-disabled={disabled || undefined}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={className}
    >
      {icon && <span className={dm.itemIcon}>{icon}</span>}
      <span style={{ flex: 1 }}>{children}</span>
      <span className={dm.itemArrow}>
        <ChevronRight size={13} />
      </span>
    </button>
  );
}

/* ─── Sub-content ─── */

interface DropdownMenuSubContentProps {
  children: ReactNode;
  /** Enable a pinned search input at the top of the sub-menu. */
  searchable?: boolean;
  /** Placeholder text for the search input. */
  searchPlaceholder?: string;
  /** Current search value (controlled). */
  searchValue?: string;
  /** Called when the search value changes. */
  onSearchChange?: (value: string) => void;
  /** Content shown when searchable and no children match (i.e. children is empty). */
  emptyContent?: ReactNode;
}

export function DropdownMenuSubContent({
  children,
  searchable = false,
  searchPlaceholder = 'Search…',
  searchValue = '',
  onSearchChange,
  emptyContent,
}: DropdownMenuSubContentProps) {
  const sub = use(SubContext);
  const rootCtx = use(Ctx);
  const content = use(ContentContext);
  const compact = content?.compact ?? false;
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [phase, setPhase] = useState<'closed' | 'opening' | 'open' | 'closing'>('closed');
  const [prevSubOpen, setPrevSubOpen] = useState(false);
  const [focusIdx, setFocusIdx] = useState(-1);

  if (!sub) throw new Error('DropdownMenuSubContent must be used within <DropdownMenuSub>');

  // Reset search when sub-menu closes (inline state adjustment)
  if (!sub.subOpen && prevSubOpen && searchable && onSearchChange) {
    onSearchChange('');
  }

  // Animate open/close (inline state adjustment — no useEffect for prop→state sync)
  if (sub.subOpen && !prevSubOpen) {
    setPrevSubOpen(true);
    setPhase('opening');
  } else if (!sub.subOpen && prevSubOpen && (phase === 'open' || phase === 'opening')) {
    setPrevSubOpen(false);
    setPhase('closing');
  } else if (!sub.subOpen && prevSubOpen) {
    setPrevSubOpen(false);
  }

  useEffect(() => {
    sub.subContentRef.current = menuRef.current;
    return () => {
      sub.subContentRef.current = null;
    };
  });

  // While drilled in, tell Content to hide its root page. Depends on the setter
  // (a stable useState setter) rather than the context object, whose identity
  // changes with drillActive and would otherwise re-trigger this effect.
  const setDrillActive = content?.setDrillActive;
  useEffect(() => {
    if (!compact || !setDrillActive || !sub.subOpen) return undefined;
    setDrillActive(true);
    return () => setDrillActive(false);
  }, [compact, setDrillActive, sub.subOpen]);

  const getItems = useCallback((): HTMLElement[] => {
    if (!menuRef.current) return [];
    return Array.from(
      menuRef.current.querySelectorAll<HTMLElement>(
        '[role="menuitem"]:not([aria-disabled="true"]), [role="menuitemcheckbox"]:not([aria-disabled="true"])',
      ),
    );
  }, []);

  const updatePos = useCallback(() => {
    if (!sub.triggerRef.current || !menuRef.current) return;
    const triggerRect = sub.triggerRef.current.getBoundingClientRect();
    const menuW = menuRef.current.offsetWidth;
    const menuH = menuRef.current.offsetHeight;
    const pad = 8;

    let top = triggerRect.top;
    let left: number;
    let side: 'right' | 'left' = 'right';

    if (triggerRect.right + menuW + pad <= window.innerWidth) {
      left = triggerRect.right + 2;
    } else {
      left = triggerRect.left - menuW - 2;
      side = 'left';
    }

    if (top + menuH > window.innerHeight - pad) {
      top = window.innerHeight - menuH - pad;
    }
    if (top < pad) top = pad;

    setPos({ top, left });
    sub.setAlignSide(side);
  }, [sub]);

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
      const timer = setTimeout(() => setPhase('closed'), 80);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [phase]);

  useEffect(() => {
    if (phase === 'opening' || phase === 'open') updatePos();
  }, [phase, updatePos]);

  useEffect(() => {
    if (phase !== 'open') return;
    if (searchable) {
      requestAnimationFrame(() => searchRef.current?.focus());
      return;
    }
    const items = getItems();
    if (items.length > 0) {
      setFocusIdx(0);
      items[0]?.focus();
    }
  }, [phase, getItems, searchable]);

  const handleMouseEnter = useCallback(() => {
    sub.cancelSafeZone();
  }, [sub]);

  const handleMouseLeave = useCallback(() => {
    setTimeout(() => sub.setSubOpen(false), 150);
  }, [sub]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const items = getItems();
      if (items.length === 0 && !searchable) return;
      const active = document.activeElement;
      const inInput = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');

      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault();
          e.stopPropagation();
          const next = focusIdx < items.length - 1 ? focusIdx + 1 : 0;
          setFocusIdx(next);
          items[next]?.focus();
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          e.stopPropagation();
          const prev = focusIdx > 0 ? focusIdx - 1 : items.length - 1;
          setFocusIdx(prev);
          items[prev]?.focus();
          break;
        }
        case 'ArrowLeft': {
          if (inInput) break;
          e.preventDefault();
          e.stopPropagation();
          sub.setSubOpen(false);
          sub.triggerRef.current?.focus();
          break;
        }
        case 'Escape': {
          e.preventDefault();
          e.stopPropagation();
          sub.setSubOpen(false);
          sub.triggerRef.current?.focus();
          break;
        }
        case 'Enter':
        case ' ': {
          if (inInput) break;
          e.preventDefault();
          e.stopPropagation();
          const focused = document.activeElement as HTMLElement;
          if (focused?.getAttribute('aria-disabled') !== 'true') {
            focused?.click();
          }
          break;
        }
        default: {
          if (inInput) break;
        }
      }
    },
    [focusIdx, getItems, sub, searchable],
  );

  const hasItems = Array.isArray(children) ? children.filter(Boolean).length > 0 : !!children;

  // Sheet mode: instead of flying out to the side, the sub-menu replaces the
  // sheet's root page — portaled into the panel itself so it sits where the
  // root items were, with Back to return and Cancel to dismiss outright.
  if (compact) {
    const sheetEl = content?.sheetRef.current;
    if (!sub.subOpen || !sheetEl) return null;
    return createPortal(
      <div className={dm.sheetPage}>
        <div className={`${dm.sheetPinned} ${dm.sheetPinnedTop}`}>
          <SheetBackItem onBack={() => sub.setSubOpen(false)} />
          <MenuSeparator />
          {searchable && (
            <div className={inp.searchWrap}>
              <SearchInput
                ref={searchRef}
                value={searchValue ?? ''}
                onChange={(v) => onSearchChange?.(v)}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder || 'Search options'}
              />
            </div>
          )}
        </div>
        <div className={dm.sheetScroll} data-sheet-scroll="">
          {searchable && !hasItems
            ? (emptyContent ?? <div className={cs.csEmpty}>No results</div>)
            : children}
        </div>
        <div className={`${dm.sheetPinned} ${dm.sheetPinnedBottom}`}>
          <MenuSeparator />
          <SheetCancelItem />
        </div>
      </div>,
      sheetEl,
    );
  }

  if (phase === 'closed') return null;

  let phaseClass: string;
  if (phase === 'open') {
    phaseClass = dm.submenuOpenRight;
  } else if (phase === 'closing') {
    phaseClass = dm.submenuClosing;
  } else {
    phaseClass = sub.alignSide === 'left' ? dm.submenuOpeningLeft : dm.submenuOpening;
  }

  return createPortal(
    <Ctx.Provider value={rootCtx!}>
      <div
        ref={menuRef}
        role="menu"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className={`${dm.submenu} ${phaseClass}`}
        style={{
          top: pos.top,
          left: pos.left,
          transformOrigin: `top ${sub.alignSide}`,
          ...(searchable ? { overflowY: 'hidden', padding: '0' } : {}),
        }}
      >
        {searchable ? (
          <>
            <div className={inp.searchWrap}>
              <SearchInput
                ref={searchRef}
                value={searchValue ?? ''}
                onChange={(v) => onSearchChange?.(v)}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder || 'Search options'}
              />
            </div>
            {hasItems ? (
              <div className={cs.csItemsScroll}>{children}</div>
            ) : (
              (emptyContent ?? <div className={cs.csEmpty}>No results</div>)
            )}
          </>
        ) : (
          children
        )}
      </div>
    </Ctx.Provider>,
    getPortalTarget(),
  );
}
