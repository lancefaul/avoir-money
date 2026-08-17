import { createTheme } from '@vanilla-extract/css';
import { vars } from './contract.css.js';

/**
 * Empire — the Avoir palette, light.
 *
 * Replaced the emerald-on-cream build on 2026-08-09. Four things about the
 * mapping are decisions rather than transcription, and each is here so it is
 * not undone by someone reading the source palette and finding it disagrees:
 *
 * **`brand` and `accent` both take `avoir-primary`, and the brass is
 * decorative only.** The source palette names its second ramp "accent", but
 * the DS means something narrower by that word: `accent*` is THE
 * positive/interactive colour — checkbox fills, links, selected rows, dropdown
 * and datepicker selection, progress, toast, step indicators, and the
 * dashboard's positive net-savings bars all read it. Assigning brass there
 * would not make Empire brass-accented; it would make every one of those
 * surfaces brass, money that had gone UP included. That exact defect was
 * removed on 2026-08-08 and is pinned by `on-vivid-fills.test.ts`. The source
 * palette agrees, for what it is worth: its own `--avoir-action` is
 * `primary-600` and its `--avoir-accent` is a secondary role.
 *
 * **Three neutrals are derived, because the source ramp is shorter than the
 * contract.** `neutral25` (between white and the cream) and `neutral450`
 * (between 400 and 500) are interpolated. `neutral900` is NOT an extension of
 * the warm ramp — it takes `avoir-dark-900`, which the palette designates as
 * both `--avoir-text` and `--avoir-brand-ink`. That puts a hue break at the
 * bottom of the ramp (93.8 -> 169.6), accepted deliberately: the stop's only
 * consumers here are `textPrimary` and `textInverse`, and the palette is
 * explicit that its ink is the green-black rather than a warm charcoal.
 *
 * **The text ramp is shifted one stop darker than the palette's role hints,
 * on measured contrast.** `--avoir-text-muted` is `neutral-500`, which is
 * 3.13:1 against this theme's own `--avoir-bg` — below the 4.5 AA floor for
 * body text. So `textSecondary` takes neutral700 (7.83:1) and
 * `textTertiary`/`textPlaceholder` take neutral600 (4.93:1), leaving
 * neutral500 for disabled and decorative work. The brass `--avoir-accent`
 * measures 3.42:1 for the same reason and is likewise never text.
 *
 * **Status ramps are interpolated from four anchors.** The palette gives each
 * family five roles (surface / border / base / deep / on-dark); the contract
 * wants an 8-step ramp. surface/border/base/deep land on 100/300/500/700
 * exactly and 200/400/600 are midpoints on the same curve, so the authored
 * colours are reproduced rather than approximated. `on-dark` has no light-mode
 * slot — it anchors the Empire Dark ramps instead.
 *
 * Surfaces follow the palette's own light-mode role block: the canvas is
 * `neutral100` and cards are white, which puts a deeper step between page and
 * card than the previous build had. Focus ring: unchanged system emerald, which
 * sits 14.5deg from this accent's hue and so still agrees with it.
 *
 * A note on gamut: 17 of the 278 data-viz values needed their chroma trimmed to
 * fit sRGB, deep teal most of all (at L40 teal caps at C 0.068 where plum
 * reaches 0.174). Three of those are the authored palette's own values —
 * `viz-teal-500`, `viz-teal-600` and `viz-diverging-7` — which were already
 * clipping silently in any browser.
 */
export const empireTheme = createTheme(vars, {
  color: {
    // -- Brand: avoir-primary, verbatim (deep green) --
    // Drives the left rail, nav active state, tag dots, toast and the
    // spend-prediction chart.
    brand50: 'oklch(96.1% 0.009 161.4)',
    brand100: 'oklch(91.3% 0.021 166.1)',
    brand200: 'oklch(82.2% 0.037 167.4)',
    brand300: 'oklch(72% 0.054 170.9)',
    brand400: 'oklch(60.9% 0.067 171.9)',
    brand500: 'oklch(48.2% 0.071 168.9)',
    brand600: 'oklch(37.4% 0.054 169.5)',
    brand700: 'oklch(33.3% 0.047 169.2)',
    brand800: 'oklch(28.4% 0.039 168)',
    brand900: 'oklch(22.9% 0.029 168)',

    // -- Accent: avoir-primary again — the interactive/positive role --
    // Not the palette's brass ramp. See the docblock: this slot is a meaning,
    // not a decorative choice, and every component reading it is asserting
    // "positive" or "interactive".
    accent50: 'oklch(97.6% 0.015 90.2)',
    accent100: 'oklch(94.1% 0.032 89.1)',
    accent200: 'oklch(89.1% 0.053 89)',
    accent300: 'oklch(83.9% 0.054 87.9)',
    accent400: 'oklch(77.4% 0.068 85.7)',
    accent500: 'oklch(69.7% 0.078 84.8)',
    accent600: 'oklch(60.2% 0.074 83.7)',
    accent700: 'oklch(50.1% 0.061 81.5)',
    accent800: 'oklch(40% 0.047 79.9)',
    accent900: 'oklch(30.4% 0.034 79.3)',

    // -- Button surface (gradient) --
    brandButtonFrom: 'oklch(37.4% 0.054 169.5)', // = brand600
    brandButtonTo: 'oklch(33.3% 0.047 169.2)', // = brand700
    brandButtonHoverFrom: 'oklch(37.4% 0.054 169.5)', // = brand600
    brandButtonHoverTo: 'oklch(28.4% 0.039 168)', // = brand800
    brandButtonActiveFrom: 'oklch(33.3% 0.047 169.2)', // = brand700
    brandButtonActiveTo: 'oklch(28.4% 0.039 168)', // = brand800
    brandButtonBorder: 'oklch(28.4% 0.039 168)', // = brand800

    // -- Secondary button surface (light gradient) --
    secondaryButtonFrom: 'oklch(100% 0 0)', // = neutral0
    secondaryButtonTo: 'oklch(95.2% 0.012 91.5)', // = neutral100
    secondaryButtonHoverFrom: 'oklch(97% 0.008 91.5)', // = neutral50
    secondaryButtonHoverTo: 'oklch(90.7% 0.017 91.6)', // = neutral200
    secondaryButtonBorder: 'oklch(90.7% 0.017 91.6)', // = neutral200

    // -- Danger button surface (light gradient) --
    dangerButtonFrom: 'oklch(55.3% 0.116 29.05)', // = danger400
    dangerButtonTo: 'oklch(38.7% 0.1125 28.7)', // = danger600
    dangerButtonHoverFrom: 'oklch(51% 0.12 29.05)', // slightly darker than danger400
    dangerButtonHoverTo: 'oklch(35% 0.115 28.7)', // slightly darker than danger600
    dangerButtonBorder: 'oklch(38.7% 0.1125 28.7)', // = danger600

    // -- Neutral: avoir-neutral (warm, hue ~91-94) --
    // 25 and 450 interpolated; 900 takes avoir-dark-900, the palette's ink.
    neutral0: 'oklch(100% 0 0)',
    neutral25: 'oklch(98.5% 0.004 91.5)', // derived: between neutral0 and neutral50
    neutral50: 'oklch(97% 0.008 91.5)',
    neutral100: 'oklch(95.2% 0.012 91.5)',
    neutral200: 'oklch(90.7% 0.017 91.6)',
    neutral300: 'oklch(84.2% 0.021 91.6)',
    neutral400: 'oklch(73.1% 0.023 92.6)',
    neutral450: 'oklch(67.7% 0.022 93.2)', // derived: between neutral400 and neutral500
    neutral500: 'oklch(62.3% 0.021 93.8)',
    neutral600: 'oklch(51.3% 0.022 93.9)',
    neutral700: 'oklch(40.5% 0.018 94.5)',
    neutral800: 'oklch(31.3% 0.012 93.8)',
    neutral900: 'oklch(17.7% 0.014 169.6)', // = avoir-dark-900 (brand ink)

    // -- Surfaces (= palette stops) --
    // Canvas and header are one surface, which is also how theme-light is built
    // (its `background` and `surfaceRaised` are the same stop). Requested
    // directly: `<main>` reads `background` and the header reads
    // `surfaceRaised`, so matching them is what makes the two continuous.
    // Departs from the palette's `--avoir-bg: neutral-100` for that reason.
    background: 'oklch(98.5% 0.004 91.5)', // = neutral25, = surfaceRaised
    surface: 'oklch(100% 0 0)', // = neutral0
    // A 1.5% step under white — enough to read as lifted off the canvas
    // without becoming the canvas, which is what the previous build did.
    surfaceRaised: 'oklch(98.5% 0.004 91.5)', // = neutral25
    surfaceOverlay: 'oklch(98.5% 0.004 91.5)', // = neutral25
    // Brand green rather than a warm neutral — menu rows, select options,
    // calendar days and ghost buttons all read this. brand100 is the only stop
    // that clears the 4% step off `surface` in BOTH Empire themes; brand50
    // misses it by 0.1% here and by 3.7% in the dark one, and at chroma 0.009
    // is barely green anyway. The step is 8.7%, up from the neutral's 4.8%.
    surfaceHover: 'oklch(94.1% 0.032 89.1)', // = accent100 (brass) — 5.9% off white
    surfacePressed: 'oklch(89.1% 0.053 89)', // = accent200 — deeper than the accent hover above
    controlHover: 'oklch(95.2% 0.012 91.5)', // = neutral100 — the ghost button stays neutral
    // The palette's ink, not a stop off the brand ramp. Requested directly
    // (#0F1815) — a deeper, less saturated rail than brand800's 28.4%, which
    // read as a green panel rather than as chrome.
    // = neutral25, = background. The rail was the Avoir ink (#0F1815) until
    // 2026-08-12, when the frameless title bar put a near-white strip directly
    // above it and the dark rail read as a slab bolted to the window rather
    // than as part of it. It is the page's own ground now, separated by its
    // border alone.
    sidebarSurface: 'oklch(98.5% 0.004 91.5)',
    navItemSelected: 'oklch(37.4% 0.054 169.5)', // = brand600 — tabs read brand, not the brass accent
    navItemSelectedHover: 'oklch(33.3% 0.047 169.2)', // = brand700 — a step deeper than the selected fill
    surfaceSelected: 'oklch(94.1% 0.032 89.1)', // = accent100 — a 5.9% step off white
    selectionFill: 'oklch(37.4% 0.054 169.5)', // = brand600 (unchanged)
    selectionFillHover: 'oklch(33.3% 0.047 169.2)', // = brand700 (unchanged)
    selectionSoft: 'oklch(96.1% 0.009 161.4)', // = brand50 (unchanged)
    onSelectionSoft: 'oklch(33.3% 0.047 169.2)', // = brand700 (unchanged)
    selectionMark: 'oklch(48.2% 0.071 168.9)', // = brand500 (unchanged)

    // -- Text (= palette stops) --
    // Shifted one stop darker than the palette's role hints; see the docblock.
    textPrimary: 'oklch(17.7% 0.014 169.6)', // = neutral900 (16.39:1 on canvas)
    textSecondary: 'oklch(40.5% 0.018 94.5)', // = neutral700 (7.83:1)
    textTertiary: 'oklch(51.3% 0.022 93.9)', // = neutral600 (4.93:1)
    textPlaceholder: 'oklch(51.3% 0.022 93.9)', // = neutral600 (4.93:1)
    textInverse: 'oklch(17.7% 0.014 169.6)', // = neutral900
    textOnBrand: 'oklch(100% 0 0)', // = neutral0 (9.98:1 on brand600)
    onAccent: 'oklch(17.7% 0.014 169.6)', // = neutral900 — near-black on the light brass fill (9.21:1)
    accentFill: 'oklch(89.1% 0.053 89)', // = accent200
    accentFillHover: 'oklch(83.9% 0.054 87.9)', // = accent300
    accentFillPressed: 'oklch(77.4% 0.068 85.7)', // = accent400
    textLink: 'oklch(48.2% 0.071 168.9)', // = brand500 (unchanged)
    textLinkUnderline: 'oklch(72% 0.054 170.9)', // = brand300 (unchanged)
    textLinkHover: 'oklch(37.4% 0.054 169.5)', // = brand600 (unchanged)

    // -- Borders (= palette stops) --
    border: 'oklch(90.7% 0.017 91.6)', // = neutral200
    borderStrong: 'oklch(84.2% 0.021 91.6)', // = neutral300
    borderFocus: 'oklch(55% 0.11 168)', // = focus.color (brand green)
    borderError: 'oklch(55.3% 0.116 29.05)', // = danger400

    // -- Status: success — 100/300/500/700 are the authored roles --
    success50: 'oklch(97.5% 0.0116 156.8)', // derived
    success100: 'oklch(92.9% 0.021 156.8)', // = --avoir-success-surface
    success200: 'oklch(82.25% 0.05 158.15)', // derived
    success300: 'oklch(71.6% 0.079 159.5)', // = --avoir-success-border
    success400: 'oklch(59.7% 0.081 158.3)', // derived
    success500: 'oklch(47.8% 0.083 157.1)', // = --avoir-success-base
    success600: 'oklch(40.95% 0.0695 157.5)', // derived
    success700: 'oklch(34.1% 0.056 157.9)', // = --avoir-success-deep

    // -- Status: warning --
    warning50: 'oklch(97.5% 0.0193 85.4)', // derived
    warning100: 'oklch(94.3% 0.035 85.4)', // = --avoir-warning-surface
    warning200: 'oklch(87.05% 0.071 85.55)', // derived
    warning300: 'oklch(79.8% 0.107 85.7)', // = --avoir-warning-border
    warning400: 'oklch(70.45% 0.1135 82.7)', // derived
    warning500: 'oklch(61.1% 0.12 79.7)', // = --avoir-warning-base
    warning600: 'oklch(52.65% 0.1025 80.1)', // derived
    warning700: 'oklch(44.2% 0.085 80.5)', // = --avoir-warning-deep

    // -- Status: danger --
    danger50: 'oklch(97.5% 0.0122 27.4)', // derived
    danger100: 'oklch(91.7% 0.024 27.4)', // = --avoir-danger-surface
    danger200: 'oklch(78.9% 0.0625 28.35)', // derived
    danger300: 'oklch(66.1% 0.101 29.3)', // = --avoir-danger-border
    danger400: 'oklch(55.3% 0.116 29.05)', // derived
    danger500: 'oklch(44.5% 0.131 28.8)', // = --avoir-danger-base
    danger600: 'oklch(38.7% 0.1125 28.7)', // derived
    danger700: 'oklch(32.9% 0.094 28.6)', // = --avoir-danger-deep

    // -- Status: info --
    info50: 'oklch(97.5% 0.0088 233)', // derived
    info100: 'oklch(92.4% 0.016 233)', // = --avoir-info-surface
    info200: 'oklch(81.7% 0.036 233.05)', // derived
    info300: 'oklch(71% 0.056 233.1)', // = --avoir-info-border
    info400: 'oklch(57.25% 0.06 235.45)', // derived
    info500: 'oklch(43.5% 0.064 237.8)', // = --avoir-info-base
    info600: 'oklch(37.35% 0.0535 237.6)', // derived
    info700: 'oklch(31.2% 0.043 237.4)', // = --avoir-info-deep

    // -- On-color: text on vivid semantic backgrounds --
    onSuccess: 'oklch(100% 0 0)', // white on green
    onWarning: 'oklch(17.7% 0.014 169.6)', // = neutral900 (dark on yellow)
    onDanger: 'oklch(100% 0 0)', // white on red
    onInfo: 'oklch(100% 0 0)', // white on blue
    onNeutral: 'oklch(100% 0 0)', // = neutral0 — the fill is brand600 again, a dark green (9.98:1)

    // -- Overlay --
    overlay: 'rgba(0, 0, 0, 0.4)',

    // -- Input --
    inputBg: 'oklch(100% 0 0)', // = neutral0
    inputBgHover: 'oklch(98.5% 0.004 91.5)', // = neutral25
    inputBgDisabled: 'oklch(95.2% 0.012 91.5)', // = neutral100
    inputBorder: 'oklch(73.1% 0.023 92.6)', // = neutral400
    inputBorderHover: 'oklch(67.7% 0.022 93.2)', // = neutral450
    inputShadowFocus: '0 0 0 3px oklch(55% 0.11 168 / 0.22)', // = focus.color
    inputShadowError: '0 0 0 3px oklch(55.3% 0.116 29.05 / 0.16)', // = danger400
    inputShadow: '0 1px 2px rgba(20,30,40,0.06), inset 0 1px 2px rgba(20,30,40,0.04)',

    // -- Data visualization: 12 categorical series --
    // One matched lightness (62%) and chroma (0.088) across every hue, so no
    // series reads as louder than its neighbours. Minimum hue separation 22.5deg.
    dataViz1: 'oklch(62% 0.088 12.5)', // rose, hue 12.5 (fills a gap in the authored eight)
    dataViz2: 'oklch(62% 0.088 45)', // clay, hue 45
    dataViz3: 'oklch(62% 0.088 85)', // brass, hue 85
    dataViz4: 'oklch(62% 0.088 120)', // olive, hue 120
    dataViz5: 'oklch(62% 0.088 142.5)', // fern, hue 142.5 (fills a gap in the authored eight)
    dataViz6: 'oklch(62% 0.088 165)', // green, hue 165
    dataViz7: 'oklch(62% 0.088 200)', // teal, hue 200
    dataViz8: 'oklch(62% 0.088 222.5)', // steel, hue 222.5 (fills a gap in the authored eight)
    dataViz9: 'oklch(62% 0.088 245)', // slateBlue, hue 245
    dataViz10: 'oklch(62% 0.088 272.5)', // indigo, hue 272.5 (fills a gap in the authored eight)
    dataViz11: 'oklch(62% 0.088 300)', // violet, hue 300
    dataViz12: 'oklch(62% 0.088 340)', // plum, hue 340

    // -- Data visualization scales (10 steps per series) --
    // 50 lightest -> 900 darkest; 500 is the categorical series colour.
    // Rose scale (hue 12.5)
    rose50: 'oklch(97% 0.0148 12.5)',
    rose100: 'oklch(95% 0.022 12.5)',
    rose200: 'oklch(93% 0.03 12.5)',
    rose300: 'oklch(82% 0.055 12.5)',
    rose400: 'oklch(70% 0.08 12.5)',
    rose500: 'oklch(62% 0.088 12.5)', // = dataViz1
    rose600: 'oklch(55% 0.09 12.5)',
    rose700: 'oklch(40% 0.075 12.5)',
    rose800: 'oklch(34.5% 0.065 12.5)',
    rose900: 'oklch(29% 0.055 12.5)',

    // Clay scale (hue 45)
    clay50: 'oklch(97% 0.015 45)',
    clay100: 'oklch(95% 0.022 45)',
    clay200: 'oklch(93% 0.03 45)',
    clay300: 'oklch(82% 0.055 45)',
    clay400: 'oklch(70% 0.08 45)',
    clay500: 'oklch(62% 0.088 45)', // = dataViz2
    clay600: 'oklch(55% 0.09 45)',
    clay700: 'oklch(40% 0.075 45)',
    clay800: 'oklch(34.5% 0.065 45)',
    clay900: 'oklch(29% 0.055 45)',

    // Brass scale (hue 85)
    brass50: 'oklch(97% 0.015 85)',
    brass100: 'oklch(95% 0.022 85)',
    brass200: 'oklch(93% 0.03 85)',
    brass300: 'oklch(82% 0.055 85)',
    brass400: 'oklch(70% 0.08 85)',
    brass500: 'oklch(62% 0.088 85)', // = dataViz3
    brass600: 'oklch(55% 0.09 85)',
    brass700: 'oklch(40% 0.075 85)',
    brass800: 'oklch(34.5% 0.065 85)',
    brass900: 'oklch(29% 0.055 85)',

    // Olive scale (hue 120)
    olive50: 'oklch(97% 0.015 120)',
    olive100: 'oklch(95% 0.022 120)',
    olive200: 'oklch(93% 0.03 120)',
    olive300: 'oklch(82% 0.055 120)',
    olive400: 'oklch(70% 0.08 120)',
    olive500: 'oklch(62% 0.088 120)', // = dataViz4
    olive600: 'oklch(55% 0.09 120)',
    olive700: 'oklch(40% 0.075 120)',
    olive800: 'oklch(34.5% 0.065 120)',
    olive900: 'oklch(29% 0.055 120)',

    // Fern scale (hue 142.5)
    fern50: 'oklch(97% 0.015 142.5)',
    fern100: 'oklch(95% 0.022 142.5)',
    fern200: 'oklch(93% 0.03 142.5)',
    fern300: 'oklch(82% 0.055 142.5)',
    fern400: 'oklch(70% 0.08 142.5)',
    fern500: 'oklch(62% 0.088 142.5)', // = dataViz5
    fern600: 'oklch(55% 0.09 142.5)',
    fern700: 'oklch(40% 0.075 142.5)',
    fern800: 'oklch(34.5% 0.065 142.5)',
    fern900: 'oklch(29% 0.055 142.5)',

    // Green scale (hue 165)
    green50: 'oklch(97% 0.015 165)',
    green100: 'oklch(95% 0.022 165)',
    green200: 'oklch(93% 0.03 165)',
    green300: 'oklch(82% 0.055 165)',
    green400: 'oklch(70% 0.08 165)',
    green500: 'oklch(62% 0.088 165)', // = dataViz6
    green600: 'oklch(55% 0.09 165)',
    green700: 'oklch(40% 0.075 165)',
    green800: 'oklch(34.5% 0.065 165)',
    green900: 'oklch(29% 0.055 165)',

    // Teal scale (hue 200)
    teal50: 'oklch(97% 0.015 200)',
    teal100: 'oklch(95% 0.022 200)',
    teal200: 'oklch(93% 0.03 200)',
    teal300: 'oklch(82% 0.055 200)',
    teal400: 'oklch(70% 0.08 200)',
    teal500: 'oklch(62% 0.088 200)', // = dataViz7
    teal600: 'oklch(55% 0.09 200)',
    teal700: 'oklch(40% 0.0678 200)',
    teal800: 'oklch(34.5% 0.0585 200)',
    teal900: 'oklch(29% 0.0493 200)',

    // Steel scale (hue 222.5)
    steel50: 'oklch(97% 0.015 222.5)',
    steel100: 'oklch(95% 0.022 222.5)',
    steel200: 'oklch(93% 0.03 222.5)',
    steel300: 'oklch(82% 0.055 222.5)',
    steel400: 'oklch(70% 0.08 222.5)',
    steel500: 'oklch(62% 0.088 222.5)', // = dataViz8
    steel600: 'oklch(55% 0.09 222.5)',
    steel700: 'oklch(40% 0.074 222.5)',
    steel800: 'oklch(34.5% 0.0638 222.5)',
    steel900: 'oklch(29% 0.0538 222.5)',

    // SlateBlue scale (hue 245)
    slateBlue50: 'oklch(97% 0.015 245)',
    slateBlue100: 'oklch(95% 0.022 245)',
    slateBlue200: 'oklch(93% 0.03 245)',
    slateBlue300: 'oklch(82% 0.055 245)',
    slateBlue400: 'oklch(70% 0.08 245)',
    slateBlue500: 'oklch(62% 0.088 245)', // = dataViz9
    slateBlue600: 'oklch(55% 0.09 245)',
    slateBlue700: 'oklch(40% 0.075 245)',
    slateBlue800: 'oklch(34.5% 0.065 245)',
    slateBlue900: 'oklch(29% 0.055 245)',

    // Indigo scale (hue 272.5)
    indigo50: 'oklch(97% 0.014 272.5)',
    indigo100: 'oklch(95% 0.022 272.5)',
    indigo200: 'oklch(93% 0.03 272.5)',
    indigo300: 'oklch(82% 0.055 272.5)',
    indigo400: 'oklch(70% 0.08 272.5)',
    indigo500: 'oklch(62% 0.088 272.5)', // = dataViz10
    indigo600: 'oklch(55% 0.09 272.5)',
    indigo700: 'oklch(40% 0.075 272.5)',
    indigo800: 'oklch(34.5% 0.065 272.5)',
    indigo900: 'oklch(29% 0.055 272.5)',

    // Violet scale (hue 300)
    violet50: 'oklch(97% 0.015 300)',
    violet100: 'oklch(95% 0.022 300)',
    violet200: 'oklch(93% 0.03 300)',
    violet300: 'oklch(82% 0.055 300)',
    violet400: 'oklch(70% 0.08 300)',
    violet500: 'oklch(62% 0.088 300)', // = dataViz11
    violet600: 'oklch(55% 0.09 300)',
    violet700: 'oklch(40% 0.075 300)',
    violet800: 'oklch(34.5% 0.065 300)',
    violet900: 'oklch(29% 0.055 300)',

    // Plum scale (hue 340)
    plum50: 'oklch(97% 0.015 340)',
    plum100: 'oklch(95% 0.022 340)',
    plum200: 'oklch(93% 0.03 340)',
    plum300: 'oklch(82% 0.055 340)',
    plum400: 'oklch(70% 0.08 340)',
    plum500: 'oklch(62% 0.088 340)', // = dataViz12
    plum600: 'oklch(55% 0.09 340)',
    plum700: 'oklch(40% 0.075 340)',
    plum800: 'oklch(34.5% 0.065 340)',
    plum900: 'oklch(29% 0.055 340)',

    // -- Data visualization: diverging (over budget <-> under budget) --
    dataVizDiverging1: 'oklch(34% 0.09 28)',
    dataVizDiverging2: 'oklch(50% 0.1 28)',
    dataVizDiverging3: 'oklch(68% 0.075 32)',
    dataVizDiverging4: 'oklch(93% 0.02 60)',
    dataVizDiverging5: 'oklch(68% 0.07 158)',
    dataVizDiverging6: 'oklch(50% 0.09 160)',
    dataVizDiverging7: 'oklch(34% 0.0744 162)',

    bitcoinOrange: 'oklch(75.23% 0.1663 62.59)',
  },

  font: {
    display: "'DM Serif Display', Georgia, serif",
    ui: "'DM Sans Variable', 'DM Sans', sans-serif",
    label: "'Oswald Variable', 'Oswald', sans-serif",
    code: "'Fira Code Variable', 'Fira Code', monospace",

    // Sizes (rem)
    xs: '0.6875rem',
    sm: '0.75rem',
    base: '0.8125rem',
    lg: '0.875rem',
    xl: '1.125rem',
    '2xl': '1.25rem',
    '3xl': '1.5rem',
    '4xl': '2rem',
    hero: '3rem',

    // Line heights
    leadingTight: '1.1',
    leadingSnug: '1.3',
    leadingNormal: '1.5',
    leadingRelaxed: '1.6',

    // Weights
    regular: '400',
    medium: '500',
    semibold: '600',

    // Letter spacing
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

  shadow: {
    sm: '0 0 0 1px rgba(0,0,0,0.03), 0 1px 3px rgba(20,30,40,0.07), 0 2px 6px rgba(20,30,40,0.04)',
    md: '0 0 0 1px rgba(0,0,0,0.03), 0 4px 12px rgba(20,30,40,0.10), 0 2px 4px rgba(20,30,40,0.06)',
    lg: '0 0 0 1px rgba(0,0,0,0.03), 0 8px 32px rgba(20,30,40,0.14), 0 3px 10px rgba(20,30,40,0.08)',
  },

  focus: {
    width: '0.125rem',
    offset: '0.125rem',
    color: 'oklch(55% 0.11 168)',
    shadow: '0 0 0 0.125rem oklch(55% 0.11 168), 0 0 0 0.25rem oklch(55% 0.11 168 / 0.25)',
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
    thumb: 'oklch(55% 0 0 / 0.35)',
    thumbHover: 'oklch(45% 0 0 / 0.5)',
    track: 'transparent',
    radius: '0.25rem',
  },
});
