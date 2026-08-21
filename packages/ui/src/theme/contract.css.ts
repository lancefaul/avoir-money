import { createThemeContract } from '@vanilla-extract/css';

/**
 * Avoir Money Design System — Theme Contract
 *
 * Defines the shape of all design tokens. Any theme implementation
 * must provide values for every key defined here.
 *
 * UNITS POLICY:
 * - All values in rem (base 16px) unless noted otherwise.
 * - Border widths are the ONLY exception — specified in px.
 * - Colors use OKLCH for perceptual uniformity and wide-gamut support.
 *
 * SPACING SYSTEM:
 * - 4px (0.25rem) base grid.
 * - Scale: 0, 2, 4, then increments of 4 through 64.
 *
 * BORDER RADIUS NESTING RULE (philosophy, not enforced in code):
 * - childRadius = parentRadius - parentPadding
 * - If the result is <= 0, the child gets no radius.
 * - Example: card radius 0.75rem with 1rem padding -> child radius 0.
 * - Example: card radius 0.75rem with 0.5rem padding -> child radius 0.25rem.
 */
export const vars = createThemeContract({
  color: {
    // -- Brand ramp (full 10-step scale, 50 → 900) --
    brand50: null,
    brand100: null,
    brand200: null,
    brand300: null,
    brand400: null,
    brand500: null,
    brand600: null,
    brand700: null,
    brand800: null,
    brand900: null,

    // -- Accent ramp (emerald; full 10-step scale, 50 → 900) --
    accent50: null,
    accent100: null,
    accent200: null,
    accent300: null,
    accent400: null,
    accent500: null,
    accent600: null,
    accent700: null,
    accent800: null,
    accent900: null,

    // -- Button surface (allows flat vs gradient per theme) --
    brandButtonFrom: null,
    brandButtonTo: null,
    brandButtonHoverFrom: null,
    brandButtonHoverTo: null,
    brandButtonActiveFrom: null,
    brandButtonActiveTo: null,
    brandButtonBorder: null,

    // -- Secondary button surface --
    secondaryButtonFrom: null,
    secondaryButtonTo: null,
    secondaryButtonHoverFrom: null,
    secondaryButtonHoverTo: null,
    secondaryButtonBorder: null,

    // -- Danger button surface --
    dangerButtonFrom: null,
    dangerButtonTo: null,
    dangerButtonHoverFrom: null,
    dangerButtonHoverTo: null,
    dangerButtonBorder: null,

    // -- Neutral ramp (warm gray) --
    neutral0: null,
    /**
     * Between `neutral0` and `neutral50`.
     *
     * Added because Empire had nothing between white and its cream seed
     * (#F5F0E6, 95.63% L), so `surfaceRaised` had to borrow `neutral50` — the
     * exact colour of the page canvas. A card meant to sit ABOVE the page was
     * painted the page's own colour, which reads as a hole rather than a lift.
     */
    neutral25: null,
    neutral50: null,
    neutral100: null,
    neutral200: null,
    neutral300: null,
    neutral400: null,
    neutral450: null,
    neutral500: null,
    neutral600: null,
    neutral700: null,
    neutral800: null,
    neutral900: null,

    // -- Semantic: surfaces --
    background: null,
    surface: null,
    surfaceRaised: null,
    /**
     * Hover/highlight fill for a row inside a floating panel — menu items,
     * select options, calendar days.
     *
     * Its own token rather than `surfaceRaised` because the two answer different
     * questions. `surfaceRaised` says "this card sits above the page"; this says
     * "the pointer is on this row", and the contrast it needs is against
     * `surface` (what every panel is painted with), not against `background`.
     * Sharing one value forced those two jobs to move together: the light themes
     * put `surfaceRaised` a hair under white, which is right for a card edge and
     * left menu hover at a ~2% lightness step nobody could see.
     */
    /**
     * Modals and drawers — the floating layer.
     *
     * Specified in DESIGN.md's surface hierarchy since the theme system was
     * written, but never actually added to this contract, so modal panels read
     * `neutral50` instead. That is identical to `background` in four of the six
     * themes, which is why it looked correct: the coincidence held until Empire
     * moved its canvas and its modals stayed on the cream seed.
     *
     * NOTE: dropdown and datepicker panels are listed alongside modals in that
     * DESIGN.md row but still paint `surface`. Deliberately left alone — moving
     * them would repaint every dropdown in every theme, and the hover fill above
     * is tuned against `surface`.
     */
    surfaceOverlay: null,
    surfaceHover: null,
    /**
     * Pressed fill for a row in a floating panel — the moment between hover and
     * release on a menu item or its trigger.
     *
     * Its own role because it has to track `surfaceHover` per theme, and the two
     * cannot share a stop: the press must read deeper than the hover it replaces,
     * and "deeper" is a different direction in a light theme than a dark one.
     * Was raw `neutral100`/`neutral200` in dropdown-menu, which is exactly the
     * kind of borrowed stop that cannot follow a theme.
     */
    surfacePressed: null,
    /**
     * Hover fill for a CONTROL that is not a panel row — the ghost button.
     *
     * Split from `surfaceHover` on 2026-08-09. The ghost button had been sharing
     * it on the reasoning that "one fill for every hover gesture" keeps a button
     * and a menu row responding identically. That held until the two roles were
     * asked to be different colours: menu rows went accent, and the button
     * followed it there without anyone choosing that. A button hovering is not a
     * row highlighting, and this token is what lets them disagree.
     */
    controlHover: null,
    /**
     * The left rail's background.
     *
     * A semantic role, not a shade. It was reading `neutral900` directly, which
     * is fine while every theme wants a near-black rail and impossible the
     * moment one does not — Empire's charcoal seed made its nav black in a
     * theme with no other black in it.
     */
    sidebarSurface: null,
    /**
     * Fill behind a SELECTED tab or vertical nav item (ADR-026: one nav-item
     * visual language for both).
     *
     * Was `neutral800`, with the same problem: a selection is a statement about
     * state, so a theme has to be able to say it in its own colour.
     */
    navItemSelected: null,
    /**
     * Hovering a nav item that is ALREADY selected.
     *
     * Its own token because there was no honest way to derive it. Hovering a
     * selected rail item used to change the label instead of the fill — the
     * base hover set `textPrimary` and the selected rule set only a background,
     * so the white label turned black on its own pill. Fixing the label alone
     * would have made hover do nothing at all on a selected item.
     *
     * One visible step along the theme's own ramp, and the direction is per
     * theme rather than a rule: the label is `neutral0`, so most themes move
     * AWAY from it — darker in the light themes, lighter in the dark ones. Dark
     * and Midnight cannot, because their `neutral800` IS the lightest stop they
     * have (`neutral900` wraps back to the canvas), so they step down instead
     * and keep a ~55-point gap, which is ample. The requirement is the gap, not
     * the direction; `on-vivid-fills.test.ts` asserts the gap.
     */
    navItemSelectedHover: null,
    /**
     * Fill behind a SELECTED row — a chosen transaction, a chosen saved
     * description.
     *
     * Its own role rather than `accent50`, which every consumer used to read
     * directly. That works only while the darkest accent stop happens to sit far
     * enough from the theme's surface, and Empire Dark is where it stopped
     * being true: accent50 is 22.9% against a 22.6% surface, a 0.3% step, so a
     * selected row was indistinguishable from an unselected one. Every other
     * theme keeps the exact value it already rendered.
     */
    surfaceSelected: null,
    /**
     * A committed selection that is FILLED — a chosen calendar day, a range
     * endpoint — plus its hover, its soft band (the days between endpoints and
     * that band's text), and the mark on a checked menu row.
     *
     * Tokens because the datepicker and dropdown named `brand*` directly, so no
     * theme could redirect them. Empire light keeps selection green; Empire Dark
     * puts it on the accent (brass) while its hover moves to green — the two
     * swapped ramps, which is only expressible per theme.
     *
     * The label ON `selectionFill` is not a token: it is `neutral0` in every
     * theme, which is white in the light ones and the card colour in the dark
     * ones — dark-on-bright either way.
     */
    selectionFill: null,
    selectionFillHover: null,
    selectionSoft: null,
    onSelectionSoft: null,
    selectionMark: null,

    // -- Semantic: text --
    textPrimary: null,
    textSecondary: null,
    textTertiary: null,
    textPlaceholder: null,
    textInverse: null,
    textOnBrand: null,
    /**
     * Text drawn on an ACCENT fill — currently the selected button-group segment.
     *
     * Separate from `textOnBrand` because the two fills want opposite labels in
     * Empire light: the brand fill is a dark green and takes white, while the
     * accent fill is a light brass and takes near-black. Reusing `onWarning`
     * would have worked today and been wrong the moment warning moved — which
     * it did, to orange, earlier the same day.
     */
    /**
     * A filled ACCENT surface and its interaction states — currently the
     * selected button-group segment. Pairs with `onAccent` for the label.
     *
     * Per-theme rather than a ramp stop, because the accent ramp INVERTS between
     * Empire light and dark: `accent200` is a pale 89.1% brass in light and a
     * 50.1% mid-brass in dark, where the near-black label falls to 3.01:1. The
     * same stop cannot serve both, so each theme names its own fill.
     *
     * Both directions still hold within a theme — light darkens toward the
     * press, dark lightens.
     */
    accentFill: null,
    accentFillHover: null,
    accentFillPressed: null,
    onAccent: null,
    /**
     * Link text, its underline at rest, and its hover colour.
     *
     * Tokens rather than ramp stops in `links.css.ts`, which named `brand*`
     * directly and so could not be redirected by a theme at all. Empire Dark
     * puts links on the accent (brass) while Empire light keeps them on the
     * brand green — that divergence is the entire reason these exist.
     *
     * `textLinkUnderline` is deliberately softer than `textLink`: the underline
     * is decoration, so it is the one of the three not held to the 4.5:1 text
     * floor. On hover the underline takes `textLink`, which is how the original
     * hardcoded values behaved.
     */
    textLink: null,
    textLinkUnderline: null,
    textLinkHover: null,

    // -- Semantic: borders --
    border: null,
    borderStrong: null,
    borderFocus: null,
    borderError: null,

    // -- Semantic: status --
    success50: null,
    success100: null,
    success200: null,
    success300: null,
    success400: null,
    success500: null,
    success600: null,
    success700: null,
    warning50: null,
    warning100: null,
    warning200: null,
    warning300: null,
    warning400: null,
    warning500: null,
    warning600: null,
    warning700: null,
    danger50: null,
    danger100: null,
    danger200: null,
    danger300: null,
    danger400: null,
    danger500: null,
    danger600: null,
    danger700: null,
    info50: null,
    info100: null,
    info200: null,
    info300: null,
    info400: null,
    info500: null,
    info600: null,
    info700: null,

    // -- On-color: readable text/icon on vivid semantic backgrounds --
    onSuccess: null,
    onWarning: null,
    onDanger: null,
    onInfo: null,
    onNeutral: null,

    // -- Overlay --
    overlay: null,

    // -- Input --
    inputBg: null,
    inputBgHover: null,
    inputBgDisabled: null,
    inputBorder: null,
    inputBorderHover: null,
    inputShadowFocus: null,
    inputShadowError: null,
    inputShadow: null,

    // -- Data visualization palette (12 series) --
    dataViz1: null, // rose
    dataViz2: null, // clay
    dataViz3: null, // brass
    dataViz4: null, // olive
    dataViz5: null, // fern
    dataViz6: null, // green
    dataViz7: null, // teal
    dataViz8: null, // steel
    dataViz9: null, // slateBlue
    dataViz10: null, // indigo
    dataViz11: null, // violet
    dataViz12: null, // plum

    // -- Data visualization scales (10 steps per series) --
    // Rose scale (hue 12.5)
    rose50: null,
    rose100: null,
    rose200: null,
    rose300: null,
    rose400: null,
    rose500: null, // = dataViz1
    rose600: null,
    rose700: null,
    rose800: null,
    rose900: null,

    // Clay scale (hue 45)
    clay50: null,
    clay100: null,
    clay200: null,
    clay300: null,
    clay400: null,
    clay500: null, // = dataViz2
    clay600: null,
    clay700: null,
    clay800: null,
    clay900: null,

    // Brass scale (hue 85)
    brass50: null,
    brass100: null,
    brass200: null,
    brass300: null,
    brass400: null,
    brass500: null, // = dataViz3
    brass600: null,
    brass700: null,
    brass800: null,
    brass900: null,

    // Olive scale (hue 120)
    olive50: null,
    olive100: null,
    olive200: null,
    olive300: null,
    olive400: null,
    olive500: null, // = dataViz4
    olive600: null,
    olive700: null,
    olive800: null,
    olive900: null,

    // Fern scale (hue 142.5)
    fern50: null,
    fern100: null,
    fern200: null,
    fern300: null,
    fern400: null,
    fern500: null, // = dataViz5
    fern600: null,
    fern700: null,
    fern800: null,
    fern900: null,

    // Green scale (hue 165)
    green50: null,
    green100: null,
    green200: null,
    green300: null,
    green400: null,
    green500: null, // = dataViz6
    green600: null,
    green700: null,
    green800: null,
    green900: null,

    // Teal scale (hue 200)
    teal50: null,
    teal100: null,
    teal200: null,
    teal300: null,
    teal400: null,
    teal500: null, // = dataViz7
    teal600: null,
    teal700: null,
    teal800: null,
    teal900: null,

    // Steel scale (hue 222.5)
    steel50: null,
    steel100: null,
    steel200: null,
    steel300: null,
    steel400: null,
    steel500: null, // = dataViz8
    steel600: null,
    steel700: null,
    steel800: null,
    steel900: null,

    // SlateBlue scale (hue 245)
    slateBlue50: null,
    slateBlue100: null,
    slateBlue200: null,
    slateBlue300: null,
    slateBlue400: null,
    slateBlue500: null, // = dataViz9
    slateBlue600: null,
    slateBlue700: null,
    slateBlue800: null,
    slateBlue900: null,

    // Indigo scale (hue 272.5)
    indigo50: null,
    indigo100: null,
    indigo200: null,
    indigo300: null,
    indigo400: null,
    indigo500: null, // = dataViz10
    indigo600: null,
    indigo700: null,
    indigo800: null,
    indigo900: null,

    // Violet scale (hue 300)
    violet50: null,
    violet100: null,
    violet200: null,
    violet300: null,
    violet400: null,
    violet500: null, // = dataViz11
    violet600: null,
    violet700: null,
    violet800: null,
    violet900: null,

    // Plum scale (hue 340)
    plum50: null,
    plum100: null,
    plum200: null,
    plum300: null,
    plum400: null,
    plum500: null, // = dataViz12
    plum600: null,
    plum700: null,
    plum800: null,
    plum900: null,

    // -- Data visualization: diverging (over budget <-> under budget) --
    dataVizDiverging1: null,
    dataVizDiverging2: null,
    dataVizDiverging3: null,
    dataVizDiverging4: null,
    dataVizDiverging5: null,
    dataVizDiverging6: null,
    dataVizDiverging7: null,

    // -- Fixed brand colors (same across all themes) --
    bitcoinOrange: null,
  },

  // -- Typography --
  font: {
    // Families
    display: null,
    ui: null,
    /**
     * Labels, eyebrows and small uppercase run-ins.
     *
     * The fourth slot, added 2026-08-10. Defaults to the same stack as `ui` in
     * every theme, so nothing moves until a theme deliberately points it
     * somewhere else — the slot exists to make that possible, not to change
     * anything on its own.
     */
    label: null,
    code: null,

    // Sizes (rem) — mapped from the tokens HTML
    // 11px = 0.6875rem, 12px = 0.75rem, 13px = 0.8125rem,
    // 14px = 0.875rem, 18px = 1.125rem, 20px = 1.25rem,
    // 24px = 1.5rem, 32px = 2rem, 48px = 3rem
    xs: null,
    sm: null,
    base: null,
    lg: null,
    xl: null,
    '2xl': null,
    '3xl': null,
    '4xl': null,
    hero: null,

    // Line heights (unitless ratios)
    leadingTight: null,
    leadingSnug: null,
    leadingNormal: null,
    leadingRelaxed: null,

    // Weights
    regular: null,
    medium: null,
    semibold: null,

    // Letter spacing (em)
    trackingTight: null,
    trackingNormal: null,
    trackingWide: null,
    /**
     * Tracking for the `label` slot — always applied wherever `font.label` is.
     *
     * A token rather than a literal at each call site because "always 0.16em"
     * is a property of the slot: a condensed face set tight reads as a word,
     * set open it reads as a label. Six sites use it, and they must not drift.
     */
    trackingLabel: null,
  },

  // -- Spacing (rem) --
  // 4px base grid: 0, 2, 4, then by 4s through 64
  space: {
    '0': null,
    '0.5': null,
    '1': null,
    '2': null,
    '3': null,
    '4': null,
    '5': null,
    '6': null,
    '7': null,
    '8': null,
    '9': null,
    '10': null,
    '11': null,
    '12': null,
    '13': null,
    '14': null,
    '15': null,
    '16': null,
  },

  // -- Border radius (rem) --
  radius: {
    none: null,
    xs: null,
    sm: null,
    md: null,
    lg: null,
    xl: null,
    '2xl': null,
    full: null,
  },

  // -- Border widths (px — the only px values in the system) --
  border: {
    hairline: null,
    thin: null,
    thick: null,
  },

  // -- Shadows --
  // Each level includes an outer glow layer for dark mode visibility.
  shadow: {
    sm: null,
    md: null,
    lg: null,
  },

  // -- Focus ring --
  focus: {
    width: null,
    offset: null,
    color: null,
    shadow: null,
  },

  // -- Z-index scale --
  z: {
    dropdown: null,
    sticky: null,
    overlay: null,
    modal: null,
    popover: null,
    tooltip: null,
    toast: null,
  },

  // -- Motion --
  duration: {
    fast: null,
    normal: null,
    slow: null,
  },

  easing: {
    default: null,
    in: null,
    out: null,
    inOut: null,
  },

  // -- Scrollbar --
  scrollbar: {
    width: null,
    thumb: null,
    thumbHover: null,
    track: null,
    radius: null,
  },
});
