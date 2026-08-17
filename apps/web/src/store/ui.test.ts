import { describe, it, expect, beforeEach, vi } from 'vitest';
import fc from 'fast-check';

/*
 * Preferences persist through the API now, not localStorage. Chromium keys
 * localStorage by origin and the origin includes the port, which the backend
 * re-picks on every launch (ADR-036) — so every setting silently reset each
 * time the app opened. The persistence PROPERTIES below are unchanged; only
 * the place they are asserted against moved.
 */
const prefSet = vi.fn().mockResolvedValue({ key: 'k' });
vi.mock('../lib/api/index.js', () => ({
  api: {
    preferences: {
      list: () => Promise.resolve({}),
      set: (k: string, v: string) => prefSet(k, v),
      remove: () => Promise.resolve(undefined),
    },
  },
}));

const { useUIStore, OFFICIAL_THEMES, resolveTheme } = await import('./ui.js');

describe('useUIStore', () => {
  beforeEach(() => {
    useUIStore.setState({ sidebarOpen: true, sidebarCollapsed: false });
    localStorage.clear();
  });

  it('starts with sidebar open', () => {
    expect(useUIStore.getState().sidebarOpen).toBe(true);
  });

  it('toggleSidebar flips state', () => {
    useUIStore.getState().toggleSidebar();
    expect(useUIStore.getState().sidebarOpen).toBe(false);
    useUIStore.getState().toggleSidebar();
    expect(useUIStore.getState().sidebarOpen).toBe(true);
  });

  it('setSidebarOpen sets explicit value', () => {
    useUIStore.getState().setSidebarOpen(false);
    expect(useUIStore.getState().sidebarOpen).toBe(false);
    useUIStore.getState().setSidebarOpen(true);
    expect(useUIStore.getState().sidebarOpen).toBe(true);
  });

  // sidebarCollapsed basics
  it('starts with sidebarCollapsed false', () => {
    expect(useUIStore.getState().sidebarCollapsed).toBe(false);
  });

  it('setSidebarCollapsed sets explicit value', () => {
    useUIStore.getState().setSidebarCollapsed(true);
    expect(useUIStore.getState().sidebarCollapsed).toBe(true);
    useUIStore.getState().setSidebarCollapsed(false);
    expect(useUIStore.getState().sidebarCollapsed).toBe(false);
  });

  // Property 1: Toggle involution
  // Feature: collapsible-navigation, Property 1: Toggle involution
  it('toggleSidebarCollapsed involution: toggling twice returns to original [Property 1]', () => {
    fc.assert(
      fc.property(fc.boolean(), (initial) => {
        useUIStore.setState({ sidebarCollapsed: initial });
        useUIStore.getState().toggleSidebarCollapsed();
        useUIStore.getState().toggleSidebarCollapsed();
        expect(useUIStore.getState().sidebarCollapsed).toBe(initial);
      }),
      { numRuns: 20 },
    );
  });

  // Property 6: Persistence round trip
  // Feature: collapsible-navigation, Property 6: Persistence round trip
  it('sidebarCollapsed is persisted on change [Property 6]', () => {
    fc.assert(
      fc.property(fc.boolean(), (value) => {
        prefSet.mockClear();
        useUIStore.getState().setSidebarCollapsed(value);
        // Asserted against what was WRITTEN OUT, not against the store's own
        // state — otherwise the test passes on a persist layer that drops
        // everything, which is precisely the bug this replaced.
        expect(prefSet).toHaveBeenCalled();
        const [, blob] = prefSet.mock.calls.at(-1)!;
        expect(JSON.parse(blob).state.sidebarCollapsed).toBe(value);
      }),
      { numRuns: 20 },
    );
  });

  // Unit test: default state when localStorage is empty (Req 4.3)
  it('sidebarCollapsed defaults to false when localStorage has no entry', async () => {
    localStorage.removeItem('budget-tracker-ui');
    vi.resetModules();
    const mod = await import('./ui.js');
    expect(mod.useUIStore.getState().sidebarCollapsed).toBe(false);
  });
});

/**
 * Transactions-page display preferences.
 *
 * Persisted deliberately: they describe how the user reads that page, so
 * losing them on reload would mean re-enabling "show snoozed" every time you
 * went looking for a row you had accidentally silenced.
 */
describe('transactions display preferences', () => {
  beforeEach(() => {
    localStorage.removeItem('budget-tracker-ui');
    vi.resetModules();
  });

  it('defaults to showing upcoming rows and hiding snoozed ones', async () => {
    const mod = await import('./ui.js');
    const s = mod.useUIStore.getState();
    // Different defaults on purpose: upcoming rows are the normal reading of
    // the page; a snooze is a deliberate "not now" and should stay quiet.
    expect(s.showAnticipations).toBe(true);
    expect(s.showSnoozed).toBe(false);
  });

  it('persists both toggles', () => {
    prefSet.mockClear();
    useUIStore.getState().setShowAnticipations(false);
    useUIStore.getState().setShowSnoozed(true);

    const [, blob] = prefSet.mock.calls.at(-1)!;
    const stored = JSON.parse(blob);
    expect(stored.state.showAnticipations).toBe(false);
    expect(stored.state.showSnoozed).toBe(true);
  });
});

/**
 * Retiring a theme is not just removing it from a list.
 *
 * The selected theme is persisted in localStorage under `budget-tracker-ui`, so
 * on the day the five themes were retired every existing browser was holding a
 * value that is no longer offered. Without a migration the store keeps handing
 * that value out forever: settings shows nothing selected, and the app renders a
 * theme the user cannot see listed.
 */
describe('theme retirement', () => {
  it('offers exactly the Empire pair', () => {
    expect([...OFFICIAL_THEMES]).toEqual([
      'empire',
      'empire-dark',
      'empire-midnight',
      'empire-oled',
    ]);
  });

  it('keeps an already-offered theme untouched', () => {
    for (const t of OFFICIAL_THEMES) expect(resolveTheme(t)).toBe(t);
  });

  it('moves every retired theme to its nearest offered one', () => {
    // Light-family to Empire, dark-family to Empire Dark — a user who chose a
    // dark theme should not be handed a light one.
    expect(resolveTheme('light')).toBe('empire');
    expect(resolveTheme('arctic')).toBe('empire');
    expect(resolveTheme('cipherpunk')).toBe('empire');
    expect(resolveTheme('dark')).toBe('empire-dark');
    expect(resolveTheme('midnight')).toBe('empire-dark');
  });

  it('sends a renamed key to its new name, not to the light default', () => {
    // 'empire-ash' was 'empire-midnight' for part of 2026-08-10. Without the
    // mapping this returns 'empire' — a silent dark-to-light flip.
    expect(resolveTheme('empire-ash')).toBe('empire-midnight');
  });

  it('falls back rather than passing through anything unrecognised', () => {
    // A hand-edited localStorage value, or one from a build since rolled back.
    // Returning it unchanged would put an unresolvable class on the theme
    // wrapper, which renders as the browser's own defaults.
    for (const junk of ['', 'nope', 'Empire', undefined, null, 42, {}]) {
      expect(resolveTheme(junk)).toBe('empire');
    }
  });
});
