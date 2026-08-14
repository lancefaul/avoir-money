/**
 * The app's root scale.
 *
 * `globals.css.ts` renders this as `html { font-size: <N>% }`, which scales
 * every `rem` in the system — spacing, radii, type, component sizing. It exists
 * because the app reads best at what used to require 110% browser zoom.
 *
 * **Breakpoints are derived from this, not written beside it.** That coupling is
 * the whole reason this constant is a module rather than a literal: media
 * queries are the one thing a root font-size does NOT move (inside a media
 * query, `em` and `rem` resolve against the browser's initial font size, never
 * against `html`), so raising the scale without raising the breakpoints leaves
 * the app switching to its narrow layouts at the same window widths while the
 * content inside them is 10% wider. It overflows. See `breakpoints.ts`.
 *
 * Change this one number and both follow.
 */
export const ROOT_SCALE = 1.1;
