import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ReactNode } from 'react';

export type ThemeKey =
  | 'light'
  | 'arctic'
  | 'dark'
  | 'midnight'
  | 'cipherpunk'
  | 'empire'
  | 'empire-dark'
  | 'empire-midnight'
  | 'empire-oled';

/**
 * The themes a user can actually choose. Retired 2026-08-09: Empire and Empire
 * Dark are the app's themes now.
 *
 * The other five are kept, exported and registered — they still compile, still
 * carry their guardrail assertions, and can be brought back by adding them
 * here. `ThemeKey` deliberately still names them, because a browser that
 * persisted one of them must still produce a value this type accepts long
 * enough for the migration below to rewrite it.
 *
 * This is the single source of truth: ThemeGallery renders from it rather than
 * keeping its own list, so the two cannot drift.
 */
export const OFFICIAL_THEMES = [
  'empire',
  'empire-dark',
  'empire-midnight',
  'empire-oled',
] as const satisfies readonly ThemeKey[];

/** Where a retired theme sends a user who had it selected. */
const RETIRED_THEMES: Record<string, ThemeKey | undefined> = {
  light: 'empire',
  arctic: 'empire',
  cipherpunk: 'empire',
  dark: 'empire-dark',
  midnight: 'empire-dark',
  // Not a retirement — a rename. 'empire-ash' was this theme's key for part of
  // 2026-08-10 before it was renamed to 'empire-midnight'. Anyone who selected
  // it in that window has the old key in localStorage, and without this line
  // `resolveTheme` would treat it as unknown and drop them to Empire LIGHT —
  // a dark-to-light flip with no visible cause. Renaming a persisted value is
  // never just a rename.
  'empire-ash': 'empire-midnight',
};

/**
 * A stored theme is only trustworthy if it is still offered. Anyone sitting on
 * a retired theme has it in localStorage under `budget-tracker-ui`, and without
 * this they would keep rendering a theme the settings page no longer lists.
 */
export const resolveTheme = (stored: unknown): ThemeKey => {
  if (typeof stored !== 'string') return 'empire';
  // `find` rather than `includes`: it narrows to the tuple's own union, so the
  // offered-theme case needs no cast to be typed correctly.
  const offered = OFFICIAL_THEMES.find((t) => t === stored);
  return offered ?? RETIRED_THEMES[stored] ?? 'empire';
};

interface UIState {
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  pageTitle: ReactNode;
  setPageTitle: (title: ReactNode) => void;
  pageAction: ReactNode | null;
  setPageAction: (action: ReactNode | null) => void;
  pageSearch: ReactNode | null;
  setPageSearch: (search: ReactNode | null) => void;
  pageSubBar: ReactNode | null;
  setPageSubBar: (subBar: ReactNode | null) => void;
  sidebarCollapsed: boolean;
  toggleSidebarCollapsed: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  theme: ThemeKey;
  setTheme: (theme: ThemeKey) => void;
  useSystemTheme: boolean;
  setUseSystemTheme: (use: boolean) => void;
  settingsOpen: boolean;
  openSettings: () => void;
  closeSettings: () => void;
  notificationsOpen: boolean;
  openNotifications: () => void;
  closeNotifications: () => void;
  hiddenAccountIds: string[];
  hideAccount: (id: string) => void;
  unhideAccount: (id: string) => void;
  /**
   * Show upcoming scheduled rows on the Transactions page. Default on — seeing
   * what is coming is the normal reading of that page.
   */
  showAnticipations: boolean;
  setShowAnticipations: (show: boolean) => void;
  /**
   * Also show anticipations that have been snoozed. Default off, because a
   * snooze is a deliberate "not now" and the page should stay quiet. It exists
   * so an accidental snooze can be found again — without it the row is not
   * deleted, merely invisible here, and had to be hunted down elsewhere.
   */
  showSnoozed: boolean;
  setShowSnoozed: (show: boolean) => void;
}

/**
 * Exactly the slice that reaches localStorage.
 *
 * Named so `partialize` and `migrate` are checked against the same shape. They
 * are two halves of one contract — what goes out and what comes back — and
 * typing the migration as the full `UIState` would have claimed the stored blob
 * carries the store's action methods, which it does not.
 */
type PersistedUIState = Pick<
  UIState,
  | 'sidebarCollapsed'
  | 'theme'
  | 'useSystemTheme'
  | 'hiddenAccountIds'
  | 'showAnticipations'
  | 'showSnoozed'
>;

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarOpen: true,
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      pageTitle: '',
      setPageTitle: (title) => set({ pageTitle: title }),
      pageAction: null,
      setPageAction: (action) => set({ pageAction: action }),
      pageSearch: null,
      setPageSearch: (search) => set({ pageSearch: search }),
      pageSubBar: null,
      setPageSubBar: (subBar) => set({ pageSubBar: subBar }),
      sidebarCollapsed: false,
      toggleSidebarCollapsed: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      theme: 'empire',
      setTheme: (theme) => set({ theme }),
      useSystemTheme: false,
      setUseSystemTheme: (use) => set({ useSystemTheme: use }),
      settingsOpen: false,
      openSettings: () => set({ settingsOpen: true }),
      closeSettings: () => set({ settingsOpen: false }),
      notificationsOpen: false,
      openNotifications: () => set({ notificationsOpen: true }),
      closeNotifications: () => set({ notificationsOpen: false }),
      showAnticipations: true,
      setShowAnticipations: (show) => set({ showAnticipations: show }),
      showSnoozed: false,
      setShowSnoozed: (show) => set({ showSnoozed: show }),
      hiddenAccountIds: [],
      hideAccount: (id) => set((s) => ({ hiddenAccountIds: [...s.hiddenAccountIds, id] })),
      unhideAccount: (id) =>
        set((s) => ({ hiddenAccountIds: s.hiddenAccountIds.filter((x) => x !== id) })),
    }),
    {
      name: 'budget-tracker-ui',
      // Rewrites a persisted retired theme on rehydrate. Without it the store
      // keeps handing out e.g. 'dark' forever: the settings page would show no
      // selection, and the app would render a theme that is no longer offered.
      version: 1,
      // Return type is deliberately the PARTIAL shape, and inferred rather than
      // asserted. A blob written by an older build can be missing keys, and
      // zustand merges whatever comes back over the store's defaults — so
      // claiming a complete state here would be a lie the compiler believed.
      migrate: (persisted, _version): Partial<PersistedUIState> => {
        // Spread, never a field list: everything else in the persisted blob —
        // sidebarCollapsed, hiddenAccountIds, both display toggles — has to
        // survive, and naming fields here would silently drop whichever ones
        // someone forgets to add when `partialize` next grows.
        const s = (persisted ?? {}) as Partial<PersistedUIState>;
        return { ...s, theme: resolveTheme(s.theme) };
      },
      partialize: (state): PersistedUIState => ({
        sidebarCollapsed: state.sidebarCollapsed,
        theme: state.theme,
        useSystemTheme: state.useSystemTheme,
        hiddenAccountIds: state.hiddenAccountIds,
        // Persisted: both are settings about how the user reads the page, not
        // transient view state, so they should survive a reload (ADR-005).
        showAnticipations: state.showAnticipations,
        showSnoozed: state.showSnoozed,
      }),
    },
  ),
);
