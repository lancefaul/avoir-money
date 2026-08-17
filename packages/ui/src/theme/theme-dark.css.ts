import { createTheme } from '@vanilla-extract/css';
import { vars } from './contract.css.js';

/**
 * Dark theme — Cool-neutral dark surfaces with ivory white brand.
 *
 * Neutrals: hue 260 (cool blue-gray), very low chroma.
 * Brand: near-white ivory for primary interactive elements.
 * Surfaces: dark bg/title bar, slightly lighter cards.
 * Semantics: desaturated for comfortable dark-mode reading.
 */
export const darkTheme = createTheme(vars, {
  color: {
    // -- Brand: ivory white ramp (adjusted for cooler neutrals) — full 10-step curve, 50→900 --
    brand50: 'oklch(24.00% 0.0080 260.00)',
    brand100: 'oklch(33.07% 0.0067 260.00)',
    brand200: 'oklch(41.01% 0.0057 260.00)',
    brand300: 'oklch(48.96% 0.0052 260.00)',
    brand400: 'oklch(58.03% 0.0050 260.00)', // primary — near-white
    brand500: 'oklch(65.97% 0.0048 260.00)',
    brand600: 'oklch(75.04% 0.0042 260.00)',
    brand700: 'oklch(86.39% 0.0032 260.00)',
    brand800: 'oklch(95.46% 0.0018 260.00)',
    brand900: 'oklch(100% 0 0)', // pure white

    // -- Accent: emerald green (links, interactive highlights) — full 10-step curve --
    accent50: 'oklch(24.00% 0.0400 155.00)',
    accent100: 'oklch(32.79% 0.0750 155.00)',
    accent200: 'oklch(40.48% 0.1000 155.00)',
    accent300: 'oklch(48.17% 0.1150 155.00)',
    accent400: 'oklch(56.96% 0.1200 155.00)',
    accent500: 'oklch(64.64% 0.1154 155.00)',
    accent600: 'oklch(73.43% 0.1014 155.00)',
    accent700: 'oklch(84.42% 0.0782 155.00)',
    accent800: 'oklch(93.21% 0.0458 155.00)',
    accent900: 'oklch(97.60% 0.0040 155.00)',

    // -- Button surface (ivory white, flat for dark mode) --
    brandButtonFrom: 'oklch(95.46% 0.0018 260.00)', // = brand800
    brandButtonTo: 'oklch(95.46% 0.0018 260.00)', // = brand800
    brandButtonHoverFrom: 'oklch(100% 0 0)', // = brand900
    brandButtonHoverTo: 'oklch(100% 0 0)', // = brand900
    brandButtonActiveFrom: 'oklch(48.96% 0.0052 260.00)', // = brand300
    brandButtonActiveTo: 'oklch(48.96% 0.0052 260.00)', // = brand300
    brandButtonBorder: 'oklch(86.39% 0.0032 260.00)', // = brand700

    // -- Secondary button surface (dark, subtle) --
    secondaryButtonFrom: 'oklch(26.50% 0.008 260)',
    secondaryButtonTo: 'oklch(26.50% 0.008 260)',
    secondaryButtonHoverFrom: 'oklch(32.50% 0.009 260)',
    secondaryButtonHoverTo: 'oklch(32.50% 0.009 260)',
    secondaryButtonBorder: 'oklch(32.50% 0.009 260)',

    // -- Danger button surface (dark mode — desaturated) --
    dangerButtonFrom: 'oklch(58% 0.14 29)',
    dangerButtonTo: 'oklch(58% 0.14 29)',
    dangerButtonHoverFrom: 'oklch(63% 0.12 29)',
    dangerButtonHoverTo: 'oklch(63% 0.12 29)',
    dangerButtonBorder: 'oklch(38% 0.09 30)',

    // -- Neutral: cool-neutral ramp (dark mode) --
    // Low chroma, cool hue. neutral0 = card surface (lighter), bg/chrome = darkest.
    neutral0: 'oklch(18.50% 0.006 260)', // card bg
    neutral25: 'oklch(16.50% 0.005 260)', // between neutral0 (card) and neutral50 (canvas)
    neutral50: 'oklch(14.50% 0.004 260)', // page canvas / title bar
    neutral100: 'oklch(24.00% 0.007 260)', // subtle chip/badge bg
    neutral200: 'oklch(26.50% 0.008 260)',
    neutral300: 'oklch(32.50% 0.009 260)',
    neutral400: 'oklch(48.00% 0.01 260)',
    neutral450: 'oklch(58.00% 0.009 260)',
    neutral500: 'oklch(44.00% 0.01 260)',
    neutral600: 'oklch(63.00% 0.009 260)',
    neutral700: 'oklch(74.00% 0.007 260)',
    neutral800: 'oklch(86.00% 0.005 260)',
    neutral900: 'oklch(14.50% 0.004 260)',

    // -- Surfaces --
    // Dark bg + title bar, lighter cards.
    background: 'oklch(14.50% 0.004 260)', // page canvas (dark)
    surface: 'oklch(18.50% 0.006 260)', // cards (lighter, pops against bg)
    surfaceRaised: 'oklch(14.50% 0.004 260)', // title bar (same as bg)
    // LIGHTER than the panel, not darker. `surfaceRaised` is the page canvas
    // (14.5%), so borrowing it made a hovered row recede into the background
    // instead of coming forward — a 4% step in the wrong direction. Every
    // interactive surface in the dark themes now lightens on hover.
    surfaceOverlay: 'oklch(14.50% 0.004 260)', // = neutral50 (unchanged)
    surfaceHover: 'oklch(24.00% 0.007 260)', // = neutral100
    surfacePressed: 'oklch(24.00% 0.007 260)', // = surfaceHover (unchanged; was raw neutral in the component)
    controlHover: 'oklch(24.00% 0.007 260)', // = surfaceHover (unchanged — this theme never split them)
    sidebarSurface: 'oklch(14.50% 0.004 260)', // = neutral900 (unchanged)
    navItemSelected: 'oklch(86.00% 0.005 260)', // = neutral800 (unchanged)
    navItemSelectedHover: 'oklch(74.00% 0.007 260)', // = neutral700 — DOWN the ramp: neutral800 is already this theme's lightest stop
    surfaceSelected: 'oklch(24.00% 0.0400 155.00)', // = accent50 (unchanged)
    selectionFill: 'oklch(75.04% 0.0042 260.00)', // = brand600 (unchanged)
    selectionFillHover: 'oklch(86.39% 0.0032 260.00)', // = brand700 (unchanged)
    selectionSoft: 'oklch(24.00% 0.0080 260.00)', // = brand50 (unchanged)
    onSelectionSoft: 'oklch(86.39% 0.0032 260.00)', // = brand700 (unchanged)
    selectionMark: 'oklch(65.97% 0.0048 260.00)', // = brand500 (unchanged)

    // -- Text --
    textPrimary: 'oklch(86.00% 0.005 260)', // = neutral800
    textSecondary: 'oklch(63.00% 0.009 260)', // = neutral600
    textTertiary: 'oklch(58.00% 0.009 260)', // = neutral450
    textPlaceholder: 'oklch(32.50% 0.009 260)', // = neutral300
    textInverse: 'oklch(94.00% 0.003 260)', // lightest text
    textOnBrand: 'oklch(14.50% 0.004 260)', // = neutral100 (darkest)
    onAccent: 'oklch(14.50% 0.004 260)', // = textOnBrand (unchanged)
    accentFill: 'oklch(56.96% 0.1200 155.00)', // = accent400
    accentFillHover: 'oklch(64.64% 0.1154 155.00)', // = accent500
    accentFillPressed: 'oklch(73.43% 0.1014 155.00)', // = accent600
    textLink: 'oklch(65.97% 0.0048 260.00)', // = brand500 (unchanged)
    textLinkUnderline: 'oklch(48.96% 0.0052 260.00)', // = brand300 (unchanged)
    textLinkHover: 'oklch(75.04% 0.0042 260.00)', // = brand600 (unchanged)

    // -- Borders --
    border: 'oklch(26.50% 0.008 260)', // = neutral200
    borderStrong: 'oklch(32.50% 0.009 260)', // = neutral300
    borderFocus: 'oklch(72% 0.16 155)',
    borderError: 'oklch(58% 0.16 29)',

    // -- Status: success (hue ~153-164, dark mode: desaturated, softer) --
    success50: 'oklch(26% 0.04 160)',
    success100: 'oklch(30% 0.05 158)',
    success200: 'oklch(34% 0.07 155)',
    success300: 'oklch(44% 0.09 155)',
    success400: 'oklch(62% 0.11 157)',
    success500: 'oklch(68% 0.10 159)',
    success600: 'oklch(73% 0.08 161)',
    success700: 'oklch(78% 0.07 163)',

    // -- Status: warning (hue ~70-80, dark mode: toned down) --
    warning50: 'oklch(26% 0.04 78)',
    warning100: 'oklch(30% 0.05 74)',
    warning200: 'oklch(34% 0.065 68)',
    warning300: 'oklch(46% 0.09 70)',
    warning400: 'oklch(68% 0.12 74)',
    warning500: 'oklch(72% 0.11 76)',
    warning600: 'oklch(76% 0.10 78)',
    warning700: 'oklch(80% 0.09 80)',

    // -- Status: danger (hue ~29-30, dark mode: reduced chroma) --
    danger50: 'oklch(26% 0.05 30)',
    danger100: 'oklch(30% 0.06 30)',
    danger200: 'oklch(34% 0.075 30)',
    danger300: 'oklch(38% 0.09 30)',
    danger400: 'oklch(58% 0.14 29)',
    danger500: 'oklch(63% 0.12 29)',
    danger600: 'oklch(68% 0.10 29)',
    danger700: 'oklch(74% 0.08 29)',

    // -- Status: info (hue ~267-270, dark mode: softened) --
    info50: 'oklch(26% 0.05 270)',
    info100: 'oklch(30% 0.06 269)',
    info200: 'oklch(34% 0.09 268)',
    info300: 'oklch(42% 0.11 268)',
    info400: 'oklch(60% 0.12 267)',
    info500: 'oklch(66% 0.10 268)',
    info600: 'oklch(72% 0.08 268)',
    info700: 'oklch(77% 0.06 269)',

    // -- On-color: text on vivid semantic backgrounds --
    onSuccess: 'oklch(14.50% 0.004 260)', // = neutral50 (dark on bright green)
    onWarning: 'oklch(14.50% 0.004 260)', // = neutral50 (dark on bright yellow)
    onDanger: 'oklch(14.50% 0.004 260)', // = neutral50 (dark on bright red)
    onInfo: 'oklch(14.50% 0.004 260)', // = neutral50 (dark on bright blue)
    onNeutral: 'oklch(14.50% 0.004 260)', // = neutral50 (dark on bright gray)

    // -- Overlay --
    overlay: 'rgba(0, 0, 0, 0.6)',

    // -- Input --
    inputBg: 'oklch(18.50% 0.006 260)',
    inputBgHover: 'oklch(20.50% 0.007 260)',
    inputBgDisabled: 'oklch(16.00% 0.005 260)',
    inputBorder: 'oklch(44.00% 0.01 260)',
    inputBorderHover: 'oklch(54.00% 0.01 260)',
    inputShadowFocus: '0 0 0 3px oklch(72% 0.16 155 / 0.24)',
    inputShadowError: '0 0 0 3px oklch(58% 0.14 29 / 0.18)',
    inputShadow: '0 1px 2px rgba(0,0,0,0.15), inset 0 1px 2px rgba(0,0,0,0.1)',

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
    label: "'DM Sans Variable', 'DM Sans', sans-serif", // = ui — no distinct label face yet
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
    color: 'oklch(72% 0.16 155)',
    shadow: '0 0 0 0.125rem oklch(72% 0.16 155), 0 0 0 0.25rem oklch(72% 0.16 155 / 0.25)',
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
