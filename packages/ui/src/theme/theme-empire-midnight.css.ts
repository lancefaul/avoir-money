import { createTheme } from '@vanilla-extract/css';
import { vars } from './contract.css.js';

/**
 * Empire Midnight — Empire Dark with the Ash (theme-dark) neutral ramp.
 *
 * **The name and the donor do not match, deliberately.** This theme is named
 * Midnight and is built from `theme-dark` (labelled "Ash"); its sibling
 * `theme-empire-oled` is named OLED and is built from `theme-midnight`. The
 * names were chosen for how the themes read on screen, after the fact. Do not
 * "correct" either file to agree with its name — check the donor values, not
 * the label, and note that `theme-midnight.css.ts` is a different, retired
 * theme that this one is unrelated to.
 *
 * Generated from `theme-empire-dark.css.ts` by substituting one thing: the
 * neutral scale, and every token that ALIASES a neutral stop. Brand, accent,
 * status, selection, focus, fonts and spacing are byte-identical to Empire Dark
 * — the gold-marks-committed-state / green-marks-interaction scheme is the same
 * theme wearing a different grey.
 *
 * 28 tokens carry a `// = neutralN` comment and were rewritten from the donor.
 * That comment is load-bearing, not decoration — and one token proved it:
 * `onAccent` is commented `// = textOnBrand`, a SECOND-ORDER alias, so the
 * substitution skipped it and left an Empire Dark grey behind on a file that
 * otherwise looked finished. It was caught by diffing every value in the new
 * file against Empire Dark's whole neutral ramp, not by reading the diff.
 * If a token starts aliasing a neutral, give it the direct comment.
 *
 * Contrast figures from the Empire Dark source were stripped rather than
 * recopied: this ramp is darker, so they no longer describe this theme.
 *
 * **THREE VALUES DEVIATE FROM THE DONOR ON PURPOSE — do not regenerate them
 * away.** The donor ramp fails WCAG AA on this darker canvas, so:
 *   - `neutral600` (textSecondary) and `neutral450` (textTertiary) are
 *     raised until they hit Empire Dark's own ratios (8.22:1 / 5.28:1)
 *     rather than its lightness values, because matching lightness across
 *     different canvases matches the wrong thing.
 *   - `textPlaceholder` points at neutral450, not neutral300. neutral300 is
 *     a BORDER stop; reading it as text gave 1.50:1 / 1.28:1 — effectively
 *     invisible. Empire light already sets placeholder to its tertiary
 *     value, so this follows the house pattern instead of inventing a stop.
 *     neutral300 still serves borderStrong and inputBorderHover untouched.
 *
 * Raising tertiary alone would have INVERTED the hierarchy — this theme's
 * secondary sat below the tertiary target — so the text ramp moves together
 * or not at all.
 */
export const empireMidnightTheme = createTheme(vars, {
  color: {
    // -- Brand: avoir-primary, inverted (50 darkest -> 900 lightest) --
    brand50: 'oklch(22.9% 0.029 168)',
    brand100: 'oklch(28.4% 0.039 168)',
    brand200: 'oklch(34.5% 0.047 169.2)',
    brand300: 'oklch(46% 0.06 169.5)',
    brand400: 'oklch(61% 0.067 168.9)',
    brand500: 'oklch(70% 0.06 171.9)',
    brand600: 'oklch(78% 0.05 170.9)',
    brand700: 'oklch(86% 0.037 167.4)',
    brand800: 'oklch(92% 0.021 166.1)',
    brand900: 'oklch(96.1% 0.009 161.4)',

    // -- Accent: avoir-accent (brass), inverted. NOT the same ramp as brand --
    // any more: brand stays green, accent is the gold the owner asked for on
    // 2026-08-09. Positive money in Empire is gold, deliberately.
    accent50: 'oklch(30.4% 0.034 79.3)',
    accent100: 'oklch(40% 0.047 79.9)',
    accent200: 'oklch(50.1% 0.061 81.5)',
    accent300: 'oklch(60.2% 0.074 83.7)',
    accent400: 'oklch(69.7% 0.078 84.8)',
    accent500: 'oklch(77.4% 0.068 85.7)',
    accent600: 'oklch(83.9% 0.054 87.9)',
    accent700: 'oklch(89.1% 0.053 89)',
    accent800: 'oklch(94.1% 0.032 89.1)',
    accent900: 'oklch(97.6% 0.015 90.2)',

    // -- Button surface (gradient) — the ACCENT ramp, not brand --
    //
    // Empire Dark diverges from Empire light here, deliberately: the primary
    // button is brass in dark and green in light. The `brandButton*` tokens are
    // per-theme, so this needs no new plumbing — the light theme is untouched.
    //
    // The gradient keeps its shape (rest one stop above `To`, hover lightens,
    // active dims), just walked up the accent ramp. `textOnBrand` is the same
    // near-black and clears 11.03:1 on the rest fill.
    brandButtonFrom: 'oklch(83.9% 0.054 87.9)', // = accent600
    brandButtonTo: 'oklch(77.4% 0.068 85.7)', // = accent500
    brandButtonHoverFrom: 'oklch(89.1% 0.053 89)', // = accent700 — lightens, never dims
    brandButtonHoverTo: 'oklch(83.9% 0.054 87.9)', // = accent600
    brandButtonActiveFrom: 'oklch(77.4% 0.068 85.7)', // = accent500
    brandButtonActiveTo: 'oklch(69.7% 0.078 84.8)', // = accent400
    brandButtonBorder: 'oklch(77.4% 0.068 85.7)', // = accent500

    // -- Secondary button surface --
    secondaryButtonFrom: 'oklch(18.50% 0.006 260)', // = neutral0
    secondaryButtonTo: 'oklch(14.50% 0.004 260)', // = neutral50
    secondaryButtonHoverFrom: 'oklch(24.00% 0.007 260)', // = neutral100
    secondaryButtonHoverTo: 'oklch(18.50% 0.006 260)', // = neutral0
    secondaryButtonBorder: 'oklch(26.50% 0.008 260)', // = neutral200

    // -- Danger button surface --
    dangerButtonFrom: 'oklch(59.4% 0.136 28.5)', // = danger400
    dangerButtonTo: 'oklch(40% 0.11 28.5)', // = danger300
    dangerButtonHoverFrom: 'oklch(64% 0.12 28.5)', // = danger500 — lightens
    dangerButtonHoverTo: 'oklch(59.4% 0.136 28.5)', // = danger400
    dangerButtonBorder: 'oklch(40% 0.11 28.5)', // = danger300

    // -- Neutral: avoir-dark. Cards at neutral0, canvas at neutral50, and the
    // ramp climbing from neutral100 — the dark-theme convention.
    neutral0: 'oklch(18.50% 0.006 260)',
    neutral25: 'oklch(16.50% 0.005 260)',
    neutral50: 'oklch(14.50% 0.004 260)',
    neutral100: 'oklch(24.00% 0.007 260)',
    neutral200: 'oklch(26.50% 0.008 260)',
    neutral300: 'oklch(32.50% 0.009 260)',
    neutral400: 'oklch(48.00% 0.01 260)',
    neutral450: 'oklch(62.80% 0.009 260)',
    neutral500: 'oklch(44.00% 0.01 260)',
    neutral600: 'oklch(74.50% 0.009 260)',
    neutral700: 'oklch(80.30% 0.007 260)',
    neutral800: 'oklch(86.00% 0.005 260)',
    neutral900: 'oklch(14.50% 0.004 260)',

    // -- Surfaces (= palette stops) --
    background: 'oklch(14.50% 0.004 260)', // = neutral50
    surface: 'oklch(18.50% 0.006 260)', // = neutral0
    surfaceRaised: 'oklch(14.50% 0.004 260)', // = neutral50
    surfaceOverlay: 'oklch(14.50% 0.004 260)', // = neutral50
    // LIGHTER than the panel, not darker — a hovered row comes forward.
    //
    // Green here, brass in Empire light: the two themes swap which ramp carries
    // hover and which carries selection. Hover is transient, so it takes the
    // ramp that ISN'T marking committed state in this theme.
    surfaceHover: 'oklch(28.4% 0.039 168)', // = brand100 (green) — +5.8 off surface
    // Gold, and it has to leave brand200 free: that stop is the selected-row
    // highlight now, and a pressed row must not look identical to a selected one.
    surfacePressed: 'oklch(40% 0.047 79.9)', // = accent100 — a momentary flash
    controlHover: 'oklch(24.00% 0.007 260)', // = neutral100
    sidebarSurface: 'oklch(14.50% 0.004 260)', // = neutral900
    navItemSelected: 'oklch(83.9% 0.054 87.9)', // = accent600 — a selected tab is gold here, not near-white
    navItemSelectedHover: 'oklch(89.1% 0.053 89)', // = accent700 — a step brighter than the gold fill
    // Green, not gold. At accent100 this put SECONDARY text at 4.49:1 — right on
    // the AA line, which is the contrast problem it fixes. brand200 lifts that to
    // 5.46 (primary 7.50) and still sits +11.9 off the surface.
    surfaceSelected: 'oklch(34.5% 0.047 169.2)', // = brand200
    selectionFill: 'oklch(83.9% 0.054 87.9)', // = accent600 (brass) — label 10.35:1
    selectionFillHover: 'oklch(89.1% 0.053 89)', // = accent700 — lighter on hover, dark convention
    selectionSoft: 'oklch(30.4% 0.034 79.3)', // = accent50 — soft band, +7.8 off surface
    onSelectionSoft: 'oklch(89.1% 0.053 89)', // = accent700 — 9.73:1 on that band
    selectionMark: 'oklch(77.4% 0.068 85.7)', // = accent500 — 8.28:1 on surface

    // -- Text (= palette stops) --
    textPrimary: 'oklch(86.00% 0.005 260)', // = neutral800
    textSecondary: 'oklch(74.50% 0.009 260)', // = neutral600
    textTertiary: 'oklch(62.80% 0.009 260)', // = neutral450
    // Was neutral300, which is a BORDER stop — 1.50:1 / 1.28:1, effectively
    // invisible. Empire light sets placeholder to its tertiary value, so this
    // follows that rather than inventing a stop. neutral300 keeps doing border
    // duty for borderStrong and inputBorderHover, untouched.
    textPlaceholder: 'oklch(62.80% 0.009 260)', // = neutral450 (= textTertiary)
    textInverse: 'oklch(96.1% 0.009 161.4)', // = brand900 — lightest
    textOnBrand: 'oklch(14.50% 0.004 260)', // = neutral50
    onAccent: 'oklch(14.50% 0.004 260)', // = textOnBrand = neutral50
    accentFill: 'oklch(69.7% 0.078 84.8)', // = accent400
    accentFillHover: 'oklch(77.4% 0.068 85.7)', // = accent500
    accentFillPressed: 'oklch(83.9% 0.054 87.9)', // = accent600
    textLink: 'oklch(69.7% 0.078 84.8)', // = accent400 (brass) — 6.26:1
    textLinkUnderline: 'oklch(60.2% 0.074 83.7)', // = accent300 — decoration, below the text floor by design
    textLinkHover: 'oklch(77.4% 0.068 85.7)', // = accent500 — brighter on hover, as dark themes do

    // -- Borders (= palette stops) --
    border: 'oklch(26.50% 0.008 260)', // = neutral200
    borderStrong: 'oklch(32.50% 0.009 260)', // = neutral300
    borderFocus: 'oklch(75% 0.13 84)', // = focus.color (accent brass)
    borderError: 'oklch(59.4% 0.136 28.5)', // = danger400

    // -- Status: success — THE ACCENT RAMP, stop for stop --
    //
    // Empire Dark reads "good" as gold, not green. Every one of the 42 places
    // that shows a positive value — amounts, badges, the spend trend line,
    // progress fills, portfolio P/L, tags, toasts — goes through these tokens,
    // so this one block moves all of them and no component changes.
    //
    // NOTE: this collides with `warning`, which sits at hue 82.1 against this
    // ramp's 84.8 — 2.7 apart, i.e. the same colour. Warning needs to move.
    success50: 'oklch(30.4% 0.034 79.3)', // = accent50
    success100: 'oklch(40% 0.047 79.9)', // = accent100
    success200: 'oklch(50.1% 0.061 81.5)', // = accent200
    success300: 'oklch(60.2% 0.074 83.7)', // = accent300
    success400: 'oklch(69.7% 0.078 84.8)', // = accent400
    success500: 'oklch(77.4% 0.068 85.7)', // = accent500
    success600: 'oklch(83.9% 0.054 87.9)', // = accent600
    success700: 'oklch(89.1% 0.053 89)', // = accent700

    // -- Status: warning — ORANGE (hue 58), not the palette's yellow --
    //
    // Moved 2026-08-10, when success became the accent ramp. Warning sat at hue
    // 82.1 and that ramp is 84.8: 2.7 apart, i.e. the same colour. "Budget
    // nearly exceeded" and "you are in the black" cannot be the same swatch.
    //
    // 58 is the midpoint of the space warning has left — 29.5 from danger,
    // 26.8 from success — so no two status families sit closer than that.
    // Lightness and chroma are untouched; only the hue rotates, and all eight
    // stops stay inside sRGB there.
    warning50: 'oklch(25% 0.04 58)',
    warning100: 'oklch(29% 0.055 58)',
    warning200: 'oklch(34% 0.0699 58)',
    warning300: 'oklch(42% 0.0863 58)',
    warning400: 'oklch(75.4% 0.133 58)', // = --avoir-warning-on-dark
    warning500: 'oklch(79% 0.115 58)',
    warning600: 'oklch(83% 0.095 58)',
    warning700: 'oklch(87% 0.075 58)',

    // -- Status: danger --
    danger50: 'oklch(24% 0.05 28.5)',
    danger100: 'oklch(28% 0.065 28.5)',
    danger200: 'oklch(33% 0.085 28.5)',
    danger300: 'oklch(40% 0.11 28.5)',
    danger400: 'oklch(59.4% 0.136 28.5)', // = --avoir-danger-on-dark
    danger500: 'oklch(64% 0.12 28.5)',
    danger600: 'oklch(69% 0.1 28.5)',
    danger700: 'oklch(75% 0.08 28.5)',

    // -- Status: info --
    info50: 'oklch(24% 0.028 234.5)',
    info100: 'oklch(28% 0.036 234.5)',
    info200: 'oklch(33% 0.046 234.5)',
    info300: 'oklch(40% 0.058 234.5)',
    info400: 'oklch(61.6% 0.068 234.5)', // = --avoir-info-on-dark
    info500: 'oklch(67% 0.062 234.5)',
    info600: 'oklch(72% 0.052 234.5)',
    info700: 'oklch(78% 0.042 234.5)',

    // -- On-color: text on vivid semantic backgrounds --
    // Every fill in this theme is bright, so every glyph on one is near-black.
    onSuccess: 'oklch(14.50% 0.004 260)', // = neutral50
    onWarning: 'oklch(14.50% 0.004 260)', // = neutral50
    onDanger: 'oklch(14.50% 0.004 260)', // = neutral50
    onInfo: 'oklch(14.50% 0.004 260)', // = neutral50
    onNeutral: 'oklch(14.50% 0.004 260)', // = neutral50

    // -- Overlay --
    overlay: 'rgba(0, 0, 0, 0.6)',

    // -- Input --
    inputBg: 'oklch(18.50% 0.006 260)', // = neutral0
    inputBgHover: 'oklch(24.00% 0.007 260)', // = neutral100
    inputBgDisabled: 'oklch(14.50% 0.004 260)', // = neutral50
    inputBorder: 'oklch(26.50% 0.008 260)', // = neutral200
    inputBorderHover: 'oklch(32.50% 0.009 260)', // = neutral300
    inputShadowFocus: '0 0 0 3px oklch(75% 0.13 84 / 0.22)', // = focus.color
    inputShadowError: '0 0 0 3px oklch(59.4% 0.136 28.5 / 0.16)', // = danger400
    inputShadow: '0 1px 2px rgba(0,0,0,0.2), inset 0 1px 2px rgba(0,0,0,0.15)',

    // -- Data visualization: 12 categorical series --
    // One matched lightness (76%) and chroma (0.088) across every hue, so no
    // series reads as louder than its neighbours. Minimum hue separation 22.5deg.
    dataViz1: 'oklch(76% 0.088 12.5)', // rose, hue 12.5 (fills a gap in the authored eight)
    dataViz2: 'oklch(76% 0.088 45)', // clay, hue 45
    dataViz3: 'oklch(76% 0.088 85)', // brass, hue 85
    dataViz4: 'oklch(76% 0.088 120)', // olive, hue 120
    dataViz5: 'oklch(76% 0.088 142.5)', // fern, hue 142.5 (fills a gap in the authored eight)
    dataViz6: 'oklch(76% 0.088 165)', // green, hue 165
    dataViz7: 'oklch(76% 0.088 200)', // teal, hue 200
    dataViz8: 'oklch(76% 0.088 222.5)', // steel, hue 222.5 (fills a gap in the authored eight)
    dataViz9: 'oklch(76% 0.088 245)', // slateBlue, hue 245
    dataViz10: 'oklch(76% 0.088 272.5)', // indigo, hue 272.5 (fills a gap in the authored eight)
    dataViz11: 'oklch(76% 0.088 300)', // violet, hue 300
    dataViz12: 'oklch(76% 0.088 340)', // plum, hue 340

    // -- Data visualization scales (10 steps per series) --
    // 50 darkest -> 900 lightest; 500 is the categorical series colour.
    // Rose scale (hue 12.5)
    rose50: 'oklch(29% 0.055 12.5)',
    rose100: 'oklch(34.5% 0.065 12.5)',
    rose200: 'oklch(40% 0.075 12.5)',
    rose300: 'oklch(55% 0.09 12.5)',
    rose400: 'oklch(70% 0.088 12.5)',
    rose500: 'oklch(76% 0.088 12.5)', // = dataViz1
    rose600: 'oklch(82% 0.075 12.5)',
    rose700: 'oklch(88% 0.05 12.5)',
    rose800: 'oklch(93% 0.03 12.5)',
    rose900: 'oklch(97% 0.0148 12.5)',

    // Clay scale (hue 45)
    clay50: 'oklch(29% 0.055 45)',
    clay100: 'oklch(34.5% 0.065 45)',
    clay200: 'oklch(40% 0.075 45)',
    clay300: 'oklch(55% 0.09 45)',
    clay400: 'oklch(70% 0.088 45)',
    clay500: 'oklch(76% 0.088 45)', // = dataViz2
    clay600: 'oklch(82% 0.075 45)',
    clay700: 'oklch(88% 0.05 45)',
    clay800: 'oklch(93% 0.03 45)',
    clay900: 'oklch(97% 0.015 45)',

    // Brass scale (hue 85)
    brass50: 'oklch(29% 0.055 85)',
    brass100: 'oklch(34.5% 0.065 85)',
    brass200: 'oklch(40% 0.075 85)',
    brass300: 'oklch(55% 0.09 85)',
    brass400: 'oklch(70% 0.088 85)',
    brass500: 'oklch(76% 0.088 85)', // = dataViz3
    brass600: 'oklch(82% 0.075 85)',
    brass700: 'oklch(88% 0.05 85)',
    brass800: 'oklch(93% 0.03 85)',
    brass900: 'oklch(97% 0.015 85)',

    // Olive scale (hue 120)
    olive50: 'oklch(29% 0.055 120)',
    olive100: 'oklch(34.5% 0.065 120)',
    olive200: 'oklch(40% 0.075 120)',
    olive300: 'oklch(55% 0.09 120)',
    olive400: 'oklch(70% 0.088 120)',
    olive500: 'oklch(76% 0.088 120)', // = dataViz4
    olive600: 'oklch(82% 0.075 120)',
    olive700: 'oklch(88% 0.05 120)',
    olive800: 'oklch(93% 0.03 120)',
    olive900: 'oklch(97% 0.015 120)',

    // Fern scale (hue 142.5)
    fern50: 'oklch(29% 0.055 142.5)',
    fern100: 'oklch(34.5% 0.065 142.5)',
    fern200: 'oklch(40% 0.075 142.5)',
    fern300: 'oklch(55% 0.09 142.5)',
    fern400: 'oklch(70% 0.088 142.5)',
    fern500: 'oklch(76% 0.088 142.5)', // = dataViz5
    fern600: 'oklch(82% 0.075 142.5)',
    fern700: 'oklch(88% 0.05 142.5)',
    fern800: 'oklch(93% 0.03 142.5)',
    fern900: 'oklch(97% 0.015 142.5)',

    // Green scale (hue 165)
    green50: 'oklch(29% 0.055 165)',
    green100: 'oklch(34.5% 0.065 165)',
    green200: 'oklch(40% 0.075 165)',
    green300: 'oklch(55% 0.09 165)',
    green400: 'oklch(70% 0.088 165)',
    green500: 'oklch(76% 0.088 165)', // = dataViz6
    green600: 'oklch(82% 0.075 165)',
    green700: 'oklch(88% 0.05 165)',
    green800: 'oklch(93% 0.03 165)',
    green900: 'oklch(97% 0.015 165)',

    // Teal scale (hue 200)
    teal50: 'oklch(29% 0.0493 200)',
    teal100: 'oklch(34.5% 0.0585 200)',
    teal200: 'oklch(40% 0.0678 200)',
    teal300: 'oklch(55% 0.09 200)',
    teal400: 'oklch(70% 0.088 200)',
    teal500: 'oklch(76% 0.088 200)', // = dataViz7
    teal600: 'oklch(82% 0.075 200)',
    teal700: 'oklch(88% 0.05 200)',
    teal800: 'oklch(93% 0.03 200)',
    teal900: 'oklch(97% 0.015 200)',

    // Steel scale (hue 222.5)
    steel50: 'oklch(29% 0.0538 222.5)',
    steel100: 'oklch(34.5% 0.0638 222.5)',
    steel200: 'oklch(40% 0.074 222.5)',
    steel300: 'oklch(55% 0.09 222.5)',
    steel400: 'oklch(70% 0.088 222.5)',
    steel500: 'oklch(76% 0.088 222.5)', // = dataViz8
    steel600: 'oklch(82% 0.075 222.5)',
    steel700: 'oklch(88% 0.05 222.5)',
    steel800: 'oklch(93% 0.03 222.5)',
    steel900: 'oklch(97% 0.015 222.5)',

    // SlateBlue scale (hue 245)
    slateBlue50: 'oklch(29% 0.055 245)',
    slateBlue100: 'oklch(34.5% 0.065 245)',
    slateBlue200: 'oklch(40% 0.075 245)',
    slateBlue300: 'oklch(55% 0.09 245)',
    slateBlue400: 'oklch(70% 0.088 245)',
    slateBlue500: 'oklch(76% 0.088 245)', // = dataViz9
    slateBlue600: 'oklch(82% 0.075 245)',
    slateBlue700: 'oklch(88% 0.05 245)',
    slateBlue800: 'oklch(93% 0.03 245)',
    slateBlue900: 'oklch(97% 0.015 245)',

    // Indigo scale (hue 272.5)
    indigo50: 'oklch(29% 0.055 272.5)',
    indigo100: 'oklch(34.5% 0.065 272.5)',
    indigo200: 'oklch(40% 0.075 272.5)',
    indigo300: 'oklch(55% 0.09 272.5)',
    indigo400: 'oklch(70% 0.088 272.5)',
    indigo500: 'oklch(76% 0.088 272.5)', // = dataViz10
    indigo600: 'oklch(82% 0.075 272.5)',
    indigo700: 'oklch(88% 0.05 272.5)',
    indigo800: 'oklch(93% 0.03 272.5)',
    indigo900: 'oklch(97% 0.014 272.5)',

    // Violet scale (hue 300)
    violet50: 'oklch(29% 0.055 300)',
    violet100: 'oklch(34.5% 0.065 300)',
    violet200: 'oklch(40% 0.075 300)',
    violet300: 'oklch(55% 0.09 300)',
    violet400: 'oklch(70% 0.088 300)',
    violet500: 'oklch(76% 0.088 300)', // = dataViz11
    violet600: 'oklch(82% 0.075 300)',
    violet700: 'oklch(88% 0.05 300)',
    violet800: 'oklch(93% 0.03 300)',
    violet900: 'oklch(97% 0.015 300)',

    // Plum scale (hue 340)
    plum50: 'oklch(29% 0.055 340)',
    plum100: 'oklch(34.5% 0.065 340)',
    plum200: 'oklch(40% 0.075 340)',
    plum300: 'oklch(55% 0.09 340)',
    plum400: 'oklch(70% 0.088 340)',
    plum500: 'oklch(76% 0.088 340)', // = dataViz12
    plum600: 'oklch(82% 0.075 340)',
    plum700: 'oklch(88% 0.05 340)',
    plum800: 'oklch(93% 0.03 340)',
    plum900: 'oklch(97% 0.015 340)',

    // -- Data visualization: diverging (over budget <-> under budget) --
    dataVizDiverging1: 'oklch(72% 0.09 28)',
    dataVizDiverging2: 'oklch(62% 0.1 28)',
    dataVizDiverging3: 'oklch(50% 0.075 32)',
    dataVizDiverging4: 'oklch(25% 0.02 60)',
    dataVizDiverging5: 'oklch(50% 0.07 158)',
    dataVizDiverging6: 'oklch(62% 0.09 160)',
    dataVizDiverging7: 'oklch(72% 0.08 162)',

    bitcoinOrange: 'oklch(75.23% 0.1663 62.59)',
  },

  font: {
    display: "'DM Serif Display', Georgia, serif",
    ui: "'DM Sans Variable', 'DM Sans', sans-serif",
    label: "'Oswald Variable', 'Oswald', sans-serif",
    code: "'Fira Code Variable', 'Fira Code', monospace",

    xs: '0.6875rem',
    sm: '0.75rem',
    base: '0.8125rem',
    lg: '0.875rem',
    xl: '1.125rem',
    '2xl': '1.25rem',
    '3xl': '1.5rem',
    '4xl': '2rem',
    hero: '3rem',

    leadingTight: '1.1',
    leadingSnug: '1.3',
    leadingNormal: '1.5',
    leadingRelaxed: '1.6',

    regular: '400',
    medium: '500',
    semibold: '600',

    trackingTight: '-0.01em',
    trackingNormal: '0em',
    trackingWide: '0.08em',
    trackingLabel: '0.08rem',
  },

  space: {
    '0': '0rem',
    '0.5': '0.125rem',
    '1': '0.25rem',
    '2': '0.5rem',
    '3': '0.75rem',
    '4': '1rem',
    '5': '1.25rem',
    '6': '1.5rem',
    '7': '1.75rem',
    '8': '2rem',
    '9': '2.25rem',
    '10': '2.5rem',
    '11': '2.75rem',
    '12': '3rem',
    '13': '3.25rem',
    '14': '3.5rem',
    '15': '3.75rem',
    '16': '4rem',
  },

  radius: {
    none: '0rem',
    xs: '0.25rem',
    sm: '0.5rem',
    md: '0.75rem',
    lg: '0.875rem',
    xl: '1rem',
    '2xl': '1.25rem',
    full: '62.4375rem',
  },

  border: {
    hairline: '0.5px',
    thin: '1px',
    thick: '2px',
  },

  // Shadows with outer glow layer for dark surface visibility
  shadow: {
    sm: '0 0 0 1px rgba(255,255,255,0.06), 0 1px 3px rgba(0,0,0,0.2), 0 2px 6px rgba(0,0,0,0.15)',
    md: '0 0 0 1px rgba(255,255,255,0.06), 0 4px 12px rgba(0,0,0,0.3), 0 2px 4px rgba(0,0,0,0.2)',
    lg: '0 0 0 1px rgba(255,255,255,0.06), 0 8px 32px rgba(0,0,0,0.5), 0 3px 10px rgba(0,0,0,0.3)',
  },

  focus: {
    width: '0.125rem',
    offset: '0.125rem',
    color: 'oklch(75% 0.13 84)',
    shadow: '0 0 0 0.125rem oklch(75% 0.13 84), 0 0 0 0.25rem oklch(75% 0.13 84 / 0.25)',
  },

  z: {
    dropdown: '100',
    sticky: '200',
    overlay: '300',
    modal: '400',
    popover: '500',
    tooltip: '600',
    toast: '700',
  },

  duration: {
    fast: '100ms',
    normal: '150ms',
    slow: '300ms',
  },

  easing: {
    default: 'cubic-bezier(0.4, 0, 0.2, 1)',
    in: 'cubic-bezier(0.4, 0, 1, 1)',
    out: 'cubic-bezier(0, 0, 0.2, 1)',
    inOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
  },

  scrollbar: {
    width: '0.375rem',
    thumb: 'oklch(75% 0 0 / 0.25)',
    thumbHover: 'oklch(80% 0 0 / 0.4)',
    track: 'transparent',
    radius: '0.25rem',
  },
});
