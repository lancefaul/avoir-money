import { useEffect, useState } from 'react';
import { Outlet, useRouterState, useNavigate } from '@tanstack/react-router';
import {
  LayoutDashboard,
  ArrowLeftRight,
  Mail,
  Wallet,
  RefreshCw,
  TrendingUp,
  Landmark,
  Zap,
  Heart,
  Bell,
  Settings,
  PanelRightOpen,
} from 'lucide-react';
import {
  SideNav,
  SideNavLayout,
  SideNavContent,
  DisplayHeading,
  type NavItem,
  brandIconImage,
} from '@budget-tracker/ui';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import TitleBar from './TitleBar.js';
import { lightTheme } from '@budget-tracker/ui/theme/theme-light.css.js';
import { arcticTheme } from '@budget-tracker/ui/theme/theme-arctic.css.js';
import { darkTheme } from '@budget-tracker/ui/theme/theme-dark.css.js';
import { midnightTheme } from '@budget-tracker/ui/theme/theme-midnight.css.js';
import { cipherpunkTheme } from '@budget-tracker/ui/theme/theme-cipherpunk.css.js';
import { empireTheme } from '@budget-tracker/ui/theme/theme-empire.css.js';
import { empireDarkTheme } from '@budget-tracker/ui/theme/theme-empire-dark.css.js';
import { empireMidnightTheme } from '@budget-tracker/ui/theme/theme-empire-midnight.css.js';
import { empireOledTheme } from '@budget-tracker/ui/theme/theme-empire-oled.css.js';
import ToastContainer from './ToastContainer.js';
import NotificationsDrawer from './NotificationsDrawer.js';
import { useUIStore } from '../store/ui.js';
import { useIsNarrow } from '../hooks/useIsNarrow.js';
import type { ThemeKey } from '../store/ui.js';
import { below } from '@budget-tracker/ui/theme/breakpoints.js';

const themeClassMap: Record<ThemeKey, string> = {
  light: lightTheme,
  arctic: arcticTheme,
  dark: darkTheme,
  midnight: midnightTheme,
  cipherpunk: cipherpunkTheme,
  empire: empireTheme,
  'empire-dark': empireDarkTheme,
  'empire-midnight': empireMidnightTheme,
  'empire-oled': empireOledTheme,
};

/**
 * Retired themes stay in the map on purpose. A stored theme is migrated to an
 * offered one on rehydrate, but this is what renders in the window before that
 * lands — and an unresolved class means no theme class at all, which is the
 * browser's own black-on-anything defaults rather than a wrong-but-styled page.
 */
const themeClassFor = (t: ThemeKey): string => themeClassMap[t] ?? empireTheme;

/** Routes that use a subnav layout (absolute positioned, no padding, full height). */
const SUBNAV_ROUTES = ['/settings', '/healthcare', '/investments', '/utilities', '/accounts'];

/** Every nav destination the app knows about, including any not currently shown. */
const ALL_NAV_ITEMS: NavItem[] = [
  { value: '/', label: 'Dashboard', icon: <LayoutDashboard size={16} /> },
  { value: '/transactions', label: 'Transactions', icon: <ArrowLeftRight size={16} /> },
  { value: '/recurring', label: 'Recurring', icon: <RefreshCw size={16} /> },
  { value: '/accounts', label: 'Accounts', icon: <Wallet size={16} /> },
  { value: '/budgets', label: 'Budgets', icon: <Mail size={16} /> },
  { value: '/debts', label: 'Debts', icon: <Landmark size={16} /> },
  { value: '/utilities', label: 'Utilities', icon: <Zap size={16} /> },
  { value: '/investments', label: 'Investments', icon: <TrendingUp size={16} /> },
  { value: '/healthcare', label: 'Health Insurance', icon: <Heart size={16} /> },
  {
    value: '/notifications',
    label: 'Notifications',
    icon: <Bell size={16} />,
    rightIcon: <PanelRightOpen size={16} />,
    pinBottom: true,
  },
  { value: '/settings', label: 'Settings', icon: <Settings size={16} />, pinBottom: true },
];

/**
 * Destinations built but not currently offered.
 *
 * Notifications is on hold. The nav was still advertising it, so the only way
 * to find that out was to click it. Hidden rather than deleted: the drawer, its
 * store slice, and the open handler below all stay wired, so resuming the
 * feature is deleting an entry here rather than rebuilding the entry point.
 * Filtering also keeps the item's definition (and its icons) live code, which a
 * commented-out block would not.
 */
const HIDDEN_NAV_VALUES = new Set<string>(['/notifications']);

const navItems: NavItem[] = ALL_NAV_ITEMS.filter((item) => !HIDDEN_NAV_VALUES.has(item.value));

export default function Layout() {
  const {
    sidebarCollapsed,
    setSidebarCollapsed,
    pageTitle,
    pageAction,
    pageSearch,
    pageSubBar,
    theme,
    useSystemTheme,
    setTheme,
    openNotifications,
  } = useUIStore();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();

  // Listen to OS color scheme changes when "Match system settings" is enabled
  useEffect(() => {
    if (!useSystemTheme) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent | MediaQueryList) => {
      // The Empire pair, not 'dark'/'light' — those were retired 2026-08-09 and
      // are no longer offered, so following the OS would have parked the user on
      // a theme the settings page does not list.
      setTheme(e.matches ? 'empire-dark' : 'empire');
    };
    handler(mq);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [useSystemTheme, setTheme]);

  // Force sidebar collapsed at narrow viewports
  const [forceCollapsed, setForceCollapsed] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(`(max-width: ${below.xl}px)`).matches : false,
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${below.xl}px)`);
    const handler = (e: MediaQueryListEvent | MediaQueryList) => setForceCollapsed(e.matches);
    handler(mq);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const effectiveCollapsed = forceCollapsed || sidebarCollapsed;

  // At narrow widths the header search moves into the sub-bar, so the title-row
  // side columns no longer need their fixed 12rem min-widths (which would
  // otherwise overflow and push the action button off small screens).
  const narrow = useIsNarrow(below.md);

  const themeClass = themeClassFor(theme);

  const activeValue =
    navItems.find((n) => (n.value === '/' ? pathname === '/' : pathname.startsWith(n.value)))
      ?.value ?? '/';

  /*
   * One mark in both states, with the wordmark beside it when there is room.
   *
   * It used to swap art: the square icon when collapsed, the stacked cream
   * lockup when open. The lockup could not survive the rail going light — it is
   * cream on transparent, drawn for a dark ground, and it still reads "Avoir
   * FINANCE". The round badge carries its own dark-green ground, so it is the
   * one mark that works on any theme's rail, and `brandText` supplies the name
   * as type that a theme can colour.
   */
  const brandIcon = <img src="/avoir-app-icon-round.png" alt="" className={brandIconImage} />;

  function handleNavChange(val: string) {
    if (val === '/notifications') {
      openNotifications();
    } else {
      navigate({ to: val });
    }
  }

  return (
    <div
      className={themeClass}
      style={{
        height: '100%',
        background: vars.color.background,
        /*
         * A column, so the title bar can sit ABOVE the rail rather than beside
         * it. It has to span the full width: it is the window's drag handle,
         * and a drag region that stopped at the rail would leave the top-left
         * corner of the window immovable.
         *
         * In a browser `TitleBar` renders null and this collapses to exactly
         * what it was — one child filling the height.
         */
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <ToastContainer />
      <NotificationsDrawer />
      <div id="tooltip-portal" />
      <TitleBar />
      {/*
        `SideNavLayout` is `height: 100%`, which in a flex column resolves
        against the WHOLE parent and would run the rail a title bar's worth past
        the bottom of the window. This wrapper gives it a box that is already
        the remaining space, so the DS style stays correct for its other
        consumers and nothing about the rail has to know a title bar exists.
      */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <SideNavLayout>
          <SideNav
            items={navItems}
            value={activeValue}
            onChange={handleNavChange}
            brandIcon={brandIcon}
            // "Avoir" alone: the title bar directly above already says "Avoir
            // Money", and the rail is not the place to say it a second time.
            brandLabel="Avoir"
            collapsed={effectiveCollapsed}
            onCollapsedChange={forceCollapsed ? undefined : setSidebarCollapsed}
          />
          <SideNavContent>
            <div
              style={{
                display: 'flex',
                flex: 1,
                flexDirection: 'column',
                height: '100%',
                overflow: 'hidden',
                background: vars.color.background,
              }}
            >
              <header
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  borderBottom: `${vars.border.thin} solid ${vars.color.border}`,
                  background: vars.color.surfaceRaised,
                  flexShrink: 0,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    height: '3.75rem',
                    alignItems: 'center',
                    gap: vars.space['4'],
                    padding: `0 ${vars.space['4']}`,
                  }}
                >
                  <div
                    style={{
                      minWidth: narrow ? 0 : '12rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: vars.space['2'],
                    }}
                  >
                    {pageTitle && (
                      <DisplayHeading
                        size="sm"
                        as="h1"
                        style={{
                          fontSize: vars.font.xl,
                          display: 'flex',
                          alignItems: 'center',
                          gap: vars.space['2'],
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {pageTitle}
                      </DisplayHeading>
                    )}
                  </div>
                  <div
                    style={{
                      flex: 1,
                      display: 'flex',
                      justifyContent: 'center',
                      overflowY: 'hidden',
                      scrollbarGutter: 'stable',
                      padding: '0.25rem',
                    }}
                  >
                    {pageSearch}
                  </div>
                  <div
                    style={{
                      minWidth: narrow ? 0 : '12rem',
                      display: 'flex',
                      justifyContent: 'flex-end',
                    }}
                  >
                    {pageAction}
                  </div>
                </div>
                {pageSubBar}
              </header>
              <main
                /*
                 * Keyboard-scrollable. On the non-subnav routes this element is
                 * `overflow-y: auto`, so once the page is taller than the viewport
                 * it becomes a scroll region — and a scroll region that cannot be
                 * focused is unreachable by keyboard in browsers that do not focus
                 * it implicitly (axe `scrollable-region-focusable`, WCAG 2.1.1).
                 * `tabIndex={0}` makes the region itself a tab stop so arrow keys
                 * and Page Up/Down work without first tabbing to a control inside.
                 */
                tabIndex={0}
                style={{
                  flex: 1,
                  overflowY: SUBNAV_ROUTES.includes(pathname) ? 'hidden' : 'auto',
                  padding: SUBNAV_ROUTES.includes(pathname)
                    ? 0
                    : `${vars.space['4']} ${vars.space['4']}`,
                  background: vars.color.background,
                  position: 'relative',
                }}
              >
                <div
                  style={{
                    maxWidth: SUBNAV_ROUTES.includes(pathname) ? undefined : '75rem',
                    margin: '0 auto',
                    width: '100%',
                    height: SUBNAV_ROUTES.includes(pathname) ? '100%' : undefined,
                  }}
                >
                  <Outlet />
                </div>
              </main>
            </div>
          </SideNavContent>
        </SideNavLayout>
      </div>
    </div>
  );
}
