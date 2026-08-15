import { createTheme } from '@vanilla-extract/css';
import { vars } from './contract.css.js';

/**
 * Cipherpunk theme — Bitcoin-inspired, dark-only.
 *
 * Brand: Bitcoin orange (#F7931A) as primary, full ramp built around it.
 * Fonts: Geist (display/heading) + Geist Mono (UI/body).
 * Neutrals: cool slate grays — no warm undertone, to let the orange pop.
 * Semantics: adjusted to avoid clashing with orange brand.
 *   - Warning uses yellow (not amber/orange) to stay distinct from brand.
 *   - Success uses cyan-green to contrast the warm brand.
 */
export const cipherpunkTheme = createTheme(vars, {
  color: {
    // -- Brand: bitcoin orange ramp — full 10-step curve, 50→900 --
    brand50: 'oklch(17.69% 0.0327 69.65)',
    brand100: 'oklch(26.79% 0.0911 60.63)',
    brand200: 'oklch(34.75% 0.1328 55.86)',
    brand300: 'oklch(42.72% 0.1579 59.22)',
    brand400: 'oklch(51.82% 0.1662 62.58)',
    brand500: 'oklch(59.78% 0.1622 65.69)',
    brand600: 'oklch(68.88% 0.1503 68.81)',
    brand700: 'oklch(80.26% 0.1305 74.62)',
    brand800: 'oklch(89.36% 0.1027 80.94)',
    brand900: 'oklch(93.91% 0.0670 87.54)',

    // -- Accent: not used in cipherpunk (brand orange serves as accent) — full copy of brand --
    accent50: 'oklch(17.69% 0.0327 69.65)', // = brand50
    accent100: 'oklch(26.79% 0.0911 60.63)', // = brand100
    accent200: 'oklch(34.75% 0.1328 55.86)', // = brand200
    accent300: 'oklch(42.72% 0.1579 59.22)', // = brand300
    accent400: 'oklch(51.82% 0.1662 62.58)', // = brand400
    accent500: 'oklch(59.78% 0.1622 65.69)', // = brand500
    accent600: 'oklch(68.88% 0.1503 68.81)', // = brand600
    accent700: 'oklch(80.26% 0.1305 74.62)', // = brand700
    accent800: 'oklch(89.36% 0.1027 80.94)', // = brand800
    accent900: 'oklch(93.91% 0.0670 87.54)', // = brand900

    // -- Button surface (flat — no gradient) --
    brandButtonFrom: 'oklch(51.82% 0.1662 62.58)', // = brand400
    brandButtonTo: 'oklch(51.82% 0.1662 62.58)', // = brand400 (same = flat)
    brandButtonHoverFrom: 'oklch(68.88% 0.1503 68.81)', // = brand600 (lighter)
    brandButtonHoverTo: 'oklch(68.88% 0.1503 68.81)', // = brand600 (same = flat)
    brandButtonActiveFrom: 'oklch(68.88% 0.1503 68.81)', // = brand600 (lighter orange)
    brandButtonActiveTo: 'oklch(68.88% 0.1503 68.81)', // = brand600 (same = flat)
    brandButtonBorder: 'transparent', // no border for flat buttons

    // -- Secondary button surface (flat) --
    secondaryButtonFrom: 'oklch(26.20% 0.0074 285.81)', // = neutral200
    secondaryButtonTo: 'oklch(26.20% 0.0074 285.81)', // same = flat
    secondaryButtonHoverFrom: 'oklch(31.95% 0.0106 285.73)', // = neutral300
    secondaryButtonHoverTo: 'oklch(31.95% 0.0106 285.73)', // same = flat
    secondaryButtonBorder: 'transparent',

    // -- Danger button surface (flat) --
    dangerButtonFrom: 'oklch(65.62% 0.1934 29.18)', // = danger400
    dangerButtonTo: 'oklch(65.62% 0.1934 29.18)', // same = flat
    dangerButtonHoverFrom: 'oklch(72.80% 0.1462 29.16)', // = danger600 (lighter)
    dangerButtonHoverTo: 'oklch(72.80% 0.1462 29.16)', // same = flat
    dangerButtonBorder: 'transparent',

    // -- Neutral: cool slate (no warm undertone) --
    neutral0: 'oklch(15.53% 0.0042 285.83)',
    neutral25: 'oklch(17.17% 0.0051 285.79)', // between neutral0 and neutral50
    neutral50: 'oklch(18.81% 0.006 285.75)',
    neutral100: 'oklch(21.95% 0.0078 285.69)',
    neutral200: 'oklch(26.20% 0.0074 285.81)',
    neutral300: 'oklch(31.95% 0.0106 285.73)',
    neutral400: 'oklch(49.97% 0.0158 285.76)',
    neutral450: 'oklch(62.00% 0.0149 285.88)',
    neutral500: 'oklch(44.15% 0.013 285.79)',
    neutral600: 'oklch(66.32% 0.0147 285.91)',
    neutral700: 'oklch(75.97% 0.0114 286.00)',
    neutral800: 'oklch(86.55% 0.0083 286.03)',
    neutral900: 'oklch(94.70% 0.0041 285.87)',

    // -- Surfaces (= palette stops) --
    background: 'oklch(15.53% 0.0042 285.83)', // = neutral0
    surface: 'oklch(18.81% 0.006 285.75)', // = neutral50
    surfaceRaised: 'oklch(21.95% 0.0078 285.69)', // = neutral100
    // Unchanged from surfaceRaised. Not user-selectable (absent from
    // ThemeGallery), so it only has to satisfy the contract.
    surfaceOverlay: 'oklch(18.81% 0.006 285.75)', // = neutral50 (unchanged)
    surfaceHover: 'oklch(21.95% 0.0078 285.69)', // = neutral100
    surfacePressed: 'oklch(21.95% 0.0078 285.69)', // = surfaceHover (unchanged; was raw neutral in the component)
    controlHover: 'oklch(21.95% 0.0078 285.69)', // = surfaceHover (unchanged — this theme never split them)
    sidebarSurface: 'oklch(94.70% 0.0041 285.87)', // = neutral900 (unchanged)
    navItemSelected: 'oklch(86.55% 0.0083 286.03)', // = neutral800 (unchanged)
    navItemSelectedHover: 'oklch(94.70% 0.0041 285.87)', // = neutral900
    surfaceSelected: 'oklch(17.69% 0.0327 69.65)', // = accent50 (unchanged)
    selectionFill: 'oklch(68.88% 0.1503 68.81)', // = brand600 (unchanged)
    selectionFillHover: 'oklch(80.26% 0.1305 74.62)', // = brand700 (unchanged)
    selectionSoft: 'oklch(17.69% 0.0327 69.65)', // = brand50 (unchanged)
    onSelectionSoft: 'oklch(80.26% 0.1305 74.62)', // = brand700 (unchanged)
    selectionMark: 'oklch(59.78% 0.1622 65.69)', // = brand500 (unchanged)

    // -- Text (= palette stops) --
    textPrimary: 'oklch(86.55% 0.0083 286.03)', // = neutral800
    textSecondary: 'oklch(66.32% 0.0147 285.91)', // = neutral600
    textTertiary: 'oklch(62.00% 0.0149 285.88)', // = neutral450
    textPlaceholder: 'oklch(31.95% 0.0106 285.73)', // = neutral300
    textInverse: 'oklch(94.70% 0.0041 285.87)', // = neutral900
    textOnBrand: 'oklch(15.53% 0.0042 285.83)', // = neutral0
    onAccent: 'oklch(15.53% 0.0042 285.83)', // = textOnBrand (unchanged)
    accentFill: 'oklch(51.82% 0.1662 62.58)', // = accent400
    accentFillHover: 'oklch(59.78% 0.1622 65.69)', // = accent500
    accentFillPressed: 'oklch(68.88% 0.1503 68.81)', // = accent600
    textLink: 'oklch(59.78% 0.1622 65.69)', // = brand500 (unchanged)
    textLinkUnderline: 'oklch(42.72% 0.1579 59.22)', // = brand300 (unchanged)
    textLinkHover: 'oklch(68.88% 0.1503 68.81)', // = brand600 (unchanged)

    // -- Borders (= palette stops) --
    border: 'oklch(26.20% 0.0074 285.81)', // = neutral200
    borderStrong: 'oklch(31.95% 0.0106 285.73)', // = neutral300
    borderFocus: 'oklch(75.24% 0.1662 62.58)',
    borderError: 'oklch(65.62% 0.1934 29.18)',

    // -- Status: success (cyan-green — cool contrast to orange) --
    success50: 'oklch(21.45% 0.0312 180.71)',
    success100: 'oklch(28.00% 0.050 172.00)',
    success200: 'oklch(36.67% 0.0673 168.09)',
    success300: 'oklch(50.00% 0.1100 165.00)',
    success400: 'oklch(77.81% 0.1607 163.65)',
    success500: 'oklch(82.00% 0.1350 166.00)',
    success600: 'oklch(85.50% 0.1100 168.00)',
    success700: 'oklch(88.29% 0.1092 169.01)',

    // -- Status: warning (yellow — distinct from orange brand) --
    warning50: 'oklch(21.21% 0.0347 109.05)',
    warning100: 'oklch(28.50% 0.050 109.20)',
    warning200: 'oklch(39.70% 0.0767 109.45)',
    warning300: 'oklch(58.00% 0.1200 106.00)',
    warning400: 'oklch(86.89% 0.1718 103.60)',
    warning500: 'oklch(89.00% 0.1550 104.50)',
    warning600: 'oklch(91.00% 0.1430 105.00)',
    warning700: 'oklch(93.22% 0.1324 105.46)',

    // -- Status: danger --
    danger50: 'oklch(22.68% 0.042 30.21)',
    danger100: 'oklch(28.00% 0.065 30.00)',
    danger200: 'oklch(34.00% 0.090 30.00)',
    danger300: 'oklch(40.24% 0.1138 29.95)',
    danger400: 'oklch(65.62% 0.1934 29.18)',
    danger500: 'oklch(69.00% 0.1700 29.10)',
    danger600: 'oklch(72.80% 0.1462 29.16)',
    danger700: 'oklch(80.00% 0.1000 29.20)',

    // -- Status: info (blue-violet — cooler to match slate neutrals) --
    info50: 'oklch(20.53% 0.0511 277.57)',
    info100: 'oklch(25.50% 0.080 274.00)',
    info200: 'oklch(31.82% 0.124 271.36)',
    info300: 'oklch(46.00% 0.1350 272.00)',
    info400: 'oklch(67.74% 0.1449 273.16)',
    info500: 'oklch(73.00% 0.1200 273.80)',
    info600: 'oklch(78.00% 0.0970 274.20)',
    info700: 'oklch(82.89% 0.0744 274.54)',

    // -- On-color: text on vivid semantic backgrounds --
    onSuccess: 'oklch(15.53% 0.0042 285.83)', // = neutral0 (dark on cyan-green)
    onWarning: 'oklch(15.53% 0.0042 285.83)', // = neutral0 (dark on yellow)
    onDanger: 'oklch(15.53% 0.0042 285.83)', // = neutral0 (dark on red)
    onInfo: 'oklch(15.53% 0.0042 285.83)', // = neutral0 (dark on blue)
    onNeutral: 'oklch(15.53% 0.0042 285.83)', // = neutral0 (dark on gray)

    // -- Overlay --
    overlay: 'rgba(0, 0, 0, 0.7)',

    // -- Input --
    inputBg: 'oklch(18.81% 0.006 285.75)',
    inputBgHover: 'oklch(20.5% 0.007 285.72)',
    inputBgDisabled: 'oklch(16.5% 0.004 285.83)',
    inputBorder: 'oklch(49.97% 0.0158 285.76)',
    inputBorderHover: 'oklch(62.00% 0.0149 285.88)',
    inputShadowFocus: '0 0 0 3px oklch(75.24% 0.1662 62.58 / 0.24)',
    inputShadowError: '0 0 0 3px oklch(65.62% 0.1934 29.18 / 0.18)',
    inputShadow: '0 1px 2px rgba(0,0,0,0.2), inset 0 1px 2px rgba(0,0,0,0.12)',

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
    // Geist for display/heading, Geist Mono for UI/body
    display: "'Geist', 'Inter', system-ui, sans-serif",
    ui: "'Geist Mono', ui-monospace, 'Cascadia Code', monospace",
    label: "'Geist Mono', ui-monospace, 'Cascadia Code', monospace", // = ui — no distinct label face yet
    code: "'Geist Mono', ui-monospace, 'Cascadia Code', monospace",

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

  // Shadows with orange-tinted outer glow
  shadow: {
    sm: '0 0 0 1px rgba(247,147,26,0.06), 0 1px 3px rgba(0,0,0,0.3), 0 2px 6px rgba(0,0,0,0.2)',
    md: '0 0 0 1px rgba(247,147,26,0.06), 0 4px 12px rgba(0,0,0,0.4), 0 2px 4px rgba(0,0,0,0.25)',
    lg: '0 0 0 1px rgba(247,147,26,0.08), 0 8px 32px rgba(0,0,0,0.5), 0 3px 10px rgba(0,0,0,0.3)',
  },

  focus: {
    width: '0.125rem',
    offset: '0.125rem',
    color: 'oklch(75.24% 0.1662 62.58)',
    shadow:
      '0 0 0 0.125rem oklch(75.24% 0.1662 62.58), 0 0 0 0.25rem oklch(75.24% 0.1662 62.58 / 0.25)',
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
    thumb: 'oklch(75.24% 0.1662 62.58 / 0.4)',
    thumbHover: 'oklch(79.36% 0.1489 68.81 / 0.6)',
    track: 'transparent',
    radius: '0.25rem',
  },
});
