import { style, globalStyle } from '@vanilla-extract/css';
import { vars } from '../theme/contract.css.js';
import { upTo } from '../theme/breakpoints.js';

/* ═══════════════════════════════════════
   Shared nav-item look
   ═══════════════════════════════════════
   One visual language for every tab orientation: the horizontal variants are
   the vertical rail's items laid horizontally. Both compose from this base. */

const navItemBase = style({
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  gap: vars.space['3'],
  padding: `0 ${vars.space['3']}`,
  height: '2.25rem',
  border: 'none',
  background: 'transparent',
  color: vars.color.textSecondary,
  fontSize: vars.font.base,
  fontWeight: vars.font.medium,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  borderRadius: vars.radius.sm,
  transition: `background ${vars.duration.fast} ${vars.easing.default}, color ${vars.duration.fast} ${vars.easing.default}`,
  outline: 'none',
  selectors: {
    '&:hover': {
      background: vars.color.neutral100,
      color: vars.color.textPrimary,
    },
    '&:focus-visible': {
      boxShadow: vars.focus.shadow,
    },
  },
});

const navItemActive = style({
  // `navItemSelected` rather than `neutral800`: selection is a statement about
  // state, so each theme says it in its own colour. Per ADR-026 this one style
  // drives both horizontal tabs and the vertical rail, so they cannot diverge.
  background: vars.color.navItemSelected,
  color: vars.color.neutral0,
  fontWeight: vars.font.semibold,
  selectors: {
    '&:hover': {
      background: vars.color.navItemSelected,
      color: vars.color.neutral0,
    },
  },
});

/* ── Tab list container ── */
export const tabList = style({
  display: 'flex',
  alignItems: 'center',
  gap: vars.space['1'],
  position: 'relative',
});

/* Inner scrollable area that hides overflow */
export const tabListInner = style({
  display: 'flex',
  alignItems: 'center',
  gap: vars.space['1'],
  flex: 1,
  overflow: 'hidden',
  minWidth: 0,
});

/* ── Individual tab (nav-item look, horizontal) ── */
export const tab = style([
  navItemBase,
  {
    flexShrink: 0,
    justifyContent: 'center',
  },
]);

export const tabActive = navItemActive;

/* ── Overflow "More" button ── */
export const overflowBtn = style([
  navItemBase,
  {
    gap: vars.space['1'],
    flexShrink: 0,
  },
]);

export const overflowBtnActive = navItemActive;

/* ── Tab panel ── */
export const tabPanel = style({
  padding: `${vars.space['4']} 0`,
});

/* ── Pill variant (deprecated — now an alias of the default look) ── */
export const tabListPill = style({});
export const tabPill = tab;
export const tabPillActive = tabActive;

/* ═══════════════════════════════════════
   Vertical variant
   ═══════════════════════════════════════ */

/**
 * Two-stage responsive collapse for the vertical tab rail:
 *
 *   >= 800px          vertical rail, labels visible
 *   640px - 799.98px  horizontal bar across the top, labels STILL visible
 *   < 640px           horizontal bar, icon-only (labels dropped, tooltip on hover)
 *
 * Labels are visually hidden by clipping, never `display: none`, so each tab keeps
 * its accessible name for screen readers even when only the icon is painted.
 * Tabs without an icon keep their label at every width — see VerticalTabs in
 * Tabs.tsx — otherwise they would collapse to empty buttons.
 */
const COLLAPSE = upTo('lg');
const ICON_ONLY = upTo('md');

export const verticalWrapper = style({
  display: 'flex',
  position: 'absolute',
  inset: 0,
  overflow: 'hidden',
  '@media': {
    [COLLAPSE]: {
      flexDirection: 'column',
    },
  },
});

export const verticalTabList = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.space['1'],
  width: '13rem',
  flexShrink: 0,
  /*
   * The page canvas, not a shade of it. This rail is separated from the content
   * by its hairline border, never by colour — and in light, arctic, dark and
   * midnight `background` IS `neutral50`, so writing the raw stop was only ever
   * a coincidence that held. It stopped holding the moment Empire moved its
   * canvas to neutral25, leaving the rail a visibly darker stripe.
   */
  background: vars.color.background,
  borderRight: `${vars.border.hairline} solid ${vars.color.border}`,
  padding: `${vars.space['3']} ${vars.space['2']}`,
  overflowY: 'auto',
  '@media': {
    [COLLAPSE]: {
      flexDirection: 'row',
      width: '100%',
      borderRight: 'none',
      borderBottom: `${vars.border.hairline} solid ${vars.color.border}`,
      overflowX: 'auto',
      overflowY: 'hidden',
    },
  },
});

/**
 * Direct children of the collapsed tab list are the tab buttons, or — when
 * icon-only — the Tooltip's wrapper span. Neither may shrink, or the tabs squash
 * instead of scrolling. Written as a globalStyle because vanilla-extract only
 * allows `selectors` that target the class itself, not its children.
 */
globalStyle(`${verticalTabList} > *`, {
  '@media': {
    [COLLAPSE]: {
      flexShrink: 0,
    },
  },
});

/**
 * Tab label. Visually hidden below the icon-only breakpoint, but still exposed to
 * screen readers (clipped, not `display: none`). Shared by the horizontal and
 * vertical variants — both collapse to icon-only the same way.
 */
export const verticalTabLabel = style({
  '@media': {
    [ICON_ONLY]: {
      position: 'absolute',
      width: '0.0625rem',
      height: '0.0625rem',
      padding: 0,
      margin: '-0.0625rem',
      overflow: 'hidden',
      clipPath: 'inset(50%)',
      whiteSpace: 'nowrap',
      border: 0,
    },
  },
});

export const verticalTab = style([
  navItemBase,
  {
    textAlign: 'left',
    width: '100%',
    '@media': {
      [COLLAPSE]: {
        width: 'auto',
        flexShrink: 0,
        justifyContent: 'center',
      },
      // Icon-only: no label to space away from, so drop the icon/label gap.
      [ICON_ONLY]: {
        gap: 0,
      },
    },
  },
]);

export const verticalTabActive = navItemActive;

export const verticalContent = style({
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  overflow: 'hidden',
});

export const verticalPanel = style({
  flex: 1,
  overflowY: 'auto',
  padding: vars.space['6'],
  minHeight: 0,
});

export const verticalPanelFlush = style({
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  minHeight: 0,
});

export const verticalPanelInner = style({
  maxWidth: '75rem',
  margin: '0 auto',
});

/**
 * The trailing dot on a tab with something waiting behind it.
 *
 * `marginInlineStart: auto` pushes it to the trailing edge of the button rather
 * than sitting against the label, so it reads as a property of the row and not
 * of the word. `flexShrink: 0` because a dot that squashes is a smudge — the
 * label truncates, the dot does not.
 *
 * # It is an unread marker, which is why it is red
 *
 * DESIGN.md reserves `danger` for meaning, and an available update is not bad
 * news — so the first version used the brand ramp. That was the wrong read of
 * the convention: this is the notification dot, whose established meaning is
 * "something here you have not seen", and every product that has one draws it
 * red regardless of whether the news is good. `danger400` inverts with the
 * palette (55% on white, 59% on near-black) so it clears the resting tab in
 * every theme.
 *
 * # It disappears on selection rather than changing colour
 *
 * Selecting the tab IS reading it, so the dot has nothing left to say — and
 * that turns out to dissolve the problem it had. It was `brand500`, the same
 * family as `navItemSelected`, so selecting put a teal dot on a teal fill at
 * roughly 1.5:1. Recolouring for the selected state was the obvious fix and a
 * hard one, because `navItemSelected` INVERTS across the palette (a 37% dark
 * teal in Empire, an 84% gold in Empire Dark), so any single value is chosen
 * against one ground and against the opposite of the other. Not drawing it
 * needs no value at all.
 *
 * The state behind it is untouched: `updateWaiting` stays true until the update
 * is installed, so leaving the tab brings the dot back. Only the selected tab
 * declines to draw it.
 */
export const tabDot = style({
  width: '0.5rem',
  height: '0.5rem',
  borderRadius: vars.radius.full,
  background: vars.color.danger400,
  marginInlineStart: 'auto',
  flexShrink: 0,
  selectors: {
    [`${navItemActive} &`]: { display: 'none' },
  },
});
