import { style } from '@vanilla-extract/css';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';

/**
 * `-webkit-app-region`, which the type system does not know about.
 *
 * It is the Chromium-only property that makes part of a frameless window
 * draggable, so csstype does not model it and vanilla-extract's `style()`
 * rejects it in an inline literal. Three routes were tried and this is the one
 * that costs nothing:
 *
 *   - Augmenting `csstype` is the textbook answer and silently does nothing
 *     here. `csstype` is a transitive dependency that pnpm does not link into
 *     `apps/web`, so `declare module 'csstype'` resolves to no module and TS
 *     reads it as a brand-new ambient declaration — no error, no effect. Making
 *     it work means adding a dependency to say one word.
 *   - `as ComplexStyleRule` does not typecheck inside a `style([])` composition.
 *   - Spreading a value that is not a fresh object literal skips excess-property
 *     checking, which is what this does.
 *
 * The explicit return type is the part that matters: without it the loophole
 * would swallow `WebkitAppRegionn` too, which is exactly the mistake the
 * augmentation existed to prevent. Here a typo fails inside this function, and
 * callers can only pass the two values the property accepts.
 */
const appRegion = (value: 'drag' | 'no-drag'): { WebkitAppRegion: 'drag' | 'no-drag' } => ({
  WebkitAppRegion: value,
});

/**
 * The app's own title bar, for a frameless window.
 *
 * `2.25rem` rather than a number picked to look right: it is `navItemBase`'s
 * height, so the bar matches the rhythm of the rail below it instead of
 * introducing a fourth vertical measure into the chrome.
 *
 * `WebkitAppRegion: 'drag'` is what makes it a title bar rather than a strip of
 * page — without it the window cannot be moved at all, which is the first thing
 * anyone tries. It is declared on the bar and opted OUT of on every control,
 * because the property inherits: a button inside a drag region drags the window
 * instead of being clicked.
 */
export const bar = style({
  ...appRegion('drag'),
  display: 'flex',
  alignItems: 'center',
  height: '2.25rem',
  flexShrink: 0,
  background: vars.color.surfaceRaised,
  borderBottom: `${vars.border.hairline} solid ${vars.color.border}`,
  paddingInlineStart: vars.space['3'],
  // The bar is chrome, not content. Selecting the product name mid-drag is
  // never wanted and looks like a bug when it happens.
  userSelect: 'none',
});

export const brand = style({
  display: 'flex',
  alignItems: 'center',
  gap: vars.space['2'],
  minWidth: 0,
});

/**
 * The app mark.
 *
 * `avoir-app-icon-round.png`, which is a BADGE — it carries its own dark-green
 * ground — so it reads correctly on any of the nine themes' surfaces. That is
 * the property that matters here, and it is not shared by every mark in
 * `public/`: `avoir-monogram.png` and both lockups are cream on transparent,
 * drawn for the dark rail, and would disappear on a light title bar.
 *
 * No `borderRadius`: the asset is already a circle, and rounding a circle is
 * either a no-op or a crop.
 */
export const mark = style({
  width: '1.125rem',
  height: '1.125rem',
  flexShrink: 0,
});

/**
 * The product name.
 *
 * The display face, because this is the one place in the chrome that is purely
 * brand — every other use of `font.display` in the app is a number or a heading
 * that earns its weight. `sm` keeps it from competing with the page title
 * directly below it, which is the actual answer to "where am I".
 */
export const name = style({
  fontFamily: vars.font.display,
  fontSize: vars.font.sm,
  color: vars.color.textSecondary,
  letterSpacing: '0.02em',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
});

/** Pushes the controls to the trailing edge and gives the drag region its width. */
export const spacer = style({
  flex: 1,
  minWidth: vars.space['4'],
});

export const controls = style({
  // Opting out is not optional: `drag` inherits, so without this the three
  // buttons would move the window instead of being clicked.
  ...appRegion('no-drag'),
  display: 'flex',
  alignItems: 'stretch',
  flexShrink: 0,
  alignSelf: 'stretch',
});

/**
 * One window button.
 *
 * Full-height and square-cornered on purpose: window controls are conventionally
 * flush to the top-right corner with no gap, so the close button is reachable by
 * throwing the pointer at the corner without aiming. A rounded, inset button
 * would look tidier and cost that.
 *
 * Not `IconButton`: that component is round-cornered, sized on a padding scale,
 * and carries a tooltip on every instance. Three tooltips following the pointer
 * along the top edge of the window is noise for controls whose meaning is
 * universal — the accessible name is carried by `aria-label` instead, which is
 * what the tooltip would have supplied anyway.
 */
export const button = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '2.875rem',
  border: 'none',
  background: 'transparent',
  color: vars.color.textSecondary,
  cursor: 'pointer',
  padding: 0,
  transition: `background ${vars.duration.fast} ${vars.easing.default}, color ${vars.duration.fast} ${vars.easing.default}`,
  selectors: {
    '&:hover': {
      background: vars.color.surfaceHover,
      color: vars.color.textPrimary,
    },
    '&:focus-visible': {
      outline: 'none',
      boxShadow: vars.focus.shadow,
      // The ring is drawn inside, because the button is flush to the window
      // edge and a ring that overflows would be clipped on two sides.
      position: 'relative',
      zIndex: 1,
    },
  },
});

/**
 * Close, which is the one that gets a colour.
 *
 * Red-on-hover for the close button is universal across every desktop, and it
 * is the one place in the app where a semantic colour is doing wayfinding
 * rather than reporting meaning. DESIGN.md reserves `danger` for meaning — this
 * is the convention that predates the rule and would be conspicuous by its
 * absence, so it is a deliberate exception rather than an oversight.
 */
export const close = style({
  selectors: {
    '&:hover': {
      background: vars.color.danger500,
      color: vars.color.onDanger,
    },
  },
});
