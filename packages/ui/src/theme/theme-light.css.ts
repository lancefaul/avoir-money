import { createTheme } from '@vanilla-extract/css';
import { vars } from './contract.css.js';

/**
 * Light theme — Premium black brand with clean gold accent.
 *
 * Brand ramp: premium blacks for primary UI, clean yellow-gold for focus/accent.
 * Neutral ramp: warm grays from tokens.html (kept as-is per user approval).
 * Accent: emerald green for links and interactive highlights.
 * Semantic: green/red/amber/blue status colors.
 */
export const lightTheme = createTheme(vars, {
  color: {
    // -- Brand: premium black ramp (full 10-step curve, 50→900) --
    brand50: 'oklch(96.99% 0.0012 107.95)',
    brand100: 'oklch(92.06% 0.0033 107.15)',
    brand200: 'oklch(82.20% 0.0048 91.60)',
    brand300: 'oklch(69.87% 0.0057 93.43)',
    brand400: 'oklch(60.00% 0.0060 95.26)',
    brand500: 'oklch(51.38% 0.0059 93.43)',
    brand600: 'oklch(41.51% 0.0058 91.59)',
    brand700: 'oklch(32.88% 0.0055 91.61)',
    brand800: 'oklch(24.25% 0.0050 91.64)',
    brand900: 'oklch(14.39% 0.0045 107.02)',

    // -- Accent: emerald green (links, interactive highlights) — full 10-step curve --
    accent50: 'oklch(97.00% 0.0200 155.00)',
    accent100: 'oklch(92.38% 0.0812 155.00)',
    accent200: 'oklch(83.14% 0.1250 155.00)',
    accent300: 'oklch(71.59% 0.1512 155.00)',
    accent400: 'oklch(62.34% 0.1600 155.00)',
    accent500: 'oklch(54.26% 0.1558 155.00)',
    accent600: 'oklch(45.01% 0.1434 155.00)',
    accent700: 'oklch(36.93% 0.1226 155.00)',
    accent800: 'oklch(28.84% 0.0934 155.00)',
    accent900: 'oklch(19.60% 0.0560 155.00)',

    // -- Button surface (gradient) --
    brandButtonFrom: 'oklch(41.51% 0.0058 91.59)', // = brand600
    brandButtonTo: 'oklch(32.88% 0.0055 91.61)', // = brand700
    brandButtonHoverFrom: 'oklch(41.51% 0.0058 91.59)', // = brand600
    brandButtonHoverTo: 'oklch(24.25% 0.0050 91.64)', // = brand800
    brandButtonActiveFrom: 'oklch(32.88% 0.0055 91.61)', // = brand700
    brandButtonActiveTo: 'oklch(24.25% 0.0050 91.64)', // = brand800
    brandButtonBorder: 'oklch(24.25% 0.0050 91.64)', // = brand800

    // -- Secondary button surface (light gradient) --
    secondaryButtonFrom: 'oklch(100% 0 0)', // = neutral0
    secondaryButtonTo: 'oklch(95.56% 0.0057 84.59)', // = neutral100
    secondaryButtonHoverFrom: 'oklch(98.23% 0.0028 84.60)', // = neutral50
    secondaryButtonHoverTo: 'oklch(91.04% 0.0086 84.59)', // = neutral200
    secondaryButtonBorder: 'oklch(91.04% 0.0086 84.59)', // = neutral200

    // -- Danger button surface (light gradient) --
    dangerButtonFrom: 'oklch(58.83% 0.1972 29.86)', // = danger400
    dangerButtonTo: 'oklch(48.66% 0.1627 30.26)', // = danger600
    dangerButtonHoverFrom: 'oklch(55% 0.20 29.86)', // slightly darker than danger400
    dangerButtonHoverTo: 'oklch(46% 0.17 30.26)', // slightly darker than danger600
    dangerButtonBorder: 'oklch(48.66% 0.1627 30.26)', // = danger600

    // -- Neutral: warm gray (from tokens.html) --
    neutral0: 'oklch(100% 0 0)',
    neutral25: 'oklch(99.12% 0.0014 84.60)', // between neutral0 (white) and neutral50
    neutral50: 'oklch(98.23% 0.0028 84.60)',
    neutral100: 'oklch(95.56% 0.0057 84.59)',
    neutral200: 'oklch(91.04% 0.0086 84.59)',
    neutral300: 'oklch(80.87% 0.0119 84.59)',
    neutral400: 'oklch(62.61% 0.012 95.31)',
    neutral450: 'oklch(53.27% 0.0118 81.78)',
    neutral500: 'oklch(67.77% 0.0111 81.79)',
    neutral600: 'oklch(51.52% 0.0119 81.78)',
    neutral700: 'oklch(42.45% 0.007 84.60)',
    neutral800: 'oklch(34.10% 0.009 88.76)',
    neutral900: 'oklch(23.07% 0.0058 91.64)',

    // -- Surfaces (= palette stops) --
    background: 'oklch(98.23% 0.0028 84.60)', // = neutral50
    surface: 'oklch(100% 0 0)', // = neutral0
    surfaceRaised: 'oklch(98.23% 0.0028 84.60)', // = neutral50
    // One stop darker than surfaceRaised. Against a white panel that is a 4.4%
    // lightness step instead of 1.8% — the old value was invisible.
    surfaceOverlay: 'oklch(98.23% 0.0028 84.60)', // = neutral50 (unchanged)
    surfaceHover: 'oklch(95.56% 0.0057 84.59)', // = neutral100
    surfacePressed: 'oklch(95.56% 0.0057 84.59)', // = surfaceHover (unchanged; was raw neutral in the component)
    controlHover: 'oklch(95.56% 0.0057 84.59)', // = surfaceHover (unchanged — this theme never split them)
    // = neutral50, = background. Followed Empire's rail to a light ground on
    // 2026-08-12 — not for its own sake (this theme is retired), but because
    // `sidenav.css.ts` stopped painting its labels in translucent white the
    // same day. A dark rail here would now be dark text on dark.
    sidebarSurface: 'oklch(98.23% 0.0028 84.60)',
    navItemSelected: 'oklch(34.10% 0.009 88.76)', // = neutral800 (unchanged)
    navItemSelectedHover: 'oklch(23.07% 0.0058 91.64)', // = neutral900
    surfaceSelected: 'oklch(97.00% 0.0200 155.00)', // = accent50 (unchanged)
    selectionFill: 'oklch(41.51% 0.0058 91.59)', // = brand600 (unchanged)
    selectionFillHover: 'oklch(32.88% 0.0055 91.61)', // = brand700 (unchanged)
    selectionSoft: 'oklch(96.99% 0.0012 107.95)', // = brand50 (unchanged)
    onSelectionSoft: 'oklch(32.88% 0.0055 91.61)', // = brand700 (unchanged)
    selectionMark: 'oklch(51.38% 0.0059 93.43)', // = brand500 (unchanged)

    // -- Text (= palette stops) --
    textPrimary: 'oklch(34.10% 0.009 88.76)', // = neutral800
    textSecondary: 'oklch(51.52% 0.0119 81.78)', // = neutral600
    textTertiary: 'oklch(53.27% 0.0118 81.78)', // = neutral450
    textPlaceholder: 'oklch(50.00% 0.0119 84.59)', // = neutral500 (4.5:1+ on white)
    textInverse: 'oklch(23.07% 0.0058 91.64)', // = neutral900
    textOnBrand: 'oklch(100% 0 0)', // = neutral0
    onAccent: 'oklch(100% 0 0)', // = textOnBrand (unchanged)
    accentFill: 'oklch(62.34% 0.1600 155.00)', // = accent400
    accentFillHover: 'oklch(54.26% 0.1558 155.00)', // = accent500
    accentFillPressed: 'oklch(45.01% 0.1434 155.00)', // = accent600
    textLink: 'oklch(51.38% 0.0059 93.43)', // = brand500 (unchanged)
    textLinkUnderline: 'oklch(69.87% 0.0057 93.43)', // = brand300 (unchanged)
    textLinkHover: 'oklch(41.51% 0.0058 91.59)', // = brand600 (unchanged)

    // -- Borders (= palette stops) --
    border: 'oklch(91.04% 0.0086 84.59)', // = neutral200
    borderStrong: 'oklch(80.87% 0.0119 84.59)', // = neutral300
    borderFocus: 'oklch(73.48% 0.1478 84.61)',
    borderError: 'oklch(58.83% 0.1972 29.86)',

    // -- Status: success (teal-mint — distinct from emerald accent) --
    // -- Status: success (hue ~160-171) --
    success50: 'oklch(97.41% 0.0152 171.38)',
    success100: 'oklch(94.20% 0.0400 166.00)',
    success200: 'oklch(87.83% 0.0809 160.28)',
    success300: 'oklch(76.50% 0.1100 159.50)',
    success400: 'oklch(63.29% 0.1406 159.04)',
    success500: 'oklch(55.00% 0.1200 161.00)',
    success600: 'oklch(48.50% 0.1000 163.00)',
    success700: 'oklch(42.24% 0.085 165.11)',

    // -- Status: warning (hue ~70-83) --
    warning50: 'oklch(97.53% 0.0215 83.27)',
    warning100: 'oklch(93.80% 0.0520 82.00)',
    warning200: 'oklch(87.38% 0.0973 82.73)',
    warning300: 'oklch(81.00% 0.1280 76.00)',
    warning400: 'oklch(73.88% 0.1576 70.34)',
    warning500: 'oklch(63.00% 0.1400 68.00)',
    warning600: 'oklch(54.00% 0.1180 67.00)',
    warning700: 'oklch(45.48% 0.0964 66.28)',

    // -- Status: danger (hue ~27-30) --
    danger50: 'oklch(96.56% 0.0154 27.03)',
    danger100: 'oklch(92.50% 0.0400 27.50)',
    danger200: 'oklch(86.00% 0.0650 27.30)',
    danger300: 'oklch(79.82% 0.0867 27.07)',
    danger400: 'oklch(58.83% 0.1972 29.86)',
    danger500: 'oklch(53.50% 0.1800 30.00)',
    danger600: 'oklch(48.66% 0.1627 30.26)',
    danger700: 'oklch(40.50% 0.1200 30.50)',

    // -- Status: info (hue ~263-270) --
    info50: 'oklch(96.58% 0.0162 262.76)',
    info100: 'oklch(92.00% 0.0380 266.00)',
    info200: 'oklch(83.69% 0.0698 270.45)',
    info300: 'oklch(71.00% 0.1300 267.00)',
    info400: 'oklch(57.44% 0.192 263.86)',
    info500: 'oklch(50.00% 0.1760 264.50)',
    info600: 'oklch(45.50% 0.1680 265.00)',
    info700: 'oklch(41.15% 0.1603 265.57)',

    // -- On-color: text on vivid semantic backgrounds --
    onSuccess: 'oklch(100% 0 0)', // white on green
    onWarning: 'oklch(23.07% 0.0058 91.64)', // = neutral900 (dark on yellow)
    onDanger: 'oklch(100% 0 0)', // white on red
    onInfo: 'oklch(100% 0 0)', // white on blue
    onNeutral: 'oklch(100% 0 0)', // white on gray

    // -- Overlay --
    overlay: 'rgba(0, 0, 0, 0.4)',

    // -- Input --
    inputBg: 'oklch(100% 0 0)',
    inputBgHover: 'oklch(98.8% 0.001 84.60)',
    inputBgDisabled: 'oklch(95.56% 0.0057 84.59)',
    inputBorder: 'oklch(62.61% 0.012 95.31)',
    inputBorderHover: 'oklch(53.27% 0.0118 81.78)',
    inputShadowFocus: '0 0 0 3px oklch(73.48% 0.1478 84.61 / 0.22)',
    inputShadowError: '0 0 0 3px oklch(58.83% 0.1972 29.86 / 0.16)',
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
    label: "'DM Sans Variable', 'DM Sans', sans-serif", // = ui — no distinct label face yet
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
    color: 'oklch(55% 0.16 155)',
    shadow: '0 0 0 0.125rem oklch(55% 0.16 155), 0 0 0 0.25rem oklch(55% 0.16 155 / 0.25)',
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
