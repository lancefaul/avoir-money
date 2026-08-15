/**
 * The single source of truth for responsive thresholds, in real CSS pixels.
 *
 * Before this module the numbers lived in ~30 files — 25 named constants, 14 CSS
 * media queries, and a handful of inline `matchMedia` strings. Two of them
 * disagreed: `1023.98` and `1024` were both in use for the same threshold, so
 * two components differed by a hundredth of a pixel about where "tablet" begins.
 *
 * ## These are measured, not derived
 *
 * An earlier version computed each value as `designWidth × ROOT_SCALE`, which
 * was the right shape for the *migration* — the app moved to a 110% root scale,
 * and a media query is the one thing `html { font-size }` does not move (inside
 * a media query `em` and `rem` resolve against the browser's initial font size,
 * never against the root), so every threshold had to move with it.
 *
 * That derivation is deliberately gone. Once thresholds are tuned by eye AT the
 * current scale, re-deriving them from that same scale is circular: you adjust a
 * number until the layout looks right, and the formula immediately multiplies it
 * by the factor you already accounted for. The values below are simply where the
 * layouts should switch. `ROOT_SCALE` still drives the root font size in
 * `globals.css.ts`; it no longer touches these.
 *
 * **If `ROOT_SCALE` ever changes, these need a fresh pass by eye.** That is a
 * real cost of storing measured values, and it is the accepted trade: the app is
 * tuned at one scale and is not expected to move between scales.
 */

/**
 * Thresholds in CSS pixels, ascending.
 *
 * There was briefly an `ml` step at 748, one notch above `md`, for "the page
 * header collapses and tables drop columns". It was retired once `md` moved to
 * 740 and the two were 8px apart — but the deciding fact was not the distance:
 * NO component used both. Every `ml` site (the header title-row, the
 * transactions header, the transaction list, the pay-period card, Recurring)
 * had exactly one narrow state, so the pair never expressed two things. Merging
 * collapsed nothing.
 */
const WIDTHS = {
  /** Tightest — icon-only toolbars. */
  xs: 550,
  /** Drop secondary columns. */
  sm: 594,
  /**
   * The workhorse. Phone/tablet split, and where page headers collapse and
   * tables start dropping columns — the former `ml` responsibilities.
   */
  md: 740,
  /** Tablet/desktop split. */
  lg: 880,
  /** Force the sidebar collapsed. */
  xl: 1140,
  /** Widest — opt into extra columns. */
  xxl: 1320,
} as const;

export type Breakpoint = keyof typeof WIDTHS;

/** Two decimals — these end up in CSS strings, so 703.9800000000001 is not ok. */
const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Threshold in CSS pixels — use with `min-width`.
 *
 * `bp.md` is "md and up".
 */
export const bp: Record<Breakpoint, number> = { ...WIDTHS };

/**
 * Threshold in CSS pixels — use with `max-width`.
 *
 * A hundredth under `bp`, so `below.md` and `bp.md` can be used as a pair
 * without both matching at exactly the same width. This is the `.98` convention
 * that was previously written by hand at every call site, which is how
 * `1023.98` and `1024` came to mean the same thing in different files.
 */
export const below = Object.fromEntries(
  Object.entries(bp).map(([k, v]) => [k, round2(v - 0.02)]),
) as Record<Breakpoint, number>;

/** `@media` condition for "this width and up". */
export const from = (k: Breakpoint): string => `screen and (min-width: ${bp[k]}px)`;

/** `@media` condition for "narrower than this". */
export const upTo = (k: Breakpoint): string => `screen and (max-width: ${below[k]}px)`;
