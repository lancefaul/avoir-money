import { globalStyle } from '@vanilla-extract/css';
import { ROOT_SCALE } from './scale.js';
import { vars } from './contract.css.js';
import { lightTheme } from './theme-light.css.js';
import { arcticTheme } from './theme-arctic.css.js';
import { darkTheme } from './theme-dark.css.js';
import { midnightTheme } from './theme-midnight.css.js';
import { cipherpunkTheme } from './theme-cipherpunk.css.js';
import { empireTheme } from './theme-empire.css.js';
import { empireDarkTheme } from './theme-empire-dark.css.js';
import { empireMidnightTheme } from './theme-empire-midnight.css.js';
import { empireOledTheme } from './theme-empire-oled.css.js';

/**
 * Root scale — the app renders at 110% of the browser's base font size.
 *
 * This is the "looks best at 110% zoom" setting made permanent, and it works
 * because DESIGN.md's units policy was actually followed: every dimension that
 * lays the app out is in `rem`, so one root value scales spacing, radii, type
 * and component sizing together. The entire px inventory is the three border
 * tokens (the documented exception — hairlines should stay crisp) and the
 * miniature swatch art in ThemeGallery.
 *
 * A PERCENTAGE, deliberately, not `17.6px`. A percentage compounds with
 * whatever the reader has set as their browser default, so someone running
 * larger text still gets larger text; a fixed px value would silently overrule
 * that preference. It also means this is one number to change, not a
 * recalculation.
 *
 * Known limit: the 14 `@media` breakpoints are in px and do NOT move with this,
 * so the app switches to its narrow layouts at the same window widths as before
 * while the content inside them is 10% bigger — unlike real browser zoom, which
 * shrinks the reported viewport and trips breakpoints earlier. Converting them
 * to `em` would NOT help: inside a media query `em` resolves against the
 * browser's initial font size, never against this rule. Left as-is on purpose;
 * the breakpoints (640–1200px) sit far from normal desktop widths, and shifting
 * them is a separate, testable change.
 */
globalStyle('html', {
  fontSize: `${ROOT_SCALE * 100}%`,
});

/**
 * Global scrollbar styles scoped to each theme class.
 * Thin, transparent-track scrollbars with themed thumb color.
 */

const themeClasses = [
  lightTheme,
  arcticTheme,
  darkTheme,
  midnightTheme,
  cipherpunkTheme,
  empireTheme,
  // Omitting a theme here does not fail anything loudly — it silently drops the
  // base `color`/`fontFamily` below, so every element that does not set its own
  // colour falls through to the browser default BLACK, plus default scrollbars
  // and no ::selection styling. That is what happened to Empire Dark between it
  // being added and 2026-08-09, and it presented as "text is black in a lot of
  // places" rather than as anything pointing at this list.
  empireDarkTheme,
  empireMidnightTheme,
  empireOledTheme,
];

for (const cls of themeClasses) {
  /* Webkit (Chrome, Safari, Edge) */
  globalStyle(`${cls} ::-webkit-scrollbar`, {
    width: vars.scrollbar.width,
    height: vars.scrollbar.width,
  });
  globalStyle(`${cls} ::-webkit-scrollbar-track`, {
    background: vars.scrollbar.track,
  });
  globalStyle(`${cls} ::-webkit-scrollbar-thumb`, {
    background: vars.scrollbar.thumb,
    borderRadius: vars.scrollbar.radius,
  });
  globalStyle(`${cls} ::-webkit-scrollbar-thumb:hover`, {
    background: vars.scrollbar.thumbHover,
  });

  /* The wrapper element's own scrollbar */
  globalStyle(`${cls}::-webkit-scrollbar`, {
    width: vars.scrollbar.width,
    height: vars.scrollbar.width,
  });
  globalStyle(`${cls}::-webkit-scrollbar-track`, {
    background: vars.scrollbar.track,
  });
  globalStyle(`${cls}::-webkit-scrollbar-thumb`, {
    background: vars.scrollbar.thumb,
    borderRadius: vars.scrollbar.radius,
  });
  globalStyle(`${cls}::-webkit-scrollbar-thumb:hover`, {
    background: vars.scrollbar.thumbHover,
  });

  /* Firefox */
  globalStyle(`${cls}, ${cls} *`, {
    scrollbarColor: `${vars.scrollbar.thumb} ${vars.scrollbar.track}`,
    scrollbarWidth: 'thin',
  });

  /* Reserve stable space for the scrollbar so layout doesn't shift when
     content changes between scrollable and non-scrollable states. */
  globalStyle(cls, {
    scrollbarGutter: 'stable',
  });

  /* Text selection highlight */
  globalStyle(`${cls} ::selection`, {
    background: vars.focus.color,
    color: vars.color.textOnBrand,
  });

  /* Default text color and font — ensures correct inheritance instead of browser defaults */
  globalStyle(cls, {
    color: vars.color.textPrimary,
    fontFamily: vars.font.ui,
  });
}
