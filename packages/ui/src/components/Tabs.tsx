import { useState, useRef, useCallback, useEffect, useId, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import * as t from './tabs.css.js';
import { Tooltip } from './Tooltip.js';
import { below } from '../theme/breakpoints.js';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from './DropdownMenu.js';

/**
 * True below 640px, where the vertical rail's tabs render icon-only and need a
 * tooltip to convey the label. Must stay in sync with ICON_ONLY in tabs.css.ts.
 *
 * Guarded for environments without matchMedia (jsdom does not implement it), where
 * it resolves to false — i.e. labels stay visible, which is the safe default.
 */
const ICON_ONLY_QUERY = `(max-width: ${below.md}px)`;

function useIconOnly(): boolean {
  const [iconOnly, setIconOnly] = useState(
    () =>
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia(ICON_ONLY_QUERY).matches,
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(ICON_ONLY_QUERY);
    const handler = (e: MediaQueryListEvent | MediaQueryList) => setIconOnly(e.matches);
    handler(mq);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return iconOnly;
}

/**
 * Vertical wheel → horizontal scroll for the collapsed tab bar (<800px), the
 * same behavior as the Accounts card strip. Attached manually because React's
 * synthetic onWheel is passive — preventDefault would be ignored and the page
 * would scroll vertically as well. No-ops when the list doesn't overflow
 * horizontally (e.g. the vertical rail at >=800px, or few/short tabs).
 */
function useHorizontalWheelScroll(ref: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY === 0 || e.deltaX !== 0) return;
      if (el.scrollWidth <= el.clientWidth) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [ref]);
}

/* ═══════════════════════════════════════
   Tab item definition
   ═══════════════════════════════════════ */

export interface TabItem {
  value: string;
  label: string;
  disabled?: boolean;
  icon?: ReactNode;
  /**
   * A small trailing dot, for a tab with something waiting behind it.
   *
   * Added for Settings → Software Updates, which needs to say "there is an
   * update" from the nav before the pane is opened. Deliberately a boolean and
   * not a count: the question a tab can answer at this size is "does this need
   * me", and a number that has to be read is a different component.
   *
   * It carries an accessible label rather than relying on colour, because a dot
   * that only means something to people who can see it is decoration.
   */
  dot?: boolean;
  /** What the dot means. Set whenever `dot` is. */
  dotLabel?: string;
}

/* ═══════════════════════════════════════
   Tabs — horizontal + vertical variants
   ═══════════════════════════════════════ */

export interface TabsProps {
  tabs: TabItem[];
  value: string;
  onChange: (value: string) => void;
  variant?: 'underline' | 'pill' | 'vertical';
  ariaLabel?: string;
  /** Render prop for the vertical variant content area. Receives the active tab value. */
  children?: ReactNode | ((activeValue: string) => ReactNode);
}

export function Tabs({
  tabs,
  value,
  onChange,
  variant = 'underline',
  ariaLabel = 'Tabs',
  children,
}: TabsProps) {
  const id = useId();

  /* ─── Vertical variant ──────────────────────────────────────────────── */
  if (variant === 'vertical') {
    return (
      <VerticalTabs id={id} tabs={tabs} value={value} onChange={onChange} ariaLabel={ariaLabel}>
        {children}
      </VerticalTabs>
    );
  }

  /* ─── Horizontal variant ────────────────────────────────────────────── */
  return (
    <HorizontalTabs
      id={id}
      tabs={tabs}
      value={value}
      onChange={onChange}
      variant={variant}
      ariaLabel={ariaLabel}
    />
  );
}

/* ═══════════════════════════════════════
   Vertical Tabs (page-level side nav tabs)
   ═══════════════════════════════════════ */

interface VerticalTabsProps {
  id: string;
  tabs: TabItem[];
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  children?: ReactNode | ((activeValue: string) => ReactNode);
}

function VerticalTabs({ id, tabs, value, onChange, ariaLabel, children }: VerticalTabsProps) {
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const enabledTabs = tabs.filter((tab) => !tab.disabled);
      const currentIdx = enabledTabs.findIndex((tab) => tab.value === value);
      let nextIdx = currentIdx;

      // Both axes: the rail is vertical at >=800px and a horizontal bar below it,
      // so accept Up/Down and Left/Right rather than binding to one orientation.
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        e.preventDefault();
        nextIdx = (currentIdx + 1) % enabledTabs.length;
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault();
        nextIdx = (currentIdx - 1 + enabledTabs.length) % enabledTabs.length;
      } else if (e.key === 'Home') {
        e.preventDefault();
        nextIdx = 0;
      } else if (e.key === 'End') {
        e.preventDefault();
        nextIdx = enabledTabs.length - 1;
      } else {
        return;
      }

      const next = enabledTabs[nextIdx];
      if (next) onChange(next.value);
    },
    [tabs, value, onChange],
  );

  const content = typeof children === 'function' ? children(value) : children;
  const iconOnly = useIconOnly();
  const listRef = useRef<HTMLDivElement>(null);
  useHorizontalWheelScroll(listRef);

  return (
    <div className={t.verticalWrapper}>
      <div
        ref={listRef}
        className={t.verticalTabList}
        role="tablist"
        aria-label={ariaLabel}
        aria-orientation="vertical"
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        {tabs.map((tab) => {
          const isActive = tab.value === value;
          // The label only collapses when there is an icon to fall back on —
          // otherwise hiding it would leave an empty button.
          const collapsible = Boolean(tab.icon);
          const button = (
            <button
              key={tab.value}
              id={`${id}-tab-${tab.value}`}
              role="tab"
              type="button"
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              disabled={tab.disabled}
              className={`${t.verticalTab} ${isActive ? t.verticalTabActive : ''}`}
              onClick={() => {
                if (!tab.disabled) onChange(tab.value);
              }}
            >
              {tab.icon && (
                <span style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}>
                  {tab.icon}
                </span>
              )}
              <span className={collapsible ? t.verticalTabLabel : undefined}>{tab.label}</span>
              {tab.dot && (
                <span className={t.tabDot} role="status" aria-label={tab.dotLabel ?? 'Attention'} />
              )}
            </button>
          );

          // Icon-only (<640px): the label is painted off-screen, so surface it on
          // hover/focus via the DS tooltip. Above that the label is visible and a
          // tooltip would just be noise.
          return iconOnly && collapsible ? (
            <Tooltip key={tab.value} content={tab.label} side="bottom">
              {button}
            </Tooltip>
          ) : (
            button
          );
        })}
      </div>
      <div className={t.verticalContent}>{content}</div>
    </div>
  );
}

/* ═══════════════════════════════════════
   Horizontal Tabs (original behavior)
   ═══════════════════════════════════════ */

interface HorizontalTabsProps {
  id: string;
  tabs: TabItem[];
  value: string;
  onChange: (value: string) => void;
  variant: 'underline' | 'pill';
  ariaLabel: string;
}

function HorizontalTabs({ id, tabs, value, onChange, variant, ariaLabel }: HorizontalTabsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(tabs.length);
  const isPill = variant === 'pill';
  const iconOnly = useIconOnly();

  const measure = useCallback(() => {
    if (!containerRef.current || !measureRef.current || isPill) {
      setVisibleCount(tabs.length);
      return;
    }
    const containerW = containerRef.current.offsetWidth;
    if (containerW === 0) {
      setVisibleCount(tabs.length);
      return;
    }

    // Measure total width of all tabs using scrollWidth of the hidden row
    const totalW = measureRef.current.scrollWidth;
    if (totalW <= containerW) {
      setVisibleCount(tabs.length);
      return;
    }

    // Not all fit — figure out how many fit with overflow button reserved
    const overflowReserve = 80;
    let usedW = 0;
    let count = 0;
    const children = Array.from(measureRef.current.children) as HTMLElement[];

    for (const child of children) {
      const childW = child.scrollWidth || child.offsetWidth;
      if (usedW + childW + overflowReserve > containerW) {
        break;
      }
      usedW += childW;
      count++;
    }

    setVisibleCount(Math.max(1, count));
  }, [tabs.length, isPill]);

  useEffect(() => {
    // Delay initial measurement to ensure layout is complete
    const raf = requestAnimationFrame(() => measure());
    const ro = new ResizeObserver(() => measure());
    if (containerRef.current) ro.observe(containerRef.current);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [measure]);

  useEffect(() => {
    measure();
  }, [tabs, measure]);

  const visibleTabs = tabs.slice(0, visibleCount);
  const overflowTabs = tabs.slice(visibleCount);
  const hasOverflow = overflowTabs.length > 0;
  const overflowHasActive = overflowTabs.some((tab) => tab.value === value);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const enabledTabs = tabs.filter((tab) => !tab.disabled);
      const currentIdx = enabledTabs.findIndex((tab) => tab.value === value);
      let nextIdx = currentIdx;

      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        nextIdx = (currentIdx + 1) % enabledTabs.length;
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        nextIdx = (currentIdx - 1 + enabledTabs.length) % enabledTabs.length;
      } else if (e.key === 'Home') {
        e.preventDefault();
        nextIdx = 0;
      } else if (e.key === 'End') {
        e.preventDefault();
        nextIdx = enabledTabs.length - 1;
      } else {
        return;
      }

      const next = enabledTabs[nextIdx];
      if (next) onChange(next.value);
    },
    [tabs, value, onChange],
  );

  const tabCls = isPill ? t.tabPill : t.tab;
  const tabActiveCls = isPill ? t.tabPillActive : t.tabActive;
  const listCls = isPill ? `${t.tabList} ${t.tabListPill}` : t.tabList;

  return (
    <div
      ref={containerRef}
      className={listCls}
      role="tablist"
      aria-label={ariaLabel}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      style={{ position: 'relative' }}
    >
      {/* Hidden measurement row — always renders ALL tabs so we can measure on resize-up */}
      <div
        ref={measureRef}
        aria-hidden="true"
        style={{
          position: 'absolute',
          visibility: 'hidden',
          display: 'flex',
          gap: 'inherit',
          pointerEvents: 'none',
          top: 0,
          left: 0,
          whiteSpace: 'nowrap',
        }}
      >
        {tabs.map((tab) => (
          <span key={tab.value} className={tabCls} style={{ flexShrink: 0 }}>
            {tab.icon && (
              <span style={{ display: 'inline-flex', alignItems: 'center' }}>{tab.icon}</span>
            )}
            {/* Same label class as the real buttons so measurement matches at every width */}
            <span className={tab.icon ? t.verticalTabLabel : undefined}>{tab.label}</span>
            {/* Measured too: a dot takes width, and a measurement pass that omits
                it under-reports the tab and collapses one tab later than it should. */}
            {tab.dot && <span className={t.tabDot} />}
          </span>
        ))}
      </div>

      {/* Visible tabs */}
      <div className={t.tabListInner}>
        {visibleTabs.map((tab) => {
          const isActive = tab.value === value;
          // The label only collapses when there is an icon to fall back on —
          // otherwise hiding it would leave an empty button.
          const collapsible = Boolean(tab.icon);
          const button = (
            <button
              key={tab.value}
              id={`${id}-tab-${tab.value}`}
              role="tab"
              type="button"
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              disabled={tab.disabled}
              className={`${tabCls} ${isActive ? tabActiveCls : ''}`}
              onClick={() => {
                if (!tab.disabled) onChange(tab.value);
              }}
            >
              {tab.icon && (
                <span style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}>
                  {tab.icon}
                </span>
              )}
              <span className={collapsible ? t.verticalTabLabel : undefined}>{tab.label}</span>
            </button>
          );

          // Icon-only (<640px): the label is painted off-screen, so surface it
          // on hover/focus via the DS tooltip — same treatment as the vertical rail.
          return iconOnly && collapsible ? (
            <Tooltip key={tab.value} content={tab.label} side="bottom">
              {button}
            </Tooltip>
          ) : (
            button
          );
        })}
      </div>

      {hasOverflow && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={`${t.overflowBtn} ${overflowHasActive ? t.overflowBtnActive : ''}`}
              aria-label="More tabs"
            >
              More
              <ChevronDown size={14} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {overflowTabs.map((tab) => (
              <DropdownMenuItem
                key={tab.value}
                onSelect={() => onChange(tab.value)}
                disabled={tab.disabled}
                checked={tab.value === value}
                checkStyle="dot"
              >
                {tab.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════
   TabPanel — content area
   ═══════════════════════════════════════ */

export interface TabPanelProps {
  value: string;
  activeValue: string;
  children: ReactNode;
  /** Use flush layout (no padding, flex column) for list-heavy content */
  flush?: boolean;
}

export function TabPanel({ value, activeValue, children, flush }: TabPanelProps) {
  if (value !== activeValue) return null;
  return (
    <div role="tabpanel" className={flush ? t.verticalPanelFlush : t.tabPanel}>
      {children}
    </div>
  );
}

/* ═══════════════════════════════════════
   VerticalTabPanel — for use inside vertical Tabs children
   ═══════════════════════════════════════ */

export interface VerticalTabPanelProps {
  value: string;
  activeValue: string;
  children: ReactNode;
  /** Use flush layout (no padding, flex column) for list-heavy content with action bars */
  flush?: boolean;
}

export function VerticalTabPanel({ value, activeValue, children, flush }: VerticalTabPanelProps) {
  if (value !== activeValue) return null;
  return (
    <div role="tabpanel" className={flush ? t.verticalPanelFlush : t.verticalPanel}>
      {children}
    </div>
  );
}
